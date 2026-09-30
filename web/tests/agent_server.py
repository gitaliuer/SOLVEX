"""Disposable browser-test server with an explicitly synthetic AI response.

Run from repo root: python -m web.tests.agent_server
Never points to the user's application database; no OpenAI calls.
"""
import asyncio
import os
import tempfile
from pathlib import Path

import uvicorn
from app.routes import agent, reviews
from app.main import app


async def fixture(task, messages):
    await asyncio.sleep(1)
    last = messages[-1]['text']
    if last == 'Проверка ошибки':
        from app.ai.service import AIServiceError
        raise AIServiceError('AI_UNAVAILABLE', 'Синтетическая ошибка AI для проверки повтора')
    return {'text': 'Синтетический ответ для UI-теста.\n\n1. Какие данные уже есть?\n2. Кто будет пользоваться результатом?\n3. Как проверим успех?',
            'updates': {'title': 'Снизить списания', 'context': last} if task['status'] == 'draft' else {}}


async def review_fixture(task, proposal, locale):
    await asyncio.sleep(0.3)
    return {'strengths': [{'task_field': 'expected_result', 'proposal_field': 'plan',
                          'quote': proposal['plan'], 'requirement': task['card'].get('expected_result', '')}],
            'questions': ['Which data will you use?'] if locale == 'en' else ['Какие данные вы будете использовать?']}


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='solvex-agent-ui-') as directory:
        os.environ['DATABASE_PATH'] = str(Path(directory) / 'test.db')
        agent.respond = fixture
        reviews.analyze = review_fixture
        uvicorn.run(app, host='127.0.0.1', port=8010)
