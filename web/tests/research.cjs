const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const base=process.env.UI_TEST_URL||'http://127.0.0.1:8010';assert.equal(new URL(base).port,'8010');
const out=path.join(os.tmpdir(),'solvex-research');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 async function waitText(selector,text){await page.waitForFunction(({selector,text})=>document.querySelector(selector)?.textContent.includes(text),{selector,text});}
 async function overflow(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');}
 try{
  let r=await context.request.post(base+'/api/auth/register',{data:{email:'research'+Date.now()+'@example.org',password:'synthetic-password',role:'BUSINESS'}});assert.equal(r.status(),201);const csrf=(await r.json()).csrf_token;
  async function api(url,method='get',data){const response=await context.request[method](base+url,{headers:{'X-CSRF-Token':csrf},data});assert(response.ok(),await response.text());return response.json();}
  const task=await api('/api/me/tasks','post',{topic:'Retail',card:{title:'Снизить расхождения складских остатков',need:'Установить причины расхождений',data:'Еженедельная инвентаризация'},confirmed_fields:['data']});
  const second=await api('/api/me/tasks','post',{topic:'Service',card:{title:'Ускорить обработку заявок'},confirmed_fields:[]});
  await page.goto(base+'/app#create');await page.waitForFunction(()=>!document.body.classList.contains('booting'));
  await page.evaluate(id=>openSavedTask(id),task.id);
  await page.locator('#chat-input').fill('Несохранённый ответ');
  await page.locator('#agent-research').click();await page.locator('#research-run:not([disabled])').waitFor();
  assert.equal(await page.locator('#research-task').inputValue(),String(task.id));
  await page.locator('#research-query').fill('Inventory discrepancy research and cycle counting');
  await page.locator('header [data-language]').selectOption('en');await page.locator('#research-run:not([disabled])').waitFor();
  assert.equal(await page.locator('#research-query').inputValue(),'Inventory discrepancy research and cycle counting');
  await page.locator('#research-run').click();await waitText('#research-status','Finding sources');
  await page.locator('nav [data-view="projects"]').click();
  await page.locator('nav [data-view="research"]').click();await waitText('#research-summary','Sources: 1');
  assert.equal(await page.locator('#research-insights .evidence-card').count(),1);
  assert(await page.locator('#research-insights .evidence-inline-sources a[href="https://example.org/synthetic-paper"]').first().isVisible());
  await page.getByRole('button',{name:'Add insight to challenge',exact:true}).click();await waitText('#evidence-count','1');
  let after=await api('/api/me/tasks/'+task.id);assert.deepEqual(after.card,task.card);assert.equal(after.score,task.score);assert.equal(after.revision,task.revision);
  await page.reload();await waitText('#evidence-count','1');
  await page.locator('#evidence-list>details>summary').click();assert((await page.locator('#evidence-list').innerText()).includes('HYPOTHESIS'));
  await page.locator('#research-insights .evidence-facts summary').click();assert((await page.locator('#research-insights').innerText()).includes('AI-generated source summary'));
  await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:path.join(out,'research-desktop.png'),fullPage:true});
  for(const width of [390,375,320]){await page.setViewportSize({width,height:844});await overflow();if(width===375)await page.screenshot({path:path.join(out,'research-mobile.png'),fullPage:true});}
  await page.setViewportSize({width:1440,height:1000});
  // Query drafts remain local to each challenge and language changes do not overwrite them.
  await page.locator('#research-query').fill('Custom unsent research query');
  await page.locator('#research-task').selectOption(String(second.id));await page.locator('#research-run:not([disabled])').waitFor();
  await page.locator('#research-task').selectOption(String(task.id));await page.locator('#research-run:not([disabled])').waitFor();assert.equal(await page.locator('#research-query').inputValue(),'Custom unsent research query');
  await page.locator('#research-query').fill('Synthetic failure for browser test');await page.locator('#research-run').click();await page.locator('#research-status.error').waitFor();assert.equal(await page.locator('#research-insights .evidence-card').count(),1);
  await api('/api/me/tasks/'+task.id,'put',{topic:'Retail',card:{...task.card,data:'Daily stock counts'},confirmed_fields:[],expected_revision:0});
  await page.locator('#research-reload').click();await waitText('#research-summary','The challenge changed');
  await page.locator('#evidence-list>details>summary').click();await waitText('#evidence-list','Outdated context');
  await page.getByRole('button',{name:'Remove from board',exact:true}).click();await waitText('#evidence-count','0');
  await page.locator('#research-query').fill('Synthetic empty result query');await page.locator('#research-run').click();await waitText('#research-summary','Sources: 0');await waitText('#research-insights','No material with verifiable links');
  await page.locator('header [data-language]').selectOption('ru');await page.locator('#research-run:not([disabled])').waitFor();await page.locator('#research-query').fill('Исследования складских остатков и инвентаризации');await page.locator('#research-run').click();await waitText('#research-summary','Источников: 1');
  assert((await page.locator('#research-insights').innerText()).includes('Охват инвентаризации'));
  await page.locator('#research-chat').click();assert.equal(await page.locator('#create').isVisible(),true);
  // Preservation while navigating without reload.
  await page.locator('#chat-input').fill('Ответ по охвату инвентаризации');await page.locator('#agent-research').click();await page.locator('#research-run:not([disabled])').waitFor();await page.locator('#research-chat').click();assert.equal(await page.locator('#chat-input').inputValue(),'Ответ по охвату инвентаризации');
  assert.deepEqual(errors,[]);console.log('PASS research: real persistence/ownership routes, pending recovery, citations, board add/remove, unchanged card/score, stale context, error/empty, RU/EN, per-task query drafts, chat preservation, 320/375/390px; AI is synthetic');console.log('Screenshots: '+out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
