// Private project lifecycle using real routes and a disposable database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.UI_TEST_URL||'http://127.0.0.1:8010';
assert.equal(new URL(base).port,'8010');
const out=path.join(os.tmpdir(),'solvex-projects');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const business=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),team=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
 const page=await business.newPage(),tp=await team.newPage(),errors=[];
 for(const p of [page,tp])p.on('pageerror',e=>errors.push(e.message));
 const stamp=Date.now();
 async function register(ctx,role,name){const r=await ctx.request.post(base+'/api/auth/register',{data:{email:name+stamp+'@example.org',password:'synthetic-password',role}});assert.equal(r.status(),201);return (await r.json()).csrf_token;}
 async function request(ctx,token,url,method='post',data){const r=await ctx.request[method](base+url,{headers:{'X-CSRF-Token':token},data});assert(r.ok(),await r.text());return r.json();}
 async function refresh(p){await p.locator('#projects-refresh').click();await p.locator('#project-detail').waitFor({state:'visible'});}
 async function stage(p,status){await p.locator('.roadmap-stage.stage-'+status).first().waitFor();}
 async function save(p){await p.locator('.project-dialog button[type=submit]').click();await p.locator('.project-dialog').waitFor({state:'detached'});}
 async function overflow(p){assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow');}
 try{
  const csrf=await register(business,'BUSINESS','project-owner'),tc=await register(team,'TEAM','project-team');
  await request(team,tc,'/api/me/team','put',{name:'Solvex Lab',skills:['Analysis'],interests:[],technologies:['Python']});
  const task=await request(business,csrf,'/api/me/tasks','post',{topic:'Retail',card:{title:'Сократить потери на складе',need:'Понять причины списаний',expected_result:'Отчёт с проверяемыми выводами'},confirmed_fields:[]});
  await request(business,csrf,'/api/me/tasks/'+task.id+'/publish');
  const proposal=await request(team,tc,'/api/catalog/tasks/'+task.id+'/proposals','post',{idea:'Исследовать причины потерь',plan:'Проверить данные и подготовить отчёт',duration_days:14,prototype_url:'https://example.org/plan'});
  await request(business,csrf,'/api/me/proposals/'+proposal.id,'patch',{status:'selected'});
  await page.goto(base+'/app#business');await page.waitForFunction(()=>!document.body.classList.contains('booting'));
  await page.getByRole('button',{name:'Начать проект →',exact:true}).click();
  await page.locator('#project-detail').waitFor({state:'visible'});
  const project=(await request(business,csrf,'/api/me/projects','get')).projects[0];
  assert.equal(new URL(page.url()).hash,'#projects/'+project.id);
  await page.getByRole('button',{name:'Добавить этап',exact:true}).click();
  await page.locator('#project-input-title').fill('Аудит исходных данных');
  await page.locator('#project-input-description').fill('Подготовить отчёт о полноте данных и причинах списаний.');
  await page.locator('#project-input-due_date').fill('2026-12-01');
  await page.evaluate(()=>SolvexI18n.change('en'));
  assert.equal(await page.locator('#project-input-title').inputValue(),'Аудит исходных данных');
  assert.equal(await page.locator('#project-form-title').innerText(),'Add milestone');
  await save(page);await stage(page,'planned');
  await page.getByRole('button',{name:'Edit milestone',exact:true}).click();
  await page.locator('#project-input-description').fill('Подготовить отчёт о полноте данных и проверить период наблюдения.');await save(page);
  await page.reload();await page.locator('.roadmap-stage').waitFor();assert.equal(new URL(page.url()).hash,'#projects/'+project.id);
  await tp.goto(base+'/app#my-proposals');await tp.getByRole('button',{name:'Открыть проект →',exact:true}).click();await stage(tp,'planned');
  assert.equal(await tp.getByRole('button',{name:'Добавить этап',exact:true}).count(),0);
  await tp.getByRole('button',{name:'Взять в работу',exact:true}).click();await stage(tp,'in_progress');
  await tp.getByRole('button',{name:'Сдать результат',exact:true}).click();
  await tp.locator('#project-input-note').fill('Проверили данные за месяц, подготовили таблицу пропусков.');
  await tp.locator('#project-input-result_url').fill('https://example.org/first-report');await save(tp);await stage(tp,'review');
  await refresh(page);await stage(page,'review');
  await page.getByRole('button',{name:'Request changes',exact:true}).click();await page.locator('#project-input-note').fill('Добавьте описание периода наблюдения.');await save(page);await stage(page,'changes_requested');
  await refresh(tp);await stage(tp,'changes_requested');
  await tp.getByRole('button',{name:'Сдать результат',exact:true}).click();
  assert((await tp.locator('#project-input-note').inputValue()).includes('Проверили данные'));
  await tp.locator('#project-input-note').fill('Добавили описание периода наблюдения и обновили отчёт.');await save(tp);
  await refresh(page);await stage(page,'review');
  await page.getByRole('button',{name:'Accept delivery',exact:true}).click();await stage(page,'done');
  assert.equal((await request(team,tc,'/api/me/team','get')).team.points,10);
  await page.locator('#project-complete').click();await page.getByRole('button',{name:'Reopen project',exact:true}).waitFor();
  await page.locator('#project-complete').click();await page.getByRole('button',{name:'Add milestone',exact:true}).waitFor();
  // A stale form keeps user text after another session changes the project.
  await page.getByRole('button',{name:'Add milestone',exact:true}).click();
  await page.locator('#project-input-title').fill('Проверка рекомендаций');await page.locator('#project-input-description').fill('Сверить рекомендации с фактическими данными.');
  const current=await request(business,csrf,'/api/me/projects/'+project.id,'get');
  await request(business,csrf,'/api/me/projects/'+project.id+'/milestones','post',{expected_revision:current.revision,title:'Пилотное внедрение',description:'Проверить одну рекомендацию на ограниченном участке.'});
  await page.locator('.project-dialog button[type=submit]').click();await page.locator('.project-form-status').filter({hasText:'The project changed'}).waitFor();
  assert.equal(await page.locator('#project-input-title').inputValue(),'Проверка рекомендаций');
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel',exact:true}).click();await refresh(page);
  const stages=await page.locator('.roadmap-stage').count();assert.equal(stages,2);
  await page.locator('.project-history summary').click();
  assert((await page.locator('.project-history').innerText()).includes('Добавьте описание периода'));
  assert.equal(await page.locator('.project-history a[href="https://example.org/first-report"]').count(),2);
  await page.screenshot({path:path.join(out,'roadmap-desktop.png'),fullPage:true});
  for(const width of [390,375,320]){
   await page.setViewportSize({width,height:844});await overflow(page);
   await page.getByRole('button',{name:'Add milestone',exact:true}).click();await overflow(page);
   assert(await page.locator('.project-dialog button[type=submit]').isVisible());
   if(width===375)await page.screenshot({path:path.join(out,'milestone-mobile.png'),fullPage:true});
   await page.getByRole('button',{name:'Cancel',exact:true}).click();
   if(width===375)await page.screenshot({path:path.join(out,'roadmap-mobile.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS project creation, both roles, roadmap editing, delivery/revision/acceptance, points, completion/reopen, frozen agreement, deep links, history, stale form preservation, RU/EN and 320/375/390px');
  console.log('Screenshots: '+out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
