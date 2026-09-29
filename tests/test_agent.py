import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.ai.agent import respond
from app.ai.service import AIServiceError
from app.db import connection
from app.main import app
from app.schemas import Card


class AgentTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        env = patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory.name) / 'agent.db')})
        env.start(); self.addCleanup(env.stop)
        self.client = TestClient(app).__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.login('owner')
        self.start_id = str(uuid4())
        self.data = self.client.post('/api/me/agent', json={'request_id': self.start_id}).json()
        self.task_id = self.data['task']['id']
        self.path = f'/api/me/agent/{self.task_id}'

    def login(self, name, role='BUSINESS'):
        auth = self.client.post('/api/auth/register', json={
            'email': name + '@example.org', 'password': 'synthetic-password', 'role': role}).json()
        self.client.headers['X-CSRF-Token'] = auth['csrf_token']

    def send(self, request_id=None, text='В магазине много списаний.', revision=0):
        return self.client.post(self.path + '/messages', json={
            'request_id': request_id or str(uuid4()), 'text': text, 'revision': revision})

    def test_durable_idempotent_chat_and_confirmations(self):
        same = self.client.post('/api/me/agent', json={'request_id': self.start_id}).json()
        self.assertEqual(same['task']['id'], self.task_id)
        request_id = str(uuid4())
        with patch('app.routes.agent.respond', new=AsyncMock(return_value={
                'text': 'Давайте уточним.\n1. Какие данные?\n2. Для кого?\n3. Как проверим?',
                'updates': {'title': 'Списания', 'context': 'В магазине много списаний.'}})) as model:
            result = self.send(request_id).json()
            self.assertEqual(len(result['messages']), 2)
            self.assertEqual(result['run']['status'], 'completed')
            self.assertEqual(result['task']['score'], 0)
            self.assertEqual(self.send(request_id).json()['messages'], result['messages'])
            self.assertEqual(model.await_count, 1)
            self.assertEqual(self.send(request_id, text='Другой текст').status_code, 409)
        # New app lifespan preserves the transcript and task identity.
        with TestClient(app) as restored:
            restored.cookies.update(self.client.cookies)
            self.assertEqual(restored.get(self.path).json()['messages'], result['messages'])
        payload = {'topic': 'Ритейл', 'card': result['task']['card'], 'confirmed_fields': ['context'], 'expected_revision': 1}
        saved = self.client.put(f'/api/me/tasks/{self.task_id}', json=payload).json()
        self.assertEqual(saved['score'], 10)
        self.assertEqual(self.client.put(f'/api/me/tasks/{self.task_id}', json=payload).status_code, 409)
        with patch('app.routes.agent.respond', new=AsyncMock(return_value={
                'text': 'Уточнил.', 'updates': {'context': 'Исправленный факт'}})):
            changed = self.send(text='Исправленный факт', revision=saved['revision']).json()
        self.assertEqual(changed['task']['score'], 0)
        self.assertEqual(changed['task']['confirmed_fields'], [])
        self.assertEqual(changed['task']['status'], 'draft')
        published = self.client.post(f'/api/me/tasks/{self.task_id}/publish').json()
        self.assertEqual(published['status'], 'published')
        self.assertEqual(published['score'], 0)
        with patch('app.routes.agent.respond', new=AsyncMock(return_value={
                'text': 'Обсуждаем', 'updates': {'title': 'Не изменять публикацию'}})):
            discussed = self.send(text='Изменить название', revision=published['revision']).json()
        self.assertEqual(discussed['task']['card'], published['card'])
        self.assertEqual(discussed['task']['status'], 'published')


    def test_failure_retry_stale_run_and_revision_conflict(self):
        request_id = str(uuid4())
        with patch('app.routes.agent.respond', new=AsyncMock(side_effect=AIServiceError('AI_TIMEOUT', 'Повторите запрос'))):
            failed = self.send(request_id).json()
        self.assertEqual(failed['run']['status'], 'failed')
        self.assertEqual(len(failed['messages']), 1)
        self.assertEqual(failed['task']['card']['title'], '')
        with patch('app.routes.agent.respond', new=AsyncMock(return_value={'text': 'Ответ после повтора', 'updates': {}})):
            result = self.send(request_id).json()
        self.assertEqual(len(result['messages']), 2)
        self.assertEqual(result['run']['status'], 'completed')
        async def concurrent_edit(*args):
            with connection() as db:
                db.execute('UPDATE tasks SET topic=?,revision=revision+1 WHERE id=?', ('Ручная правка', self.task_id))
            return {'text': 'Устаревший ответ', 'updates': {'title': 'Не применять'}}
        with patch('app.routes.agent.respond', side_effect=concurrent_edit):
            conflict = self.send(revision=1).json()
        self.assertEqual(conflict['run']['status'], 'failed')
        self.assertEqual(conflict['task']['topic'], 'Ручная правка')
        self.assertEqual(conflict['task']['card']['title'], '')
        self.assertEqual(len(conflict['messages']), 3)
        with connection() as db:
            db.execute("UPDATE agent_runs SET status='pending',started_at='2000-01-01T00:00:00+00:00' WHERE request_id=?", (conflict['run']['request_id'],))
        self.assertEqual(self.client.get(self.path).json()['run']['status'], 'failed')

    def test_owner_role_csrf_and_pending_protection(self):
        self.client.headers.pop('X-CSRF-Token')
        self.assertEqual(self.send().status_code, 403)
        self.login('other')
        self.assertEqual(self.client.get(self.path).status_code, 404)
        self.assertEqual(self.send().status_code, 404)
        self.login('team', 'TEAM')
        self.assertEqual(self.client.get(self.path).status_code, 403)
        self.assertEqual(self.client.post('/api/me/agent', json={'request_id': str(uuid4())}).status_code, 403)

    def test_duplicate_pending_does_not_call_model(self):
        request_id = str(uuid4())
        async def during_run(*args):
            duplicate = (await asyncio.to_thread(self.send, request_id)).json()
            self.assertEqual(duplicate['run']['status'], 'pending')
            self.assertEqual(len(duplicate['messages']), 1)
            self.assertEqual((await asyncio.to_thread(self.send)).status_code, 409)
            return {'text': 'Один ответ', 'updates': {}}
        with patch('app.routes.agent.respond', side_effect=during_run) as model:
            result = self.send(request_id).json()
        self.assertEqual(result['run']['status'], 'completed')
        self.assertEqual(model.call_count, 1)


class GroundingTest(unittest.IsolatedAsyncioTestCase):
    async def test_quotes_questions_and_published_read_only(self):
        task = {'card': Card().model_dump(), 'status': 'draft'}
        messages = [{'id': 1, 'role': 'user', 'text': 'Есть Excel за месяц. Не менять процесс.'}]
        raw = {'reply': 'Разберём задачу.', 'questions': ['Кто пользуется?', 'Какой результат?', 'Как проверить?'],
               'card': {**dict.fromkeys(Card.model_fields, []), 'data': ['m1s0']}}
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            result = await respond(task, messages)
        self.assertEqual(result['updates']['data'], 'Есть Excel за месяц.')
        self.assertIn('3. Как проверить?', result['text'])
        raw['card']['title'] = ['m1s0']
        raw['questions'] = ['Какой формат? Какой срок?']
        followup = messages + [{'id': 2, 'role': 'assistant', 'text': result['text']}]
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            short = await respond(task, followup)
        self.assertTrue(short['text'].endswith('1. Какой формат?'))
        raw['questions'] = ['Кто пользуется?', 'Какой результат?', 'Как проверить?']

        raw['card']['data'] = ['invented-source']
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            with self.assertRaises(AIServiceError):
                await respond(task, messages)
        raw['card'] = dict.fromkeys(Card.model_fields, []); raw['questions'] = ['Один вопрос?']
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            with self.assertRaises(AIServiceError):
                await respond(task, messages)
        raw['questions'] = []; messages.append({'id': 2, 'role': 'assistant', 'text': 'Есть 50 магазинов.'})
        raw['card']['context'] = ['m2s0']
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            with self.assertRaises(AIServiceError):
                await respond(task, messages)
        raw['card'] = {**dict.fromkeys(Card.model_fields, []), 'data': ['m1s0']}
        task['status'] = 'published'
        with patch('app.ai.agent._model_json', new=AsyncMock(return_value=raw)):
            self.assertEqual((await respond(task, messages))['updates'], {})


if __name__ == '__main__':
    unittest.main()
