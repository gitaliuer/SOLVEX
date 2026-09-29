import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.db import connection
from app.main import app
from app.matching import recommendations
from app.schemas import Card


def profile(id, skills, technologies=None, interests=None, points=0):
    return dict(id=id, name='Команда ' + str(id), skills=skills, technologies=technologies or [],
                interests=interests or [], points=points)


class MatchingRulesTest(unittest.TestCase):
    def task(self, **fields):
        return {'topic': 'Ритейл', 'card': Card(**fields).model_dump(), 'confirmed_fields': ['expected_result']}

    def test_evidence_aliases_deduplication_and_stable_order(self):
        task = self.task(expected_result='Нужен отчёт и дашборд на Python.')
        teams = [profile(1, ['UX'], ['Java'], ['Ритейл'], 999),
                 profile(2, ['Аналитика', 'data analysis', 'Визуализация'], ['Python'], ['retail']),
                 profile(3, ['Analytics'], [], ['Образование'])]
        result, signals = recommendations(task, teams)
        self.assertEqual([item['team']['id'] for item in result], [2, 3, 1])
        self.assertEqual(len(result[0]['reasons']), 4)
        self.assertEqual(len(signals), 2)
        for reason in result[0]['reasons']:
            if reason['field'] != 'topic':
                self.assertIn(reason['term'], task['card'][reason['field']])
                self.assertTrue(reason['confirmed'])
        self.assertEqual(result[1]['gaps'], ['Визуализация'])
        self.assertEqual(result[0]['team']['points'], 0)

    def test_negative_terms_source_data_and_language_boundaries(self):
        task = self.task(expected_result='Нужен отчёт. Python не нужен. Без веб-разработки.',
                         data='Есть таблица Excel и Python-скрипты.', constraints='Нельзя использовать Java. Нужен C++.')
        result, signals = recommendations(task, [profile(1, ['Аналитика', 'Веб-разработка'], ['Python', 'Excel', 'C', 'C++', 'Java'])])
        self.assertEqual([s['key'] for s in signals], ['analysis'])
        self.assertEqual([r['profile_value'] for r in result[0]['reasons']], ['Аналитика', 'C++'])
        result, _ = recommendations(self.task(expected_result='Нужен отчёт.'), [profile(1, ['Без аналитики'])])
        self.assertEqual(result[0]['reasons'], [])

    def test_custom_tags_no_invented_evidence_or_success_percent(self):
        result, _ = recommendations(self.task(expected_result='Нужна настройка Kubernetes.'),
                                    [profile(5, ['Kubernetes']), profile(2, ['SQL'])])
        self.assertEqual(result[0]['team']['id'], 5)
        self.assertNotIn('score', result[0])
        self.assertEqual(result[1]['reasons'], [])
        self.assertEqual(recommendations(self.task(), [profile(5, ['UX']), profile(2, ['Python'])])[0][0]['team']['id'], 2)


class MatchingApiTest(unittest.TestCase):
    def test_access_shortlist_restart_and_no_automatic_selection(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory) / 'matching.db')}):
            with TestClient(app) as owner, TestClient(app) as other, TestClient(app) as team, TestClient(app) as guest:
                for client, email, role in [(owner, 'owner', 'BUSINESS'), (other, 'other', 'BUSINESS'), (team, 'team', 'TEAM')]:
                    auth = client.post('/api/auth/register', json={'email': email + '@example.org', 'password': 'synthetic-password', 'role': role}).json()
                    client.headers['X-CSRF-Token'] = auth['csrf_token']
                saved_team = team.put('/api/me/team', json={'name': 'Аналитики', 'skills': ['Аналитика'], 'technologies': ['Python'], 'interests': ['Ритейл']}).json()['team']
                task = owner.post('/api/me/tasks', json={'topic': 'Ритейл', 'card': {'title': 'Отчёт', 'expected_result': 'Нужен отчёт на Python.'}}).json()
                path = f"/api/me/tasks/{task['id']}"
                self.assertEqual(owner.get(path + '/matches').status_code, 409)
                owner.post(path + '/publish')
                response = owner.get(path + '/matches')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['cache-control'], 'no-store')
                data = response.json()
                self.assertEqual(len(data['teams']), 1)  # Never includes seeded demo profiles.
                self.assertNotIn('email', response.text)
                self.assertEqual(data['teams'][0]['team']['id'], saved_team['id'])
                for client, code in [(other, 404), (team, 403), (guest, 401)]:
                    self.assertEqual(client.get(path + '/matches').status_code, code)
                    self.assertEqual(client.put(path + f"/shortlist/{saved_team['id']}", json={'saved': True}).status_code, code)
                target = path + f"/shortlist/{saved_team['id']}"
                csrf = owner.headers.pop('X-CSRF-Token')
                self.assertEqual(owner.put(target, json={'saved': True}).status_code, 403)
                owner.headers['X-CSRF-Token'] = csrf
                self.assertEqual(owner.put(target, json={'saved': 'true'}).status_code, 422)
                self.assertEqual(owner.put(path + '/shortlist/1', json={'saved': True}).status_code, 404)
                for _ in range(2):
                    self.assertEqual(owner.put(target, json={'saved': True}).json(), {'team_id': saved_team['id'], 'saved': True})
                proposal = team.post(f"/api/catalog/tasks/{task['id']}/proposals", json={
                    'idea': 'Исследовать исходные данные', 'plan': 'Сделать отчёт и проверить суммы',
                    'duration_days': 14, 'prototype_url': 'https://example.org/test'}).json()
                current = owner.get(path + '/matches').json()['teams'][0]
                self.assertTrue(current['shortlisted'])
                self.assertEqual(current['proposal'], {'id': proposal['id'], 'status': 'pending'})
                with connection() as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM team_shortlist').fetchone()[0], 1)
                    self.assertEqual(db.execute('SELECT points FROM teams WHERE id=?', (saved_team['id'],)).fetchone()[0], 0)
                with TestClient(app) as restored:
                    restored.cookies.update(owner.cookies)
                    self.assertTrue(restored.get(path + '/matches').json()['teams'][0]['shortlisted'])
                owner.put(target, json={'saved': False})
                self.assertFalse(owner.get(path + '/matches').json()['teams'][0]['shortlisted'])


if __name__ == '__main__':
    unittest.main()
