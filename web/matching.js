"use strict";

const matching = {generation:0, task:null, teams:[], filter:"recommended", limit:12, requestedId:null};
function rememberMatching() {
  try { sessionStorage.setItem("solvex-matching-" + state.user.id, JSON.stringify({task:matching.task?.id, filter:matching.filter})); } catch {}
}
function matchingStatus(text, error = false) {
  $("matching-status").textContent = text;
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
  matchingStatus("Загружаем ваши задачи и профили команд…");
  try {
    const {tasks} = await api("/api/me/tasks");
    if (generation !== matching.generation || state.currentView !== "matches") return;
    const published = tasks.filter(task => task.status === "published");
    $("matching-task").replaceChildren(...published.map(task => new Option(task.card.title || "Задача №" + task.id, task.id)));
    if (!published.length) {
      $("matching-task").append(new Option("Пока нет опубликованных задач", ""));
      $("matching-chat").disabled = false;
      matchingStatus("Сначала опубликуйте задачу в чате. Подбор доступен с любым рейтингом готовности.");
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
  matchingStatus("Сопоставляем задачу с профилями…");
  try {
    const data = await api("/api/me/tasks/" + id + "/matches");
    if (generation !== matching.generation || state.currentView !== "matches") return;
    matching.task = data.task; matching.teams = data.teams; matching.limit = 12; rememberMatching();
    $("matching-task-title").textContent = data.task.card.title;
    $("matching-need").textContent = data.task.card.expected_result || data.task.card.need || "Дополните ожидаемый результат — так будет проще найти нужный опыт.";
    $("matching-signals").replaceChildren(...data.signals.map(signal => el("span", signal.label, "matching-tag")));
    $("matching-evidence-note").textContent = data.signals.length
      ? "Основания — в сохранённой карточке. Откройте объяснение у команды, чтобы проверить совпадения."
      : "Пока мало ориентиров для навыков. Уточните желаемый результат или посмотрите все профили.";
    $("matching-content").hidden = false; $("matching-chat").disabled = false;
    matchingStatus(state.dirty && state.taskId === data.task.id ? "Подбор по сохранённой карточке. В чате остались несохранённые правки." : ""); renderMatches();
  } catch (error) {
    if (generation === matching.generation && state.currentView === "matches") matchingStatus(error.message, true);
  }
}
function renderMatches() {
  const query = $("matching-search").value.trim().toLocaleLowerCase("ru");
  const all = matching.teams;
  $("match-count").textContent = all.filter(item => item.reasons.length).length;
  $("saved-match-count").textContent = all.filter(item => item.shortlisted).length;
  const found = all.filter(item => (matching.filter !== "recommended" || item.reasons.length) &&
    (matching.filter !== "saved" || item.shortlisted) &&
    (!query || [item.team.name, ...item.team.skills, ...item.team.technologies, ...item.team.interests].join(" ").toLocaleLowerCase("ru").includes(query)));
  $("matching-count").textContent = "Найдено: " + found.length + " · сначала совпадения по навыкам";
  document.querySelectorAll("[data-match-filter]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.matchFilter === matching.filter)));
  const list = $("matching-list"); list.replaceChildren();
  if (!found.length) {
    const empty = el("div", null, "matching-empty");
    empty.append(el("span", "◎", "empty-symbol"), el("h2", !all.length ? "Здесь появятся команды" : matching.filter === "saved" ? "Ваша подборка начинается здесь" : "Пока нет точных совпадений"),
      el("p", !all.length ? "На платформе пока нет заполненных профилей команд. Задача уже опубликована — можно вернуться к подбору позже." :
        matching.filter === "saved" ? "Нажмите «В избранное» на карточке команды. Подборка сохранится только для этой задачи." :
        "Попробуйте другой запрос или посмотрите все профили. Отсутствие совпадения не означает, что команда не справится."));
    if (all.length) {
      const button = el("button", "Посмотреть все команды", "secondary"); button.type = "button";
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
  title.append(el("h2", team.name), el("p", team.interests.join(" · ") || "Направление не указано"));
  heading.append(avatar, title); card.append(heading);
  const badge = el("span", item.reasons.length ? "Оснований для знакомства: " + item.reasons.length : "Совпадения не найдены", "match-label");
  card.append(badge);
  const tags = el("div", null, "matching-tags");
  for (const skill of team.skills.slice(0, 5)) tags.append(el("span", skill, "matching-tag"));
  if (team.skills.length > 5) tags.append(el("span", "+" + (team.skills.length - 5), "matching-tag"));
  card.append(tags);
  card.append(el("p", team.technologies.length ? "Технологии: " + team.technologies.slice(0, 5).join(", ") : "Технологии не указаны", "match-technologies"));
  const details = el("details", null, "match-explanation");
  details.append(el("summary", item.reasons.length ? "Почему команда в подборе" : "Посмотреть профиль"));
  for (const reason of item.reasons) {
    const block = el("div", null, "match-evidence");
    block.append(el("strong", reason.profile_value), el("p", "В задаче: «" + reason.excerpt + "»"),
      el("small", (reason.field === "topic" ? "Направление" : FIELDS[reason.field]) + (reason.confirmed ? " · подтверждено вами" : " · проверьте соответствие")));
    details.append(block);
  }
  if (item.gaps.length) details.append(el("p", "В профиле не указано: " + item.gaps.join(", ") + ". Уточните этот опыт у команды.", "match-gap"));
  details.append(el("p", "Все навыки: " + (team.skills.join(", ") || "не указаны")), el("p", "Все технологии: " + (team.technologies.join(", ") || "не указаны")),
    el("p", "Баллы за подтверждённые этапы: " + team.points + ". Не влияют на порядок подбора.", "match-footnote"));
  card.append(details);
  const actions = el("div", null, "match-actions"), save = el("button", item.shortlisted ? "★ В избранном" : "☆ В избранное", item.shortlisted ? "saved-team secondary" : "secondary");
  save.type = "button"; save.setAttribute("aria-pressed", String(item.shortlisted));
  save.addEventListener("click", async () => {
    const taskId = matching.task.id, generation = matching.generation;
    save.disabled = true; save.setAttribute("aria-busy", "true");
    try {
      const result = await api("/api/me/tasks/" + taskId + "/shortlist/" + team.id, "PUT", {saved:!item.shortlisted});
      if (generation !== matching.generation || matching.task?.id !== taskId) return;
      item.shortlisted = result.saved;
      matchingStatus(result.saved ? "Команда сохранена в вашей подборке. Ей не отправляется уведомление." : "Команда убрана из подборки.");
      renderMatches();
      const replacement = $("matching-list").querySelector('[data-team-id="' + team.id + '"] button');
      (replacement || document.querySelector('[data-match-filter="saved"]')).focus({preventScroll:true});
    } catch (error) { if (generation === matching.generation) matchingStatus(error.message, true); }
    finally { save.disabled = false; save.removeAttribute("aria-busy"); }
  });
  actions.append(save);
  if (item.proposal) {
    const proposal = el("button", item.proposal.status === "selected" ? "Выбрана · отклик →" : item.proposal.status === "rejected" ? "Отклонена · отклик →" : "Есть отклик →", "text-button");
    proposal.type = "button"; proposal.onclick = () => view("business", {taskId:matching.task.id}); actions.append(proposal);
  } else actions.append(el("span", "Пока без отклика", "match-footnote"));
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
  if (state.busy) { matchingStatus("Дождитесь ответа агента перед открытием другой задачи."); return; }
  try { await openSavedTask(matching.task.id); } catch (error) { matchingStatus(error.message, true); }
});

$("matching-brief-toggle").addEventListener("click", event => {
  const button = event.currentTarget, expanded = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(expanded));
  button.querySelector("span").textContent = expanded ? "−" : "＋";
  button.closest("aside").classList.toggle("expanded", expanded);
});
