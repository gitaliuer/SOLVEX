import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.db import connection


class ProjectsTest(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.dict(os.environ, {'DATABASE_PATH': str(Path(directory) / 'projects.db')}))
        self.clients = {}
        self.headers = {}
        for name, role in [('owner','BUSINESS'),('other','BUSINESS'),('team','TEAM'),('outsider','TEAM')]:
            client = self.stack.enter_context(TestClient(app))
            response = client.post('/api/auth/register', json={'email':name+'@example.org','password':'long-test-password','role':role})
            self.assertEqual(response.status_code, 201, response.text)
            self.clients[name] = client
            self.headers[name] = {'X-CSRF-Token': response.json()['csrf_token']}
        self.guest = self.stack.enter_context(TestClient(app))
        task = self.call('owner','post','/api/me/tasks',{'topic':'Retail','card':{'title':'Reduce waste','need':'Understand causes'},'confirmed_fields':[]},201)
        self.task_id = task['id']
        self.call('owner','post',f'/api/me/tasks/{self.task_id}/publish')
        self.call('team','put','/api/me/team',{'name':'Analysis team','skills':['Analysis'],'interests':[],'technologies':['Python']})
        self.proposal = self.call('team','post',f'/api/catalog/tasks/{self.task_id}/proposals',{'idea':'Study waste causes','plan':'Collect data and report findings','duration_days':14,'prototype_url':'https://example.org/proposal'},201)['id']
        self.create_path = f'/api/me/proposals/{self.proposal}/project'
        self.call('owner','patch',f'/api/me/proposals/{self.proposal}',{'status':'selected'})
        self.project = self.call('owner','post',self.create_path)
        self.path = '/api/me/projects/'+str(self.project['id'])

    def call(self, actor, method, path, payload=None, status=200):
        response = getattr(self.clients[actor],method)(path,headers=self.headers[actor],**({'json':payload} if payload is not None else {}))
        self.assertEqual(response.status_code,status,response.text)
        return response.json()

    def change(self,actor,path,payload,status=200,method='post'):
        data=self.call(actor,method,self.path+path,{'expected_revision':self.project['revision'],**payload},status)
        if status==200:self.project=data
        return data

    def add(self):
        self.change('owner','/milestones',{'title':'Data audit','description':'Report on data quality','due_date':'2026-12-01'})
        return self.project['milestones'][-1]['id']

    def test_private_access_and_idempotent_start(self):
        self.assertEqual(self.guest.get(self.path).status_code,401)
        self.assertEqual(self.clients['owner'].post(self.create_path).status_code,403)
        for actor in ['other','outsider']:
            self.call(actor,'get',self.path,status=404)
            self.assertEqual(self.call(actor,'get','/api/me/projects')['projects'],[])
        self.call('other','post',self.create_path,status=404)
        self.call('team','post',self.create_path,status=403)
        self.assertEqual(self.call('owner','post',self.create_path),self.project)
        self.assertEqual(self.call('team','get',self.path),self.project)
        self.assertEqual(len(self.call('owner','get','/api/me/projects')['projects']),1)
        self.assertEqual(self.clients['owner'].get(self.path).headers['cache-control'],'no-store')
        self.assertNotIn('owner_user_id',str(self.project))
        self.assertNotIn('@example.org',str(self.project))
        self.assertEqual(self.call('team','get','/api/me/proposals')['proposals'][0]['project_id'],self.project['id'])
        self.call('owner','patch',f'/api/me/proposals/{self.proposal}',{'status':'rejected'},409)
        self.call('owner','post',f'/api/me/proposals/{self.proposal}/milestones/confirm',status=409)

    def test_selected_only_and_frozen_agreement(self):
        with connection() as db:
            db.execute("UPDATE proposals SET status='pending' WHERE id=?",(self.proposal,))
            db.execute("UPDATE tasks SET card=? WHERE id=?",('{"title":"Changed later"}',self.task_id))
        self.call('owner','post',self.create_path,status=409)
        self.assertEqual(self.call('owner','get',self.path)['snapshot']['card']['title'],'Reduce waste')

    def test_delivery_feedback_acceptance_and_completion(self):
        self.change('owner','',{'status':'completed'},409,'patch')
        mid=self.add(); endpoint=f'/milestones/{mid}/action'
        self.change('team','/milestones',{'title':'Bad role','description':'No permission'},403)
        self.change('owner',endpoint,{'action':'submit','note':'Wrong role submission'},403)
        self.change('team',endpoint,{'action':'start'})
        self.change('owner',f'/milestones/{mid}',{'title':'Changed stage','description':'Cannot change started stage'},409,'put')
        self.change('team',endpoint,{'action':'submit','note':'Complete data audit','result_url':'https://example.org/report'})
        self.change('team',endpoint,{'action':'approve'},403)
        self.change('owner',endpoint,{'action':'revise','note':'Add missing dates'})
        self.change('team',endpoint,{'action':'submit','note':'Added dates and revised report'})
        self.change('owner',endpoint,{'action':'approve'})
        self.assertEqual(self.project['milestones'][0]['status'],'done')
        self.assertTrue(self.project['points_awarded'])
        self.assertEqual(len([e for e in self.project['events'] if e['kind']=='submit']),2)
        self.assertTrue(any(e['content'].get('note')=='Add missing dates' for e in self.project['events']))
        self.change('owner',endpoint,{'action':'approve'},409)
        second=self.add()
        self.change('team',f'/milestones/{second}/action',{'action':'submit','note':'Second report is ready'})
        self.change('owner',f'/milestones/{second}/action',{'action':'approve'})
        self.assertEqual(self.call('team','get','/api/me/team')['team']['points'],10)
        self.change('team','',{'status':'completed'},403,'patch')
        self.change('owner','',{'status':'completed'},method='patch')
        self.change('owner','/milestones',{'title':'Third stage','description':'Should not add'},409)
        self.change('owner','',{'status':'active'},method='patch')
        self.add()

    def test_validation_revision_and_stage_boundaries(self):
        mid=self.add()
        self.change('owner',f'/milestones/{mid}',{'title':'Updated title','description':'Updated expected report','due_date':None},method='put')
        self.assertIsNone(self.project['milestones'][0]['due_date'])
        self.call('owner','post',self.path+'/milestones',{'expected_revision':0,'title':'Stale change','description':'Keep current state'},409)
        self.change('owner','/milestones',{'title':'OK title','description':'OK description','due_date':'not-date'},422)
        self.change('team',f'/milestones/{mid}/action',{'action':'submit','note':'Complete data audit','result_url':'javascript:alert(1)'},422)
        self.change('team',f'/milestones/{mid}/action',{'action':'submit','note':'short'},422)
        self.change('team','/milestones/999999/action',{'action':'start'},404)
        with connection() as db:
            # An existing stage from a different project must also remain inaccessible.
            pid=db.execute('INSERT INTO projects(proposal_id,snapshot,created_at) SELECT id,?,? FROM proposals WHERE id!=? LIMIT 1',('{}','test',self.proposal)).lastrowid
            foreign=db.execute('INSERT INTO project_milestones(project_id,title,description) VALUES(?,?,?)',(pid,'Foreign stage','Private')).lastrowid
        self.change('team',f'/milestones/{foreign}/action',{'action':'start'},404)
        self.assertEqual(len(self.call('owner','get',self.path)['milestones']),1)

    def test_concurrent_acceptance_awards_once(self):
        mid=self.add();endpoint=f'/milestones/{mid}/action'
        self.change('team',endpoint,{'action':'submit','note':'Ready for acceptance'})
        revision=self.project['revision']
        def approve(_):
            return self.clients['owner'].post(self.path+endpoint,headers=self.headers['owner'],json={'expected_revision':revision,'action':'approve'}).status_code
        with ThreadPoolExecutor(max_workers=4) as executor:
            statuses=list(executor.map(approve,range(4)))
        self.assertEqual(sorted(statuses),[200,409,409,409])
        self.assertEqual(self.call('team','get','/api/me/team')['team']['points'],10)

    def test_legacy_points_not_awarded_twice(self):
        with connection() as db:
            db.execute('UPDATE proposals SET milestone_confirmed=1,points=10 WHERE id=?',(self.proposal,))
            db.execute('UPDATE teams SET points=10 WHERE id=(SELECT team_id FROM proposals WHERE id=?)',(self.proposal,))
        mid=self.add();endpoint=f'/milestones/{mid}/action'
        self.change('team',endpoint,{'action':'submit','note':'Delivery after legacy acceptance'})
        self.change('owner',endpoint,{'action':'approve'})
        self.assertEqual(self.call('team','get','/api/me/team')['team']['points'],10)


if __name__=='__main__':unittest.main()
