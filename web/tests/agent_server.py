"""Disposable browser-test server with an explicitly synthetic AI response.

Run from repo root: python -m web.tests.agent_server
Never points to the user's application database; no OpenAI calls.
"""
import asyncio
import os
import tempfile
from pathlib import Path

import uvicorn
from app.routes import agent, reviews, research
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


async def research_fixture(query, business, locale):
    await asyncio.sleep(1.2)
    if 'synthetic failure' in query.lower():
        from app.ai.service import AIServiceError
        raise AIServiceError('AI_UNAVAILABLE', 'Синтетическая ошибка поиска')
    if 'synthetic empty' in query.lower():
        return {'sources': [], 'passages': [], 'insights': [], 'business_data': business}
    from app.db import now
    return {'quality_version':1,'sources': [{'id':'s1','url':'https://example.org/synthetic-paper','title':'Synthetic source — UI test only',
                         'domain':'example.org','accessed_at':now(),'published_at':'2021',
                         'metadata':{'status':'matched','provider':'Crossref','url':'https://api.crossref.org/works/10.5555/test','document_type':'journal-article','venue':'Synthetic venue — not a real journal','publisher':'Test publisher'}},
                         {'id':'s2','url':'https://example.net/synthetic-case','title':'Synthetic comparison — UI test only','domain':'example.net','accessed_at':now(),'published_at':None,'metadata':{'status':'unavailable'}}],
            'passages':[{'id':'e1','text':'Synthetic research summary for testing, not scientific evidence.','source_ids':['s1']},
                        {'id':'e2','text':'Synthetic comparison uses a different counting method.','source_ids':['s2']}],
            'comparisons':[{'left_id':'e1','right_id':'e2','relationship':'different_context','summary':'Synthetic studies use different methods.','caveat':'These are UI fixtures, not real findings.','next_check':'Compare the counting methods before drawing conclusions.'}],
            'insights':[{'factor':'Counting coverage' if locale=='en' else 'Охват инвентаризации',
                         'category':'industry','evidence_ids':['e1'],'business_ids':['card:data'] if 'card:data' in business else [],
                         'why':'Synthetic connection to this challenge','hypothesis':'Synthetic hypothesis requiring verification',
                         'limitations':'Synthetic test fixture, not actual research',
                         'question':'Which locations are counted?' if locale=='en' else 'Какие участки входят в инвентаризацию?'}],
            'business_data':business}


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='solvex-agent-ui-') as directory:
        os.environ['DATABASE_PATH'] = str(Path(directory) / 'test.db')
        agent.respond = fixture
        reviews.analyze = review_fixture
        research.analyze = research_fixture
        uvicorn.run(app, host='127.0.0.1', port=8010)
