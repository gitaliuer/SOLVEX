// Run against agent_server.py (port 8010), which owns a disposable database.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const base = process.env.UI_TEST_URL || 'http://127.0.0.1:8010';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const out = path.join(os.tmpdir(), 'solvex-matching'); fs.mkdirSync(out, {recursive:true});
const stamp = Date.now();
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const contexts = [], errors = [];
  async function account(name, role) {
    const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}); contexts.push(context);
    const response = await context.request.post(base+'/api/auth/register', {data:{email:name+stamp+'@example.org',password:'synthetic-password',role}});
    assert.equal(response.status(),201);
    const auth = await response.json();
    return {context,headers:{'X-CSRF-Token':auth.csrf_token}};
  }
  const business = await account('matching-business','BUSINESS');
  const page = await business.context.newPage(); page.on('pageerror', e=>errors.push(e.message));
  async function waitText(selector, value) {
    await page.waitForFunction(({selector,value})=>document.querySelector(selector)?.textContent.includes(value),{selector,value});
  }
  try {
    const tasks = [];
    for (const [topic,title,result] of [['Ритейл','Списания: от данных к решению','Нужен отчёт и дашборд на Python.'], ['Образование','Запись на консультации','Нужен дизайн интерфейса.']]) {
      const response = await business.context.request.post(base+'/api/me/tasks',{headers:business.headers,data:{topic,card:{title,need:'Разобраться в задаче бизнеса',expected_result:result},confirmed_fields:['expected_result']}});
      const task = await response.json(); tasks.push(task);
      assert.equal((await business.context.request.post(base+'/api/me/tasks/'+task.id+'/publish',{headers:business.headers})).status(),200);
    }
    const teams = [];
    for (const [name,skills,technologies,interests] of [
      ['NORTH DATA',['Аналитика','Визуализация'],['Python','SQL'],['Ритейл']],
      ['FRAME STUDIO',['UX','UI'],['Figma'],['Образование']],
      ['SIGNAL LAB',['Исследования'],['SQL'],['Ритейл']]]) {
      const owner = await account('matching-team'+teams.length,'TEAM');
      const response = await owner.context.request.put(base+'/api/me/team',{headers:owner.headers,data:{name:name+" "+stamp,skills,technologies,interests}});
      teams.push({...(await response.json()).team,owner});
    }
    await teams[0].owner.context.request.post(base+'/api/catalog/tasks/'+tasks[0].id+'/proposals',{
      headers:teams[0].owner.headers,data:{idea:'Исследовать причины списаний',plan:'Собрать отчёт и проверить показатели',duration_days:14,prototype_url:'https://example.org/synthetic'}});
    await page.goto(base+'/app#matches');
    await page.waitForFunction(()=>!document.querySelector('#matching-task').disabled);
    await page.locator('#matching-task').selectOption(String(tasks[0].id));
    await waitText('#matching-task-title', tasks[0].card.title);
    const north = page.locator('[data-team-id="'+teams[0].id+'"]');
    await north.locator('summary').click();
    assert((await north.innerText()).includes('Нужен отчёт и дашборд на Python.'));
    assert((await north.innerText()).includes('подтверждено вами'));
    await north.getByRole('button',{name:'☆ В избранное',exact:true}).click();
    await waitText('#matching-status','сохранена');
    await page.locator('[data-match-filter="saved"]').click();
    assert.equal(await page.locator('.matching-card').count(),1);
    await page.reload();
    await page.waitForFunction(()=>!document.querySelector('#matching-task').disabled);
    assert.equal(await page.locator('#matching-task').inputValue(),String(tasks[0].id));
    await page.locator('#matching-task').selectOption(String(tasks[0].id));
    await waitText('#matching-task-title', tasks[0].card.title);
    await page.locator('[data-match-filter="saved"]').click();
    assert.equal(await page.locator('.matching-card').count(),1);
    await page.locator('[data-match-filter="all"]').click();
    await page.locator('#matching-search').fill('Figma');
    assert(await page.locator('.matching-card').count()>=1);
    await page.locator('#matching-search').fill('FRAME STUDIO '+stamp);
    assert.equal(await page.locator('.matching-card').count(),1);
    assert((await page.locator('.matching-card').innerText()).includes('FRAME STUDIO'));
    await page.locator('#matching-search').fill('нет такой команды');
    assert(await page.locator('.matching-empty').isVisible());
    await page.getByRole('button',{name:'Посмотреть все команды',exact:true}).click();
    await page.locator('[data-match-filter="recommended"]').click();
    await north.locator('summary').click();
    await page.screenshot({path:path.join(out,'teams-desktop.png'),fullPage:true});
    await north.getByRole('button',{name:'Есть отклик →',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('#business-task').value===String(id),tasks[0].id);
    await waitText('#proposal-list','Исследовать причины списаний');
    assert((await page.locator('#proposal-list').innerText()).includes('Ожидает решения'));
    await page.locator('nav [data-view="matches"]').click();
    await waitText('#matching-task-title', tasks[0].card.title);
    await page.locator('#matching-chat').click();
    await page.locator('#chat-input').fill('Эту мысль нужно сохранить при переходах.');
    await page.locator('#find-teams').click();
    await waitText('#matching-task-title', tasks[0].card.title);
    await page.locator('#matching-chat').click();
    assert.equal(await page.locator('#chat-input').inputValue(),'Эту мысль нужно сохранить при переходах.');
    await page.locator('#chat-input').fill('');
    await page.locator('#find-teams').click();
    await waitText('#matching-task-title', tasks[0].card.title);
    // A delayed response for an earlier selected task must never overwrite the next task.
    await page.route('**/api/me/tasks/'+tasks[0].id+'/matches', async route=>{
      const response = await route.fetch(); await new Promise(resolve=>setTimeout(resolve,700)); await route.fulfill({response});
    });
    await page.locator('#matching-task').selectOption(String(tasks[1].id));
    await page.locator('#matching-task').selectOption(String(tasks[0].id));
    await page.locator('#matching-task').selectOption(String(tasks[1].id));
    await waitText('#matching-task-title', tasks[1].card.title);
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#matching-task-title').innerText(),tasks[1].card.title);
    await page.unrouteAll({behavior:'wait'});
    for (const width of [1280,1024,768,390,375]) {
      await page.setViewportSize({width,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width);
      if(width===390) await page.screenshot({path:path.join(out,'teams-mobile.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log('PASS matching: evidence, saved/reload, search/empty, correct proposal/task, unsent chat preserved, stale responses, mobile widths; '+out);
  } catch (error) {
    await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{}); throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
