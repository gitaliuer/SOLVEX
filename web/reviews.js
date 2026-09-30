"use strict";

const reviewResets = new WeakMap();
window.addEventListener('solvex:language', () => document.querySelectorAll('.proposal-review').forEach(node => reviewResets.get(node)?.()));

function renderComparison(proposals, teams) {
  const target = $("proposal-comparison"); target.replaceChildren(); target.hidden = !proposals.length;
  if (!proposals.length) return;
  const heading = el("div", null, "comparison-heading");
  heading.append(el("span", SolvexI18n.text("Ваш следующий шаг"), "eyebrow"), el("h2", SolvexI18n.text("Разные подходы. Ясный выбор.")),
    el("p", SolvexI18n.text("Сравните предложения и уточните детали. Сроки и опыт указаны самими командами."))); target.append(heading);
  const scroll = el("div", null, "comparison-scroll"); scroll.tabIndex = 0;
  scroll.setAttribute("role", "region"); SolvexI18n.attribute(scroll,"aria-label",SolvexI18n.text("Сравнение предложений"));
  const table = el("table"), caption = el("caption", SolvexI18n.text("Сравнение предложений")); caption.className = "sr-only"; table.append(caption);
  const head = el("thead"), row = el("tr");
  for (const title of [SolvexI18n.text("Команда"), SolvexI18n.text("Срок"), SolvexI18n.text("Навыки"), SolvexI18n.text("Решение"), SolvexI18n.text("Предложение")]) { const cell = el("th", title); cell.scope = "col"; row.append(cell); }
  head.append(row); table.append(head); const body = el("tbody");
  for (const p of proposals) {
    const team = teams.find(t => t.id === p.team_id), line = el("tr");
    line.append(el("td", team?.name || SolvexI18n.text("Команда")), el("td", SolvexI18n.combine(p.duration_days,SolvexI18n.text(" дн."))), el("td", team?.skills.join(", ") || SolvexI18n.text("Не указано")),
      el("td", p.status === "selected" ? SolvexI18n.text("Выбрана") : p.status === "rejected" ? SolvexI18n.text("Отклонена") : SolvexI18n.text("Ожидает решения")));
    const cell = el("td"), button = el("button", SolvexI18n.text("К деталям ↓"), "text-button"); button.type = "button";
    button.onclick = () => reveal($("proposal-card-" + p.id)); cell.append(button); line.append(cell); body.append(line);
  }
  table.append(body); scroll.append(table); target.append(scroll);
}
function attachReview(article, proposal, taskId) {
  const details = el("details", null, "proposal-review"), summary = el("summary", SolvexI18n.text("✳ Разобрать с AI Agent"));
  const content = el("div", null, "review-content"), button = el("button", SolvexI18n.text("Подготовить разбор"), "secondary"), status = el("p", "", "hint");
  const output = el("div"); button.type = "button";
  content.append(el("p", SolvexI18n.text("AI выделит подходящие фрагменты предложения и вопросы для обсуждения. Проверьте выводы перед решением."), "hint"), button, status, output);
  details.append(summary, content); article.append(details);
  let generation = 0, loadedLocale = null;
  function valid(locale, run) { return article.isConnected && state.currentView === "business" && $("business-task").value === taskId && locale === SolvexI18n.locale && run === generation; }
  function display(data) {
    output.replaceChildren();
    if (!data.review) return;
    if (data.stale) { output.append(el("p", SolvexI18n.text("Карточка изменилась. Этот разбор устарел — обновите его."), "review-stale")); SolvexI18n.set(button,SolvexI18n.text("Обновить разбор")); }
    else { SolvexI18n.set(button,SolvexI18n.text("Разбор сохранён")); button.disabled = true; }
    output.append(el("h4", SolvexI18n.text("Что связано с вашей задачей")));
    if (!data.review.strengths.length) output.append(el("p", SolvexI18n.text("Явных соответствий не выделено. Обсудите подход с командой.")));
    for (const item of data.review.strengths) {
      const block = el("div", null, "review-evidence"); block.append(el("span", FIELDS[item.task_field], "eyebrow"),
        el("p", item.requirement, "review-requirement"), el("blockquote", item.quote)); output.append(block);
    }
    output.append(el("h4", SolvexI18n.text("Что спросить у команды")));
    const list = el("ol"); for (const question of data.review.questions) list.append(el("li", question)); output.append(list);
    output.append(el("p", SolvexI18n.text("Цитаты — из отклика. Соответствие и вопросы предлагает AI; это не проверка опыта и не рекомендация исполнителя."), "hint"));
  }
  details.addEventListener("toggle", async () => {
    if (!details.open || loadedLocale === SolvexI18n.locale) return;
    const locale = SolvexI18n.locale, run = ++generation; SolvexI18n.set(status,SolvexI18n.text("Загружаем сохранённый разбор…"));
    try {
      const data = await api("/api/me/proposals/" + proposal.id + "/review?locale=" + locale);
      if (!valid(locale, run)) return;
      loadedLocale = locale; display(data); SolvexI18n.set(status,"");
    } catch (error) { if (valid(locale, run)) SolvexI18n.set(status,error.message); }
  });
  button.addEventListener("click", async () => {
    const locale = SolvexI18n.locale, run = ++generation;
    button.disabled = true; button.setAttribute("aria-busy", "true"); SolvexI18n.set(status,SolvexI18n.text("AI читает предложение и вашу задачу…"));
    try {
      const data = await api("/api/me/proposals/" + proposal.id + "/review", "POST", {locale}, 55000);
      if (!valid(locale, run)) return;
      display(data); SolvexI18n.set(status,SolvexI18n.text("Разбор сохранён. Решение принимаете вы."));
    } catch (error) { if (valid(locale, run)) { SolvexI18n.set(status,error.message); button.disabled = false; } }
    finally { button.removeAttribute("aria-busy"); }
  });
  reviewResets.set(details, () => {
    generation++; loadedLocale = null; output.replaceChildren(); details.open = false;
    button.disabled = false; SolvexI18n.set(button,SolvexI18n.text("Подготовить разбор")); SolvexI18n.set(status,"");
  });
}
