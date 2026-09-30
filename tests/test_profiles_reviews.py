import asyncio
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from app.ai.review import analyze
from app.ai.service import AIServiceError
from app.db import connection, init_db
from app.main import app


class ProfilesReviewsTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        env = patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory.name) / 'profiles.db')})
        env.start(); self.addCleanup(env.stop)
        self.owner = TestClient(app).__enter__(); self.addCleanup(self.owner.__exit__, None, None, None)
        self.other = TestClient(app); self.team = TestClient(app)
        for client, name, role in [(self.owner, 'owner', 'BUSINESS'), (self.other, 'other', 'BUSINESS'), (self.team, 'team', 'TEAM')]:
            data = client.post('/api/auth/register', json={'email': name+'@example.org', 'password': 'synthetic-password', 'role': role}).json()
            client.headers['X-CSRF-Token'] = data['csrf_token']

    def task_and_proposal(self):
        self.team.put('/api/me/profile', json={'name': 'Research team', 'skills': ['Analysis']})
        task = self.owner.post('/api/me/tasks', json={'topic': 'Retail', 'card': {'title': 'Analyze waste', 'expected_result': 'An analytical report'}, 'confirmed_fields': []}).json()
        self.owner.post(f"/api/me/tasks/{task['id']}/publish")
        proposal = self.team.post(f"/api/catalog/tasks/{task['id']}/proposals", json={
            'idea': 'Analyze the available data', 'plan': 'Prepare an analytical report', 'duration_days': 14, 'prototype_url': 'https://example.org/report'}).json()
        return task, proposal

    def test_profiles_public_privacy_legacy_and_migration(self):
        payload = {'name': 'Company', 'headline': 'We build useful things', 'description': 'Company story', 'experience': 'Our projects', 'location': 'Almaty', 'website': 'https://example.org', 'contact': 'Public contact'}
        self.assertEqual(self.owner.put('/api/me/profile', json=payload).status_code, 200)
        self.assertEqual(self.other.get('/api/me/profile').json()['profile'].get('name'), None)
        self.assertEqual(self.owner.put('/api/me/profile', json={**payload, 'website':'javascript:alert(1)'}).status_code, 422)
        self.assertEqual(self.owner.put('/api/me/profile', json={**payload, 'image_url':'/etc/passwd'}).status_code, 422)
        self.assertEqual(self.team.put('/api/me/profile', json=payload).status_code, 422)
        task, proposal = self.task_and_proposal()
        self.assertNotIn('email', self.owner.get(f"/api/catalog/tasks/{task['id']}").json()['organization'])
        profile = self.team.get('/api/me/profile').json()['profile']
        self.assertEqual(profile['name'], 'Research team')
        self.assertEqual(self.team.get('/api/me/team').json()['team']['skills'], ['Analysis'])
        self.team.put('/api/me/team', json={'name':'Legacy update', 'skills':['UX']})
        self.assertEqual(self.team.get('/api/me/profile').json()['profile']['name'], 'Legacy update')
        init_db()
        self.assertEqual(self.owner.get('/api/me/profile').json()['profile']['experience'], 'Our projects')
        self.assertEqual(self.owner.get(f"/api/me/tasks/{task['id']}/proposals").json()['proposals'][0]['id'], proposal['id'])

    def test_photo_decode_resize_replace_and_scope(self):
        data = io.BytesIO(); exif = Image.Exif(); exif[274] = 6; exif[270] = 'Private camera note'
        Image.new('RGB', (1500,900), '#6445da').save(data, 'JPEG', exif=exif)
        response = self.owner.post('/api/me/profile/image', content=data.getvalue(), headers={'Content-Type':'image/jpeg'})
        self.assertEqual(response.status_code, 200, response.text)
        url = response.json()['image_url']
        image = self.other.get(url)
        self.assertEqual(image.headers['content-type'], 'image/webp')
        with Image.open(io.BytesIO(image.content)) as picture:
            self.assertLessEqual(max(picture.size), 768); self.assertFalse(picture.getexif()); self.assertGreater(picture.height, picture.width)
        self.assertEqual(self.other.delete('/api/me/profile/image').status_code, 200)
        self.assertEqual(self.owner.get(url).status_code, 200)
        self.assertEqual(self.owner.post('/api/me/profile/image', content=b'<svg/>').status_code, 422)
        self.assertEqual(self.owner.post('/api/me/profile/image', content=b'x'*(3*1024*1024+1)).status_code, 413)
        self.assertEqual(self.owner.post('/api/me/profile/image', content=data.getvalue(), headers={'X-CSRF-Token':'wrong'}).status_code, 403)
        replacement = self.owner.post('/api/me/profile/image', content=data.getvalue()).json()['image_url']
        self.assertEqual(self.owner.get(url).status_code, 404)
        self.owner.delete('/api/me/profile/image')
        self.assertEqual(self.owner.get(replacement).status_code, 404)

    def test_private_cached_review_staleness_and_manual_decision(self):
        task, p = self.task_and_proposal(); endpoint = f"/api/me/proposals/{p['id']}/review"
        self.assertEqual(self.other.get(endpoint).status_code, 404)
        self.assertEqual(self.team.get(endpoint).status_code, 403)
        self.assertIsNone(self.owner.get(endpoint).json()['review'])
        result = {'strengths': [{'task_field':'expected_result','proposal_field':'plan','quote':p['plan'],'requirement':'An analytical report'}], 'questions':['Which data will you use?']}
        with patch('app.routes.reviews.analyze', new=AsyncMock(return_value=result)) as ai:
            response = self.owner.post(endpoint, json={'locale':'en'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.owner.post(endpoint, json={'locale':'en'}).status_code, 200)
            self.assertEqual(ai.await_count, 1)
        self.assertEqual(self.owner.get(endpoint+'?locale=en').json()['review']['questions'], result['questions'])
        self.assertIsNone(self.owner.get(endpoint).json()['review'])
        self.assertEqual(self.owner.get(f"/api/me/tasks/{task['id']}/proposals").json()['proposals'][0]['status'], 'pending')
        current=self.owner.get(f"/api/me/tasks/{task['id']}").json()
        self.owner.put(f"/api/me/tasks/{task['id']}", json={'topic':current['topic'], 'card':{**current['card'],'constraints':'No production access'}, 'confirmed_fields':[]})
        self.assertTrue(self.owner.get(endpoint+'?locale=en').json()['stale'])
        with patch('app.routes.reviews.analyze', new=AsyncMock(side_effect=AIServiceError('AI_UNAVAILABLE','Synthetic error'))):
            self.assertEqual(self.owner.post(endpoint, json={'locale':'en'}).status_code, 503)
        self.assertTrue(self.owner.get(endpoint+'?locale=en').json()['stale'])
        with patch('app.routes.reviews.analyze', new=AsyncMock(return_value=result)):
            self.assertEqual(self.owner.post(endpoint, json={'locale':'en'}).status_code, 200)
        self.assertFalse(self.owner.get(endpoint+'?locale=en').json()['stale'])

    def test_review_rejects_changed_input_during_ai(self):
        task, p = self.task_and_proposal(); endpoint = f"/api/me/proposals/{p['id']}/review"
        async def change(*args):
            with connection() as db: db.execute("UPDATE tasks SET card=? WHERE id=?", ('{"title":"Changed"}', task['id']))
            return {'strengths': [], 'questions': ['Which data?']}
        with patch('app.routes.reviews.analyze', new=change):
            self.assertEqual(self.owner.post(endpoint, json={}).status_code, 409)
        self.assertIsNone(self.owner.get(endpoint).json()['review'])

    def test_ai_quotes_must_exist_and_questions_are_bounded(self):
        task={'card':{'title':'Waste','expected_result':'Report'}}; proposal={'idea':'Analyze source data','plan':'Prepare analytical report','duration_days':14,'prototype_url':'https://example.org'}
        async def check():
            valid={'strengths':[{'task_field':'expected_result','proposal_field':'plan','quote':'analytical report'}],'questions':['Which data can we use?']}
            with patch('app.ai.review._model_json', new=AsyncMock(return_value=valid)):
                result=await analyze(task,proposal,'en');self.assertEqual(result['strengths'][0]['requirement'],'Report')
            for invalid in [{'strengths':[{'task_field':'expected_result','proposal_field':'plan','quote':'Invented experience'}],'questions':['Which data?']}, {'strengths':[],'questions':['The team is best.']}]:
                with patch('app.ai.review._model_json', new=AsyncMock(return_value=invalid)):
                    with self.assertRaises(AIServiceError): await analyze(task,proposal)
        asyncio.run(check())
