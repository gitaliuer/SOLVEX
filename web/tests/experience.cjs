// Real accounts, database and ownership. Only AI responses are isolated fixtures.
// Run against a disposable local DATABASE_PATH; creates synthetic test accounts.
const {chromium} = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const base = process.env.UI_TEST_URL || "http://127.0.0.1:8010";
assert(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use a disposable local server");
const out = path.join(os.tmpdir(), "solvex-experience");
fs.mkdirSync(out, {recursive:true});
const password = "synthetic-test-password";
const stamp = Date.now();

(async () => {
  const browser = await chromium.launch({channel:"msedge", headless:true});
  const errors = [];
  const business = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:"reduce"});
  const team = await browser.newContext({viewport:{width:1280,height:900}, reducedMotion:"reduce"});
  const page = await business.newPage(), teamPage = await team.newPage();
  for (const p of [page, teamPage]) p.on("pageerror", error => errors.push(error.message));
  async function noOverflow(p) {
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal overflow");
  }
  async function register(p, role, prefix) {
    await p.goto(base);
    await p.locator('.hero-actions [data-role="' + role + '"]').click();
    await p.locator("#auth-email").fill(prefix + stamp + "@example.org");
    await p.locator("#auth-password").fill(password);
    await p.locator("#auth-submit").click();
    await p.waitForURL("**/app**");
    await p.waitForFunction(() => !document.body.classList.contains("booting"));
  }
  async function waitText(p, selector, text) {
    await p.waitForFunction(({selector,text}) => document.querySelector(selector)?.textContent.includes(text), {selector,text});
  }
  try {
    await page.goto(base + "/static/tests/ui.html");
    await page.waitForFunction(() => /Завершено|ERROR/.test(document.getElementById("results").textContent));
    const isolated = await page.locator("#results").innerText();
    console.log(isolated); assert(!/FAIL|ERROR/.test(isolated), "Editor regressions");
    await page.goto(base);
    await page.locator('[data-scenario="education"]').click();
    assert((await page.locator("#scenario-text").innerText()).includes("консультации"));
    await page.locator('[data-scenario="retail"]').click();
    assert.equal(await page.locator(".motion-toggle").getAttribute("aria-pressed"), "true");
    for (const width of [1440,1280,768,390,375]) {
      await page.setViewportSize({width,height:width<600?844:1000});
      await noOverflow(page);
      if (width===1440 || width===390) {
        await page.screenshot({path:path.join(out, width===1440?"landing-desktop.png":"landing-mobile.png"),fullPage:true});
      }
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-auth="login"]').first().click();
    await page.locator("#auth-email").fill("missing@example.org");
    await page.locator("#auth-password").fill("wrong-password");
    await page.locator("#auth-submit").click();
    await waitText(page,"#auth-error","Неверный");
    assert(await page.locator(".auth-dialog").evaluate(node => node.open));
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".auth-dialog").evaluate(node => node.open), false);
    console.log("PASS landing: responsive widths, scenarios, reduced motion, real invalid login, Escape");

    await register(page,"BUSINESS","business");
    await page.screenshot({path:path.join(out,"workspace-desktop.png"),fullPage:true});
    await page.locator("#topic").fill("Ритейл");
    await page.locator("#draft").fill("В магазине остаются продукты и растут списания.");
    await page.locator("#manual-card").click();
    const title = "Проверка SOLVEX " + stamp;
    await page.locator("#field-title").fill(title);
    await page.locator("#field-need").fill("Разобраться в причинах списаний");
    await page.locator("#field-users").fill("Менеджеры магазина");
    for (const key of ["context","need","users"]) await page.locator("#confirm-"+key).check();
    await page.locator("#save").click();
    await waitText(page,"#notice","Карточка сохранена");
    assert.equal(await page.locator("#score").innerText(),"30");
    const task = (await (await business.request.get(base+"/api/me/tasks")).json()).tasks[0];
    await page.reload();
    await page.locator('nav [data-view="my-tasks"]').click();
    await page.locator("#my-task-list button").first().click();
    await page.locator("#field-title").waitFor();
    assert.equal(await page.locator("#field-title").inputValue(),title);
    await page.locator("#field-context").fill("Уточнённые сведения о списаниях магазина");
    assert.equal(await page.locator("#confirm-context").isChecked(),false);
    await page.locator("#save").click();
    await waitText(page,"#notice","Карточка сохранена");
    assert.equal(await page.locator("#score").innerText(),"20");
    await page.locator("#confirm-context").check();
    await page.locator("#save").click();
    await waitText(page,"#notice","Рейтинг 30/100");
    const after = (await (await business.request.get(base+"/api/me/tasks")).json()).tasks;
    assert.equal(after.length,1); assert.equal(after[0].id,task.id);
    // Revoke the session externally. Unsaved work must survive same-user reauthentication.
    const auth = await (await business.request.get(base+"/api/auth/me")).json();
    await business.request.post(base+"/api/auth/logout",{headers:{"X-CSRF-Token":auth.csrf_token},data:{}});
    await page.locator("#field-title").fill(title+" — сохранённый ввод");
    await page.locator("#save").click();
    await page.locator("#auth-email").waitFor();
    await page.locator("#auth-email").fill("business"+stamp+"@example.org");
    await page.locator("#auth-password").fill(password);
    await page.locator("#auth-submit").click();
    await waitText(page,"#notice","Вход восстановлен");
    assert.equal(await page.locator("#field-title").inputValue(),title+" — сохранённый ввод");
    await page.locator("#publish").click();
    await waitText(page,"#notice","опубликована");
    assert.equal(await page.locator("#score").innerText(),"30");
    await page.setViewportSize({width:390,height:844});
    await noOverflow(page);
    await page.screenshot({path:path.join(out,"editor-mobile.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    console.log("PASS business: real registration, manual task, reload, same ID, score 30→20→30, session recovery, publication");

    await register(teamPage,"TEAM","team");
    await teamPage.locator('nav [data-view="team-profile"]').click();
    await teamPage.locator("#team-name").fill("Синтетическая команда "+stamp);
    await teamPage.locator("#team-skills").fill("Аналитика, UX");
    await teamPage.locator("#team-technologies").fill("Python, Figma");
    await teamPage.locator("#team-interests").fill("Ритейл");
    await teamPage.locator('nav [data-view="catalog"]').click();
    await teamPage.locator('nav [data-view="team-profile"]').click();
    assert.equal(await teamPage.locator("#team-skills").inputValue(),"Аналитика, UX");
    await teamPage.locator('#team-profile-form button[type="submit"]').click();
    await waitText(teamPage,"#notice","Профиль сохранён");
    await teamPage.locator('nav [data-view="catalog"]').click();
    await teamPage.locator("#catalog-search").fill(String(stamp));
    await teamPage.locator("#refresh").click();
    await waitText(teamPage,"#catalog-count","1");
    await teamPage.screenshot({path:path.join(out,"catalog-desktop.png"),fullPage:true});
    await teamPage.locator("#task-list button").first().click();
    await teamPage.locator("#proposal-idea").fill("Предлагаем исследовать причины списаний");
    await teamPage.locator("#proposal-plan").fill("Изучить отчёты и проверить гипотезы на данных");
    await teamPage.locator("#proposal-duration_days").fill("14");
    await teamPage.locator("#proposal-prototype_url").fill("https://example.org/synthetic-test");
    await teamPage.locator("#task-detail button[type=submit]").click();
    await waitText(teamPage,"#notice","Предложение отправлено");
    await teamPage.locator('nav [data-view="my-proposals"]').click();
    await waitText(teamPage,"#my-proposal-list","Ожидает решения");
    assert.equal((await team.request.get(base+"/api/me/tasks")).status(),403);
    await page.locator('nav [data-view="business"]').click();
    await page.locator("#proposal-list").getByRole("button",{name:"Выбрать",exact:true}).click();
    await page.locator("#proposal-list").getByRole("button",{name:"Подтвердить этап +10",exact:true}).click();
    await waitText(page,"#notice","Этап подтверждён");
    await teamPage.locator('nav [data-view="my-proposals"]').click();
    await waitText(teamPage,"#my-proposal-list","Этап подтверждён");
    await page.screenshot({path:path.join(out,"proposals-desktop.png"),fullPage:true});
    console.log("PASS team: profile, published catalog, own proposal, business decision, confirmed milestone");

    // Exercise current AI UI with explicitly synthetic responses, not a live AI claim.
    await page.route("**/api/me/ai/questions", route=>route.fulfill({json:{questions:[
      {id:"q1",field:"data",text:"Какие данные доступны?"},
      {id:"q2",field:"users",text:"Кто будет пользоваться решением?"},
      {id:"q3",field:"expected_result",text:"Какой результат нужен?"}
    ]}}));
    await page.route("**/api/me/ai/card", route=>route.fulfill({json:{card:{
      title:"Синтетическая AI-карточка",context:"Текст тестового примера",need:"",users:"",data:"",
      constraints:"",expected_result:"",success_criteria:"",contact:"",interaction_format:""
    },topic:"Ритейл"}}));
    await page.locator('nav [data-view="create"]').click();
    await page.locator("#new-task").click();
    await page.locator("#topic").fill("Ритейл");
    await page.locator("#draft").fill("В магазине растут списания. Хотим понять причины.");
    await page.locator("#ask").click();
    await page.locator("#answer-q3").waitFor();
    assert.equal(await page.locator("#question-list textarea").count(),3);
    await page.locator("#answer-q1").fill("Есть отчёты за месяц");
    await page.locator("#generate").click();
    await waitText(page,"#editor-title","Проверьте");
    assert.equal(await page.locator("#field-title").inputValue(),"Синтетическая AI-карточка");
    console.log("PASS AI UI: three questions, answer, editable card (mocked AI only)");
    page.once("dialog", dialog=>dialog.accept());
    await page.locator("#logout").click();
    await page.waitForURL(base+"/");
    assert.equal((await business.request.get(base+"/api/me/tasks")).status(),401);
    await page.goto(base+"/app");
    await page.locator("#auth-email").waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    console.log("PASS logout revokes cookie and protected app redirects guests");
    assert.deepEqual(errors, []);
    console.log("PASS no browser errors. Screenshots: "+out);
  } catch (error) {
    await page.screenshot({path:path.join(out,"failure-business.png"),fullPage:true}).catch(()=>{});
    await teamPage.screenshot({path:path.join(out,"failure-team.png"),fullPage:true}).catch(()=>{});
    throw error;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
