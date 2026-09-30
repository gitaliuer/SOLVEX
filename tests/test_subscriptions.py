import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import usage
from app.ai.service import AIServiceError
from app.db import connection
from app.main import app


class SubscriptionTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory)/'test.db')}))
        self.client = self.stack.enter_context(TestClient(app))
        response = self.client.post('/api/auth/register', json={'email':'quota@example.org','password':'synthetic-password','role':'BUSINESS'})
        self.headers = {'X-CSRF-Token':response.json()['csrf_token']}
        self.user_id = response.json()['user']['id']
        self.agent = self.stack.enter_context(patch('app.routes.agent.respond', new_callable=AsyncMock,
            return_value={'text':'Synthetic response, no external API call.', 'updates':{}}))

    def post(self, path, payload):
        return self.client.post(path, json=payload, headers=self.headers)

    def task(self):
        return self.post('/api/me/agent', {'request_id':str(uuid4())}).json()['task']

    def send(self, task, request_id=None):
        return self.post(f"/api/me/agent/{task['id']}/messages", {'request_id':request_id or str(uuid4()),
                        'revision':task['revision'], 'text':'Synthetic business problem', 'locale':'en'})

    def state(self):
        response = self.client.get('/api/me/subscription')
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_ten_messages_across_tasks_and_no_charge_for_idempotent_retry(self):
        for _ in range(10):
            task = self.task(); request_id = str(uuid4())
            self.assertEqual(self.send(task, request_id).status_code, 200)
        self.assertEqual(self.send(task, request_id).status_code, 200)
        response = self.send(self.task())
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()['error']['code'], 'QUOTA_EXCEEDED')
        self.assertEqual(self.agent.await_count, 10)
        self.assertEqual(self.state()['usage']['chat']['used'], 10)
        # Manual challenge work remains available after AI exhaustion.
        self.assertEqual(self.post('/api/me/tasks', {'topic':'Retail','card':{'title':'Manual task'},'confirmed_fields':[]}).status_code, 201)

    def test_failed_request_refunded_and_retry_counts_once(self):
        task = self.task(); request_id = str(uuid4())
        self.agent.side_effect = AIServiceError('AI_UNAVAILABLE', 'Synthetic outage')
        self.assertEqual(self.send(task, request_id).json()['run']['status'], 'failed')
        self.assertEqual(self.state()['usage']['chat']['remaining'], 10)
        self.agent.side_effect = None
        self.assertEqual(self.send(task, request_id).json()['run']['status'], 'completed')
        self.assertEqual(self.state()['usage']['chat']['used'], 1)

    def test_research_two_runs_cache_free_failure_refunded(self):
        result = {'sources':[], 'passages':[], 'insights':[], 'business_data':{}, 'comparisons':[], 'quality_version':1}
        task = self.task(); path = f"/api/me/tasks/{task['id']}/research"
        payload = {'query':'Synthetic research question','locale':'en','expected_revision':0}
        with patch('app.routes.research.analyze', new_callable=AsyncMock, return_value=result) as research:
            research.side_effect = AIServiceError('AI_UNAVAILABLE', 'Synthetic outage')
            self.assertEqual(self.post(path, payload).status_code, 503)
            self.assertEqual(self.state()['usage']['research']['remaining'], 2)
            research.side_effect = None
            self.assertEqual(self.post(path, payload).status_code, 200)
            self.assertEqual(self.post(path, {**payload,'refresh':True}).status_code, 200)
            self.assertEqual(self.post(path, payload).status_code, 200)
            self.assertEqual(self.post(path, {**payload,'refresh':True}).status_code, 429)
            other = self.task()
            self.assertEqual(self.post(f"/api/me/tasks/{other['id']}/research", payload).status_code, 429)
            self.assertEqual(research.await_count, 3)

    def test_parallel_reservations_cannot_overrun_allowance(self):
        def reserve_one(_):
            try:
                with connection() as db:
                    db.execute('BEGIN IMMEDIATE'); usage.reserve(db, self.user_id, 'chat', str(uuid4()))
                return True
            except HTTPException as exc:
                self.assertEqual(exc.status_code, 429); return False
        with ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(sum(pool.map(reserve_one, range(13))), 10)
        self.assertEqual(self.state()['usage']['chat']['reserved'], 10)

    def test_kazakhstan_midnight_expiry_and_subscription_cannot_reset_usage(self):
        moment = datetime(2026, 9, 30, 18, 59, tzinfo=timezone.utc)
        with patch('app.usage.utcnow', return_value=moment):
            with connection() as db:
                db.execute('BEGIN IMMEDIATE'); usage.reserve(db,self.user_id,'chat','first'); usage.finish(db,'first',True)
                db.execute('INSERT INTO subscriptions VALUES(?,?,?,?,?)', (self.user_id,'plus',(moment-timedelta(days=1)).isoformat(),(moment+timedelta(seconds=30)).isoformat(),'synthetic-payment'))
            self.assertEqual(self.state()['usage']['chat']['limit'],100)
            self.assertEqual(self.state()['usage']['chat']['used'],1)
        with patch('app.usage.utcnow', return_value=moment+timedelta(seconds=31)):
            self.assertEqual(self.state()['plan'],'free')
            self.assertEqual(self.state()['usage']['chat']['used'],1)
        with patch('app.usage.utcnow', return_value=moment+timedelta(minutes=2)):
            self.assertEqual(self.state()['usage']['chat']['used'],0)
            self.assertEqual(self.state()['period_key'],'2026-10-01')
            with connection() as db:
                db.execute('BEGIN IMMEDIATE'); usage.reserve(db,self.user_id,'chat','orphan')
        with patch('app.usage.utcnow', return_value=moment+timedelta(minutes=6)):
            self.assertEqual(self.state()['usage']['chat']['remaining'],10)

    def test_auth_csrf_legacy_bypass_and_checkout_not_fake(self):
        with TestClient(app) as guest:
            self.assertEqual(guest.get('/api/me/subscription').status_code,401)
            self.assertEqual(guest.get('/api/plans').json()['plans'][1]['price_cents'],399)
            self.assertEqual(guest.post('/api/ai/questions',json={'draft':'Synthetic description','topic':'Retail'}).status_code,401)
        self.assertEqual(self.client.post('/api/me/subscription/checkout',json={}).status_code,403)
        self.assertEqual(self.post('/api/me/subscription/checkout',{}).json()['error']['code'],'BILLING_NOT_CONFIGURED')
        self.assertEqual(self.state()['plan'],'free')
        for _ in range(10): self.send(self.task())
        for endpoint in ('/api/ai/questions','/api/me/ai/questions','/api/ai/card','/api/me/ai/card'):
            self.assertEqual(self.post(endpoint,{'draft':'Synthetic description','topic':'Retail','answers':[]} if endpoint.endswith('card') else {'draft':'Synthetic description','topic':'Retail'}).status_code,429)

    def test_plus_daily_ceiling_and_account_isolation(self):
        moment=usage.utcnow();period=moment.astimezone(usage.KAZAKHSTAN).date().isoformat()
        with connection() as db:
            db.execute('INSERT INTO subscriptions VALUES(?,?,?,?,?)',(self.user_id,'plus',(moment-timedelta(days=1)).isoformat(),(moment+timedelta(days=29)).isoformat(),'synthetic-paid-test'))
            db.executemany('INSERT INTO ai_usage VALUES(?,?,?,?,?,?,?)',
                [(str(uuid4()),self.user_id,kind,'completed',period,(moment-timedelta(minutes=2)).isoformat(),moment.isoformat()) for kind,count in [('chat',100),('research',10)] for _ in range(count)])
        self.assertEqual(self.state()['usage']['chat']['remaining'],0)
        self.assertEqual(self.state()['usage']['research']['remaining'],0)
        self.assertEqual(self.send(self.task()).status_code,429)
        self.agent.assert_not_awaited()
        with TestClient(app) as other:
            other.post('/api/auth/register',json={'email':'other-quota@example.org','password':'synthetic-password','role':'BUSINESS'})
            other_state=other.get('/api/me/subscription').json()
            self.assertEqual(other_state['plan'],'free')
            self.assertEqual(other_state['usage']['chat']['remaining'],10)


if __name__ == '__main__': unittest.main()
