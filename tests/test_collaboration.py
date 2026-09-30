import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.db import connection, init_db, now


class CollaborationTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        env = patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory.name) / 'test.db')})
        env.start(); self.addCleanup(env.stop)
        self.owner = TestClient(app).__enter__(); self.addCleanup(self.owner.__exit__, None, None, None)
        self.team, self.other, self.guest = TestClient(app), TestClient(app), TestClient(app)
        for client, name, role in [(self.owner,'owner','BUSINESS'), (self.team,'team','TEAM'), (self.other,'other','TEAM')]:
            data = client.post('/api/auth/register', json={'email':name+'@example.org','password':'synthetic-password','role':role}).json()
            client.headers['X-CSRF-Token'] = data['csrf_token']
        self.team.put('/api/me/profile', json={'name':'Test team','skills':['Analysis']})
        self.other.put('/api/me/profile', json={'name':'Other team','skills':['Analysis']})
        self.task = self.owner.post('/api/me/tasks', json={'topic':'Retail','card':{'title':'Reduce waste'},'confirmed_fields':[]}).json()
        self.base = f"/api/me/tasks/{self.task['id']}"

    def publish(self):
        self.assertEqual(self.owner.post(self.base+'/publish').status_code,200)

    def photograph(self):
        buf = io.BytesIO(); exif=Image.Exif();exif[270]='Private metadata';exif[274]=6
        Image.new('RGB',(1800,1000),'#6688aa').save(buf,'JPEG',exif=exif)
        response = self.owner.post(self.base+'/images',content=buf.getvalue())
        self.assertEqual(response.status_code,201,response.text)
        return response.json()['images']

    def start(self):
        self.publish()
        response = self.team.post(f"/api/catalog/tasks/{self.task['id']}/conversation")
        self.assertEqual(response.status_code,200,response.text)
        return f"/api/me/conversations/{response.json()['id']}"

    def test_photo_lifecycle_privacy_cover_and_limit(self):
        images = self.photograph(); url=images[0]['url']
        self.assertEqual(self.guest.get(url).status_code,401)
        self.assertEqual(self.other.get(url).status_code,404)
        photo=self.owner.get(url);self.assertEqual(photo.headers['cache-control'],'no-store')
        with Image.open(io.BytesIO(photo.content)) as decoded:
            self.assertEqual(decoded.format,'WEBP');self.assertLessEqual(max(decoded.size),1600)
            self.assertGreater(decoded.height,decoded.width);self.assertFalse(decoded.getexif())
        for _ in range(4): images=self.photograph()
        self.assertEqual(len(images),5)
        extra=io.BytesIO();Image.new('RGB',(2,2)).save(extra,'PNG')
        self.assertEqual(self.owner.post(self.base+'/images',content=extra.getvalue()).status_code,409)
        new=images[-1]['id'];changed=self.owner.patch(self.base+'/images/'+new).json()['images']
        self.assertEqual(changed[0]['id'],new);self.assertEqual(sum(i['is_cover'] for i in changed),1)
        self.publish();self.assertEqual(self.guest.get(url).status_code,200)
        public=self.guest.get('/api/catalog/tasks').json()['tasks'][0]
        self.assertEqual(public['images'][0]['id'],new);self.assertEqual(public['score'],0)
        deleted=self.owner.delete(self.base+'/images/'+new).json()['images']
        self.assertEqual(len(deleted),4);self.assertTrue(deleted[0]['is_cover'])
        self.assertEqual(self.guest.get('/api/task-images/'+new).status_code,404)
        init_db();self.assertEqual(len(self.owner.get(self.base).json()['images']),4)

    def test_photo_validation_ownership_and_csrf(self):
        self.assertEqual(self.owner.post(self.base+'/images',content=b'<svg/>').status_code,422)
        self.assertEqual(self.owner.post(self.base+'/images',content=b'a'*(3*1024*1024+1)).status_code,413)
        self.assertEqual(self.owner.post(self.base+'/images',content=b'x',headers={'X-CSRF-Token':'bad'}).status_code,403)
        self.assertEqual(self.other.post(self.base+'/images',content=b'x').status_code,403)
        self.assertEqual(self.guest.post(self.base+'/images',content=b'x').status_code,401)
        images=self.photograph()
        second=self.owner.post('/api/me/tasks',json={'topic':'Other','card':{'title':'Other task'}}).json()
        self.assertEqual(self.owner.delete(f"/api/me/tasks/{second['id']}/images/{images[0]['id']}").status_code,404)
        self.assertEqual(self.owner.patch(self.base+'/images/'+images[0]['id'],headers={'X-CSRF-Token':'bad'}).status_code,403)

    def test_contact_opt_in_and_hidden_phone(self):
        endpoint=self.base+'/contact'
        self.assertEqual(self.owner.put(endpoint,json={'phone':'+7 (700) 123-45-67','enabled':False}).json()['phone'],'77001234567')
        self.publish();self.assertEqual(self.guest.get('/api/catalog/tasks').json()['tasks'][0]['whatsapp_url'],'')
        self.assertNotIn('77001234567',self.guest.get(f"/api/catalog/tasks/{self.task['id']}").text)
        self.owner.put(endpoint,json={'phone':'77001234567','enabled':True})
        self.assertEqual(self.guest.get('/api/catalog/tasks').json()['tasks'][0]['whatsapp_url'],'https://wa.me/77001234567')
        for phone in ['', '0077001234567', 'javascript:alert(1)', '+123', '12345678&x=1']:
            self.assertEqual(self.owner.put(endpoint,json={'phone':phone,'enabled':True}).status_code,422)
        self.assertEqual(self.other.get(endpoint).status_code,403)
        self.assertEqual(self.owner.put(endpoint,json={'phone':'77001234567','enabled':True},headers={'X-CSRF-Token':'bad'}).status_code,403)

    def test_message_two_sides_read_state_and_idempotency(self):
        base=self.start();payload={'text':'Hello, can we discuss the available data?','request_id':str(uuid4())}
        response=self.team.post(base+'/messages',json=payload);self.assertEqual(response.status_code,200,response.text)
        sent=response.json();self.assertTrue(sent['mine'])
        self.assertEqual(self.team.post(base+'/messages',json=payload).json()['id'],sent['id'])
        self.assertEqual(self.team.post(base+'/messages',json={**payload,'text':'Changed text'}).status_code,409)
        inbox=self.owner.get('/api/me/conversations').json()['conversations'];self.assertEqual(inbox[0]['unread'],1)
        self.assertNotIn('email',str(inbox));self.assertEqual(inbox[0]['peer_name'],'Test team')
        incoming=self.owner.get(base+'/messages').json();self.assertFalse(incoming['messages'][0]['mine'])
        self.assertEqual(self.owner.get('/api/me/conversations').json()['conversations'][0]['unread'],1)
        self.owner.post(base+'/read',json={'through_id':sent['id']})
        self.assertEqual(self.owner.get('/api/me/conversations').json()['conversations'][0]['unread'],0)
        reply=self.owner.post(base+'/messages',json={'text':'Yes, let us discuss it here.','request_id':str(uuid4())}).json()
        self.assertEqual(len(self.team.get(base+'/messages?after_id='+str(sent['id'])).json()['messages']),1)
        self.assertEqual(self.team.get('/api/me/conversations').json()['conversations'][0]['unread'],1)
        init_db();self.assertEqual(self.team.get(base+'/messages').json()['messages'][-1]['id'],reply['id'])

    def test_message_access_validation_and_separate_team_threads(self):
        self.assertEqual(self.team.post(f"/api/catalog/tasks/{self.task['id']}/conversation").status_code,404)
        base=self.start()
        second=self.other.post(f"/api/catalog/tasks/{self.task['id']}/conversation").json()['id']
        self.assertNotEqual(base,f'/api/me/conversations/{second}')
        for client in (self.other,self.guest):
            self.assertIn(client.get(base+'/messages').status_code,(401,404))
            self.assertIn(client.post(base+'/messages',json={'text':'unauthorized','request_id':str(uuid4())}).status_code,(401,404))
        self.assertEqual(self.other.post(base+'/read',json={'through_id':1}).status_code,404)
        self.assertEqual(self.team.post(base+'/messages',json={'text':'   ','request_id':str(uuid4())}).status_code,422)
        self.assertEqual(self.team.post(base+'/messages',json={'text':'x'*4001,'request_id':str(uuid4())}).status_code,422)
        self.assertEqual(self.team.post(base+'/messages',json={'text':'ok','request_id':str(uuid4())},headers={'X-CSRF-Token':'bad'}).status_code,403)
        sent=self.other.post(f'/api/me/conversations/{second}/messages',json={'text':'Separate conversation','request_id':str(uuid4())}).json()
        self.assertEqual(self.owner.post(base+'/read',json={'through_id':sent['id']}).status_code,422)
        self.assertEqual(self.guest.get('/api/me/conversations').status_code,401)

    def test_business_opens_proposal_conversation_and_reuses_thread(self):
        base=self.start()
        proposal=self.team.post(f"/api/catalog/tasks/{self.task['id']}/proposals",json={'idea':'Investigate the causes','plan':'Analyze available data','duration_days':14,'prototype_url':'https://example.org/demo'}).json()
        result=self.owner.post(f"/api/me/proposals/{proposal['id']}/conversation")
        self.assertEqual(result.status_code,200,result.text);self.assertEqual(base,f"/api/me/conversations/{result.json()['id']}")
        self.assertEqual(self.other.post(f"/api/me/proposals/{proposal['id']}/conversation").status_code,403)
        self.assertEqual(self.owner.get(self.base+'/proposals').json()['proposals'][0]['status'],'pending')

    def test_pagination_rate_limit_and_monotonic_read_cursor(self):
        base=self.start();cid=int(base.split('/')[-1]);uid=self.team.get('/api/auth/me').json()['user']['id']
        with connection() as db:
            for i in range(105):
                db.execute('INSERT INTO direct_messages(conversation_id,sender_id,request_id,text,created_at) VALUES(?,?,?,?,?)',(cid,uid,str(uuid4()),str(i),now()))
        first=self.owner.get(base+'/messages').json();self.assertEqual(len(first['messages']),100);self.assertTrue(first['has_more'])
        last=self.owner.get(base+'/messages?after_id='+str(first['messages'][-1]['id'])).json();self.assertEqual(len(last['messages']),5);self.assertFalse(last['has_more'])
        self.owner.post(base+'/read',json={'through_id':last['messages'][-1]['id']})
        self.owner.post(base+'/read',json={'through_id':first['messages'][0]['id']})
        self.assertEqual(self.owner.get('/api/me/conversations').json()['conversations'][0]['unread'],0)
        self.assertEqual(self.team.post(base+'/messages',json={'text':'Too many','request_id':str(uuid4())}).status_code,429)


if __name__ == '__main__':
    unittest.main()
