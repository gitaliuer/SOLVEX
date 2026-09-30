"use strict";

const matching = {generation:0, task:null, teams:[], filter:"recommended", limit:12, requestedId:null};
function rememberMatching() {
  try { sessionStorage.setItem("solvex-matching-" + state.user.id, JSON.stringify({task:matching.task?.id, filter:matching.filter})); } catch {}
}
function matchingStatus(text, error = false) {
  SolvexI18n.set($("matching-status"),text);
  $("matching-status").classList.toggle("error", error);
  $("matching-status").setAttribute("role", error ? "alert" : "status");
}
async function loadMatching(preferredId) {
  const generation = ++matching.generation;
  let previous = {};
  try { previous = JSON.parse(sessionStorage.getItem("solvex-matching-" + state.user.id) || "{}") || {}; } catch {}
  matching.requestedId = preferredId || Number($("matching-task").value) || previous.task || state.taskId;
  if (preferredId && preferredId !== previous.task) matching.filter = "recommended";
  else if (["recommended", "all", "saved"].includes(previous.filter)) matching.filter = previous.filter;
  matching.task = null; matching.teams = [];
  $("matching-content").hidden = true;
  $("matching-task").disabled = true;
  $("matching-chat").disabled = true;
  matchingStatus(SolvexI18n.text("Загружаем ваши задачи и профили команд…"));
  try {
    const {tasks} = await api("/api/me/tasks");
    if (generation !== matching.generation || state.currentView !== "matches") return;
    const published = tasks.filter(task => task.status === "published");
    $("matching-task").replaceChildren(...published.map(task => SolvexI18n.option(task.card.title || SolvexI18n.combine(SolvexI18n.text("Задача №"),task.id),task.id)));
    if (!published.length) {
      $("matching-task").append(SolvexI18n.option(SolvexI18n.text("Пока нет опубликованных задач"),""));
      $("matching-chat").disabled = false;
      matchingStatus(SolvexI18n.text("Сначала опубликуйте задачу в чате. Подбор доступен с любым рейтингом готовности."));
      return;
    }
    if (published.some(task => task.id === matching.requestedId)) $("matching-task").value = String(matching.requestedId);
    await fetchMatching(generation);
  } catch (error) {
    if (generation === matching.generation && state.currentView === "matches") matchingStatus(error.message, true);
  } finally {
    if (generation === matching.generation) $("matching-task").disabled = !$("matching-task").value;
  }
}
async function fetchMatching(generation = ++matching.generation) {
  const id = Number($("matching-task").value);
  if (!id) return;
  matching.task = null; matching.teams = [];
  $("matching-content").hidden = true; $("matching-chat").disabled = true;
  matchingStatus(SolvexI18n.text("Сопоставляем задачу с профилями…"));
  try {
    const data = await api("/api/me/tasks/" + id + "/matches");
    if (generation !== matching.generation || state.currentView !== "matches") return;
    matching.task = data.task; matching.teams = data.teams; matching.limit = 12; rememberMatching();
    SolvexI18n.set($("matching-task-title"),data.task.card.title);
    SolvexI18n.set($("matching-need"),data.task.card.expected_result || data.task.card.need || SolvexI18n.text("Дополните ожидаемый результат — так будет проще найти нужный опыт."));
    $("matching-signals").replaceChildren(...data.signals.map(signal => el("span", signal.label, "matching-tag")));
    SolvexI18n.set($("matching-evidence-note"),data.signals.length
      ? SolvexI18n.text("Основания — в сохранённой карточке. Откройте объяснение у команды, чтобы проверить совпадения.")
      : SolvexI18n.text("Пока мало ориентиров для навыков. Уточните желаемый результат или посмотрите все профили."));
    $("matching-content").hidden = false; $("matching-chat").disabled = false;
    matchingStatus(state.dirty && state.taskId === data.task.id ? SolvexI18n.text("Подбор по сохранённой карточке. В чате остались несохранённые правки.") : ""); renderMatches();
  } catch (error) {
    if (generation === matching.generation && state.currentView === "matches") matchingStatus(error.message, true);
  }
}
function renderMatches() {
  const query = $("matching-search").value.trim().toLocaleLowerCase("ru");
  const all = matching.teams;
  SolvexI18n.set($("match-count"),all.filter(item => item.reasons.length).length);
  SolvexI18n.set($("saved-match-count"),all.filter(item => item.shortlisted).length);
  const found = all.filter(item => (matching.filter !== "recommended" || item.reasons.length) &&
    (matching.filter !== "saved" || item.shortlisted) &&
    (!query || [item.team.name, ...item.team.skills, ...item.team.technologies, ...item.team.interests].join(" ").toLocaleLowerCase("ru").includes(query)));
  SolvexI18n.set($("matching-count"),SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("Найдено: "),found.length),SolvexI18n.text(" · сначала совпадения по навыкам")));
  document.querySelectorAll("[data-match-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.matchFilter === matching.filter)));
  const list = $("matching-list"); list.replaceChildren();
  if (!found.length) {
    const empty = el("div", null, "matching-empty");
    empty.append(el("span", "◎", "empty-symbol"), el("h2", !all.length ? SolvexI18n.text("Здесь появятся команды") : matching.filter === "saved" ? SolvexI18n.text("Ваша подборка начинается здесь") : SolvexI18n.text("Пока нет точных совпадений")),
      el("p", !all.length ? SolvexI18n.text("На платформе пока нет заполненных профилей команд. Задача уже опубликована — можно вернуться к подбору позже.") :
        matching.filter === "saved" ? SolvexI18n.text("Нажмите «В избранное» на карточке команды. Подборка сохранится только для этой задачи.") :
        SolvexI18n.text("Попробуйте другой запрос или посмотрите все профили. Отсутствие совпадения не означает, что команда не справится.")));
    if (all.length) {
      const button = el("button", SolvexI18n.text("Посмотреть все команды"), "secondary"); button.type = "button";
      button.onclick = () => { matching.filter = "all"; $("matching-search").value = ""; renderMatches(); };
      empty.append(button);
    }
    list.append(empty);
  }
  for (const item of found.slice(0, matching.limit)) list.append(matchCard(item));
  $("matching-more").hidden = found.length <= matching.limit;
}
function matchCard(item) {
  const team = item.team, card = el("article", null, "matching-card");
  card.dataset.teamId = team.id;
  const heading = el("div", null, "match-card-heading"), avatar = el("span", team.name.slice(0, 2).toUpperCase(), "team-monogram"), title = el("div");
  avatar.setAttribute("aria-hidden", "true");
  title.append(el("h2", team.name), el("p", team.interests.join(" · ") || SolvexI18n.text("Направление не указано")));
  if (team.image_url) { const img = el("img"); img.src = team.image_url; img.alt = ""; SolvexI18n.set(avatar,""); avatar.append(img); }
  heading.append(avatar, title); card.append(heading);
  const badge = el("span", item.reasons.length ? SolvexI18n.combine(SolvexI18n.text("Оснований для знакомства: "),item.reasons.length) : SolvexI18n.text("Совпадения не найдены"), "match-label");
  card.append(badge);
  const tags = el("div", null, "matching-tags");
  for (const skill of team.skills.slice(0, 5)) tags.append(el("span", skill, "matching-tag"));
  if (team.skills.length > 5) tags.append(el("span", "+" + (team.skills.length - 5), "matching-tag"));
  card.append(tags);
  card.append(el("p", team.technologies.length ? SolvexI18n.combine(SolvexI18n.text("Технологии: "),team.technologies.slice(0, 5).join(", ")) : SolvexI18n.text("Технологии не указаны"), "match-technologies"));
  const details = el("details", null, "match-explanation");
  details.append(el("summary", item.reasons.length ? SolvexI18n.text("Почему команда в подборе") : SolvexI18n.text("Посмотреть профиль")));
  for (const reason of item.reasons) {
    const block = el("div", null, "match-evidence");
    block.append(el("strong", reason.profile_value), el("p", SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("В задаче: «"),reason.excerpt),"»")),
      el("small", SolvexI18n.combine(reason.field === "topic" ? SolvexI18n.text("Направление") : FIELDS[reason.field],reason.confirmed ? SolvexI18n.text(" · подтверждено вами") : SolvexI18n.text(" · проверьте соответствие"))));
    details.append(block);
  }
  if (item.gaps.length) details.append(el("p", SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("В профиле не указано: "),item.gaps.join(", ")),SolvexI18n.text(". Уточните этот опыт у команды.")), "match-gap"));
  if (team.description || team.experience) details.append(organizationCard(team, true));
  details.append(el("p", SolvexI18n.combine(SolvexI18n.text("Все навыки: "),team.skills.join(", ") || SolvexI18n.text("не указаны"))), el("p", SolvexI18n.combine(SolvexI18n.text("Все технологии: "),team.technologies.join(", ") || SolvexI18n.text("не указаны"))),
    el("p", SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("Баллы за подтверждённые этапы: "),team.points),SolvexI18n.text(". Не влияют на порядок подбора.")), "match-footnote"));
  card.append(details);
  const actions = el("div", null, "match-actions"), save = el("button", item.shortlisted ? SolvexI18n.text("★ В избранном") : SolvexI18n.text("☆ В избранное"), item.shortlisted ? "saved-team secondary" : "secondary");
  save.type = "button"; save.setAttribute("aria-pressed", String(item.shortlisted));
  save.addEventListener("click", async () => {
    const taskId = matching.task.id, generation = matching.generation;
    save.disabled = true; save.setAttribute("aria-busy", "true");
    try {
      const result = await api("/api/me/tasks/" + taskId + "/shortlist/" + team.id, "PUT", {saved:!item.shortlisted});
      if (generation !== matching.generation || matching.task?.id !== taskId) return;
      item.shortlisted = result.saved;
      matchingStatus(result.saved ? SolvexI18n.text("Команда сохранена в вашей подборке. Ей не отправляется уведомление.") : SolvexI18n.text("Команда убрана из подборки."));
      renderMatches();
      const replacement = $("matching-list").querySelector('[data-team-id="' + team.id + '"] button');
      (replacement || document.querySelector('[data-match-filter="saved"]')).focus({preventScroll:true});
    } catch (error) { if (generation === matching.generation) matchingStatus(error.message, true); }
    finally { save.disabled = false; save.removeAttribute("aria-busy"); }
  });
  actions.append(save);
  if (item.proposal) {
    const proposal = el("button", item.proposal.status === "selected" ? SolvexI18n.text("Выбрана · отклик →") : item.proposal.status === "rejected" ? SolvexI18n.text("Отклонена · отклик →") : SolvexI18n.text("Есть отклик →"), "text-button");
    proposal.type = "button"; proposal.onclick = () => view("business", {taskId:matching.task.id}); actions.append(proposal);
  } else actions.append(el("span", SolvexI18n.text("Пока без отклика"), "match-footnote"));
  card.append(actions); return card;
}
$("matching-task").addEventListener("change", () => { matching.filter = "recommended"; fetchMatching(); });
$("matching-refresh").addEventListener("click", () => loadMatching(Number($("matching-task").value)));
$("matching-search").addEventListener("input", () => { matching.limit = 12; renderMatches(); });
$("matching-more").addEventListener("click", () => { matching.limit += 12; renderMatches(); });
document.querySelectorAll("[data-match-filter]").forEach(button => button.addEventListener("click", () => {
  matching.filter = button.dataset.matchFilter; matching.limit = 12; rememberMatching(); renderMatches();
}));
$("matching-proposals").addEventListener("click", () => view("business", {taskId:matching.task?.id}));
$("matching-chat").addEventListener("click", async () => {
  if (!matching.task || matching.task.id === state.taskId) { view("create"); return; }
  if (state.busy) { matchingStatus(SolvexI18n.text("Дождитесь ответа агента перед открытием другой задачи.")); return; }
  try { await openSavedTask(matching.task.id); } catch (error) { matchingStatus(error.message, true); }
});

$("matching-brief-toggle").addEventListener("click", event => {
  const button = event.currentTarget, expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  SolvexI18n.set(button.querySelector("span"),expanded ? "−" : "＋");
  button.closest("aside").classList.toggle("expanded", expanded);
});
