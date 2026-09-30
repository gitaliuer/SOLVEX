import asyncio
import copy
import json
import os
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app
from app.db import connection
from app.ai.research import extract, public_url, analyze
from app.ai.service import AIServiceError
from app.routes.research import agent_evidence


def result(business=None):
    return {'sources':[{'id':'s1','url':'https://example.org/paper','title':'Synthetic source','domain':'example.org','accessed_at':'2026-09-30T00:00:00+00:00','published_at':None}],
            'passages':[{'id':'e1','text':'Synthetic evidence: counting methods affect discrepancies.','source_ids':['s1']}],
            'insights':[{'factor':'Counting coverage','category':'industry','evidence_ids':['e1'],'business_ids':[],
                         'why':'Relevant to unexplained discrepancies','hypothesis':'Counting coverage may be incomplete',
                         'limitations':'Synthetic test fixture, no real research','question':'Which locations are counted?'}],
            'business_data':business or {}}


class ResearchTest(unittest.TestCase):
    def setUp(self):
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        directory=self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.dict(os.environ,{'DATABASE_PATH':str(Path(directory)/'test.db')}))
        self.clients={};self.headers={}
        for name,role in [('owner','BUSINESS'),('other','BUSINESS'),('team','TEAM')]:
            client=self.stack.enter_context(TestClient(app));self.clients[name]=client
            response=client.post('/api/auth/register',json={'email':name+'@example.org','password':'long-test-password','role':role})
            self.assertEqual(response.status_code,201)
            self.headers[name]={'X-CSRF-Token':response.json()['csrf_token']}
        self.guest=self.stack.enter_context(TestClient(app))
        self.task=self.call('owner','post','/api/me/tasks',{'topic':'Retail','card':{'title':'Warehouse discrepancies','data':'Weekly counts'},'confirmed_fields':['data']},201)
        self.path=f"/api/me/tasks/{self.task['id']}"
        self.payload={'query':'Warehouse discrepancies counting methods','locale':'en','expected_revision':0}
        self.mock=self.stack.enter_context(patch('app.routes.research.analyze',new_callable=AsyncMock))
        async def fixture(query,business,locale):return result(business)
        self.mock.side_effect=fixture

    def call(self,actor,method,path,payload=None,status=200):
        response=getattr(self.clients[actor],method)(path,headers=self.headers[actor],**({'json':payload} if payload is not None else {}))
        self.assertEqual(response.status_code,status,response.text);return response.json()

    def run_search(self,**kwargs):
        return self.call('owner','post',self.path+'/research',{**self.payload,**kwargs})

    def test_access_csrf_cache_and_language(self):
        self.assertEqual(self.guest.get(self.path+'/research').status_code,401)
        self.call('other','get',self.path+'/research',status=404)
        self.call('team','get',self.path+'/research',status=403)
        self.assertEqual(self.clients['owner'].post(self.path+'/research',json=self.payload).status_code,403)
        first=self.run_search();second=self.run_search()
        self.assertEqual(first['report']['id'],second['report']['id']);self.assertEqual(self.mock.await_count,1)
        self.run_search(locale='ru');self.assertEqual(self.mock.await_count,2)
        self.assertEqual(self.call('owner','get',self.path+'/research?locale=en')['report']['id'],first['report']['id'])
        self.assertEqual(self.clients['owner'].get(self.path+'/research').headers['cache-control'],'no-store')
        self.call('owner','post',self.path+'/research',{**self.payload,'expected_revision':99},409)
        self.run_search(refresh=True);self.assertEqual(self.mock.await_count,3)

    def test_board_is_private_idempotent_and_does_not_change_card(self):
        report=self.run_search()['report'];payload={'run_id':report['id'],'insight_index':0}
        for _ in range(2):saved=self.call('owner','post',self.path+'/evidence',payload)['saved']
        self.assertEqual(len(saved),1)
        self.call('other','post',self.path+'/evidence',payload,404)
        other=self.call('other','post','/api/me/tasks',{'topic':'Other','card':{'title':'Another task'},'confirmed_fields':[]},201)
        self.call('other','post',f"/api/me/tasks/{other['id']}/evidence",payload,404)
        fresh=self.call('owner','get',self.path)
        for key in ['card','score','confirmed_fields','revision']:self.assertEqual(fresh[key],self.task[key])
        with connection() as db:
            self.assertEqual(len(agent_evidence(db,fresh)),1)
        self.call('owner','delete',self.path+'/evidence/'+str(saved[0]['id']))
        self.assertEqual(self.call('owner','get',self.path+'/research')['saved'],[])

    def test_stale_results_preserved_but_excluded_from_agent(self):
        report=self.run_search()['report'];self.call('owner','post',self.path+'/evidence',{'run_id':report['id'],'insight_index':0})
        edited=self.call('owner','put',self.path,{'topic':'Retail','card':{'title':'Different problem'},'confirmed_fields':[],'expected_revision':0})
        snapshot=self.call('owner','get',self.path+'/research?locale=en')
        self.assertTrue(snapshot['report']['stale']);self.assertTrue(snapshot['saved'][0]['stale'])
        with connection() as db:self.assertEqual(agent_evidence(db,edited),[])

    def test_failure_keeps_prior_report_and_refresh_is_limited(self):
        first=self.run_search()['report']['id']
        self.mock.side_effect=AIServiceError('AI_UNAVAILABLE','Synthetic outage')
        for _ in range(5):self.call('owner','post',self.path+'/research',{**self.payload,'refresh':True},503)
        data=self.call('owner','get',self.path+'/research?locale=en')
        self.assertEqual(data['report']['id'],first);self.assertEqual(data['run']['status'],'failed')
        self.call('owner','post',self.path+'/research',{**self.payload,'refresh':True},429)
        self.assertEqual(self.run_search()['report']['id'],first)

    def test_pending_lock_expiry_and_changed_during_search(self):
        with connection() as db:
            db.execute("INSERT INTO research_runs(id,task_id,user_id,locale,query,digest,status,started_at) VALUES(?,?,?,?,?,?,'pending',?)",
                       ('pending',self.task['id'],1,'en','query','digest','2099-01-01T00:00:00+00:00'))
        self.call('owner','post',self.path+'/research',self.payload,409)
        with connection() as db:db.execute("UPDATE research_runs SET started_at='2020-01-01T00:00:00+00:00' WHERE id='pending'")
        async def change(query,business,locale):
            with connection() as db:db.execute('UPDATE tasks SET topic=? WHERE id=?',('Changed topic',self.task['id']))
            return result(business)
        self.mock.side_effect=change
        self.assertTrue(self.run_search()['report']['stale'])

    def test_empty_sources_are_honest_and_saved_context_reaches_agent(self):
        self.mock.side_effect=None;self.mock.return_value={'sources':[],'passages':[],'insights':[],'business_data':{}}
        empty=self.run_search()['report'];self.assertEqual(empty['sources'],[])
        self.call('owner','post',self.path+'/evidence',{'run_id':empty['id'],'insight_index':0},404)
        self.mock.return_value=result();report=self.run_search(refresh=True)['report']
        self.call('owner','post',self.path+'/evidence',{'run_id':report['id'],'insight_index':0})
        with patch('app.routes.agent.respond',new_callable=AsyncMock) as respond:
            respond.return_value={'text':'Which locations are counted?','updates':{}}
            self.call('owner','post',f"/api/me/agent/{self.task['id']}/messages",{'request_id':str(uuid4()),'revision':0,'text':'Continue the discussion','locale':'en'})
            self.assertEqual(respond.call_args.args[0]['research_context'][0]['factor'],'Counting coverage')


class ResearchGroundingTest(unittest.IsolatedAsyncioTestCase):
    async def test_hypotheses_never_become_allowed_card_sources(self):
        from app.ai.agent import respond
        from app.schemas import Card
        task={'card':Card(title='Warehouse discrepancies').model_dump(),'status':'draft','locale':'en',
              'research_context':[{'hypothesis':'Ventilation is untested','question':'What data is available?'}]}
        messages=[{'id':1,'role':'user','text':'Warehouse discrepancies'},{'id':2,'role':'assistant','text':'Which data?'},
                  {'id':3,'role':'user','text':'Weekly counts'}]
        async def model(instructions,content,schema,name):
            self.assertNotIn('Ventilation is untested',list(content['sources'].values()))
            self.assertIn('never company facts',instructions)
            # A fabricated evidence ID cannot pass the server's card validation.
            return {'reply':'Let us check the coverage.','questions':[],
                    'card':{key:['research:1'] if key=='context' else [] for key in task['card']}}
        with patch('app.ai.agent._model_json',side_effect=model):
            with self.assertRaises(AIServiceError):await respond(task,messages)

    async def test_saved_question_selection_and_answered_question_can_be_skipped(self):
        from app.ai.agent import respond
        from app.schemas import Card
        question='Which warehouse locations are counted?'
        task={'card':Card().model_dump(),'status':'draft','locale':'en',
              'research_context':[{'question':question,'locale':'en'}]}
        messages=[{'id':1,'role':'assistant','text':question},{'id':2,'role':'user','text':'All locations are counted.'}]
        async def model(instructions,content,schema,name):
            self.assertEqual(schema['properties']['questions']['items']['enum'],[question])
            return {'reply':'All locations are included.','questions':[],'card':{key:[] for key in task['card']}}
        with patch('app.ai.agent._model_json',side_effect=model):
            self.assertNotIn('?',(await respond(task,messages))['text'])

    def test_only_real_citation_metadata_and_safe_urls(self):
        text='A sourced statement about counting. [one](https://example.org/a) [two](https://example.org/b)'
        a=text.index('[one]');b=text.index('[two]')
        response={'status':'completed','output':[{'type':'web_search_call','status':'completed'},
            {'type':'message','content':[{'type':'output_text','text':text,'annotations':[
                {'type':'url_citation','url':'https://example.org/a','title':'A','start_index':a,'end_index':b-1},
                {'type':'url_citation','url':'https://example.org/b','title':'B','start_index':b,'end_index':len(text)}]}]}]}
        grounded=extract(response)
        self.assertEqual(len(grounded['passages']),1);self.assertEqual(grounded['passages'][0]['source_ids'],['s1','s2'])
        for url in ['javascript:alert(1)','http://127.0.0.1/a','http://localhost/a','https://user:pass@example.org/a','http://test.local/a']:
            self.assertIsNone(public_url(url))
        response['output'][1]['content'][0]['annotations']=[]
        self.assertEqual(extract(response)['sources'],[])
        response['output']=[]
        with self.assertRaises(AIServiceError):extract(response)

    async def test_analysis_rejects_fabricated_evidence_and_business_ids(self):
        grounded=result();raw={'insights':grounded['insights']}
        with patch('app.ai.research.search_web',new_callable=AsyncMock,return_value={k:grounded[k] for k in ['sources','passages']}),patch('app.ai.research._model_json',new_callable=AsyncMock) as model:
            model.return_value=copy.deepcopy(raw)
            await analyze('query',{'card:need':{'text':'Goal only','confirmed':False}},'en')
            model.return_value['insights'][0]['business_ids']=['card:need']
            with self.assertRaises(AIServiceError):await analyze('query',{'card:need':{'text':'Goal only','confirmed':False}},'en')
            model.return_value=copy.deepcopy(raw);model.return_value['insights'][0]['evidence_ids']=['invented']
            with self.assertRaises(AIServiceError):await analyze('query',{},'en')


if __name__=='__main__':unittest.main()
