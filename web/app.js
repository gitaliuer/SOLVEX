"use strict";

const FIELDS = {
  title: SolvexI18n.text("Название"), context: SolvexI18n.text("Контекст"), need: SolvexI18n.text("Потребность"),
  users: SolvexI18n.text("Пользователи"), data: SolvexI18n.text("Данные и материалы"), constraints: SolvexI18n.text("Ограничения"),
  expected_result: SolvexI18n.text("Ожидаемый результат"), success_criteria: SolvexI18n.text("Критерии успеха"),
  contact: SolvexI18n.text("Контакт бизнеса"), interaction_format: SolvexI18n.text("Формат взаимодействия")
};
const LEVELS = {draft: SolvexI18n.text("Начальная"), working: SolvexI18n.text("Рабочая"), ready: SolvexI18n.text("Готовая"), priority: SolvexI18n.text("Приоритетная")};
const FIELD_GROUPS = [
  [SolvexI18n.text("Суть задачи"), ["title", "context", "need", "users"]],
  [SolvexI18n.text("Данные и результат"), ["data", "expected_result", "success_criteria"]],
  [SolvexI18n.text("Условия и связь"), ["constraints", "contact", "interaction_format"]]
];
const $ = id => document.getElementById(id);
const state = {user: null, csrf: '', currentView: 'create', profileDirty: false, projectDirty: false, questions: [], card: null, taskId: null, tasks: [], businessTasks: [], teams: [], topics: [], dirty: false, sourceDirty: false, busy: false};

let catalogRequest = 0, detailRequest = 0, businessRequest = 0;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) SolvexI18n.set(node,text);
  if (className) node.className = className;
  return node;
}
function message(text, error = false) {
  SolvexI18n.set($("notice"),text);
  $("notice").classList.toggle("error", error);
  $("notice").setAttribute("role", error ? "alert" : "status");
}
async function api(path, method = "GET", body = null, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = body ? {"Content-Type": "application/json"} : {};
    if (method !== "GET" && state.csrf) headers["X-CSRF-Token"] = state.csrf;
    const response = await fetch(path, {method, headers, credentials: "same-origin", cache: "no-store",
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        if (path === "/api/auth/logout") return {status: "ok"};
        SolvexAuth.open("login");
        throw new Error(SolvexI18n.text("Сессия истекла. Войдите снова — несохранённый текст остаётся в этом окне."));
      }
      const failure = new Error(SolvexI18n.failure(data.error));
      failure.status = response.status; failure.code = data.error?.code;
      if(data.error?.subscription)window.dispatchEvent(new CustomEvent('solvex:quota',{detail:data.error.subscription}));
      throw failure;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error(SolvexI18n.text("Время ожидания истекло. Попробуйте ещё раз."));
    if (error instanceof TypeError) throw new Error(SolvexI18n.text("Сервер недоступен. Проверьте запуск приложения и попробуйте ещё раз."));
    throw error;
  } finally { clearTimeout(timer); if(method!=='GET'&&(/\/agent\/\d+\/messages$|\/research$|\/review$|\/ai\//.test(path)))window.dispatchEvent(new Event('solvex:usage')); }
}
async function action(button, fn) {
  if (button.disabled) return;
  const editorScope = button.closest("#create") || (button.closest("#my-tasks") ? $("create") : null);
  const scope = editorScope || button.closest("form, article") || button;
  const editing = Boolean(editorScope);
  if (editing && state.busy) return;
  if (editing) state.busy = true;
  const controls = scope === button ? [button] : [...scope.querySelectorAll("button, input, textarea, select")];
  if (!controls.includes(button)) controls.push(button);
  const disabledBefore = controls.map(control => control.disabled);
  const label = SolvexI18n.value(button);
  controls.forEach(control => { control.disabled = true; });
  button.setAttribute("aria-busy", "true");
  SolvexI18n.set(button,SolvexI18n.text("Подождите…"));
  try { await fn(); } catch (error) { message(error.message, true); }
  finally {
    if (editing) state.busy = false;
    controls.forEach((control, index) => { control.disabled = disabledBefore[index]; });
    button.removeAttribute("aria-busy"); SolvexI18n.set(button,label);
    if (editing) lockAgent();
  }
}
function view(name, options = {}) {
  if (!state.user) return;
  const previousView = state.currentView;
  if (name.startsWith("projects/")) { options.projectId = Number(name.split("/")[1]); name = "projects"; }
  const business = ["create", "my-tasks", "business", "matches", "research"], team = ["my-proposals"];
  if ((business.includes(name) && state.user.role !== "BUSINESS") ||
      (team.includes(name) && state.user.role !== "TEAM") || !document.getElementById(name)?.classList.contains("view")) {
    name = state.user.role === "BUSINESS" ? "create" : "catalog";
  }
  state.currentView = name;
  if (name !== "catalog") { catalogRequest++; detailRequest++; }
  history.replaceState(null, "", "#" + name);
  const labels = {research:"Research / Evidence", projects:SolvexI18n.text("Проекты"), create:"AI Agent", "my-tasks":SolvexI18n.text("Мои задачи"), business:SolvexI18n.text("Отклики команд"), matches:SolvexI18n.text("Подбор команд"), catalog:SolvexI18n.text("Каталог задач"), "team-profile":SolvexI18n.text("Мой профиль"), "my-proposals":SolvexI18n.text("Мои отклики"), about:SolvexI18n.text("О платформе")};
  SolvexI18n.set($("page-label"),labels[name] || "SOLVEX");
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== name;
  const role = name === "about" ? null : name === "catalog" ? "team" : "business";
  for (const button of document.querySelectorAll("nav button")) {
    button.classList.toggle("selected", button.dataset.view === name);
    if (button.dataset.role) button.setAttribute("aria-pressed", String(button.dataset.role === role));
  }
  message("");
  if (name === "create" || name === "my-tasks") loadBusinessTasks(true);
  if (name === "catalog") loadTasks(true);
  if (name === "business") loadBusiness(options.taskId);
  if (name === "matches") loadMatching(options.taskId);
  if (name === "research") loadResearch(options.taskId);
  if (name === "billing") { SolvexI18n.set($("page-label"),SolvexI18n.text("Тариф и лимиты")); loadUsage(); }
  if (name === "team-profile") loadProfile();
  if (name === "projects") loadProjects(options.projectId);
  if (name === "messages") { SolvexI18n.set($("page-label"),SolvexI18n.text("Сообщения")); loadConversations(options.conversationId); }
  if (name === "my-proposals") loadMyProposals();
  if (name !== previousView) window.scrollTo({top:0,behavior:'instant'});
}
for (const button of document.querySelectorAll("nav button")) button.addEventListener("click", () => view(button.dataset.view));
$("about-link").addEventListener("click", event => {
  event.preventDefault(); view("about"); reveal($("about").querySelector("h1"));
});
function reveal(node) {
  node.setAttribute("tabindex", "-1");
  node.focus({preventScroll:true});
  node.scrollIntoView({block:"start", behavior:"auto"});
}
function canReplaceWork(includeMessages = false) {
  return !(state.dirty || state.sourceDirty || state.profileDirty || state.projectDirty || state.contactDirty || (includeMessages && hasMessageDrafts())) || window.confirm(SolvexI18n.text("Есть несохранённые изменения. Продолжить и отбросить их?"));
}
function renderBusinessTasks() {
  for (const id of ["my-task-list"]) {
    const list = $(id); list.replaceChildren();
    if (!state.businessTasks.length) {
      const empty = el("div", null, "empty-state");
      empty.append(el("h2", SolvexI18n.text("У каждой идеи есть начало")), el("p", SolvexI18n.text("Расскажите о своей задаче — первый черновик появится здесь.")));
      list.append(empty); continue;
    }
    for (const task of state.businessTasks) {
      const item = el("article", null, "saved-task"), text = el("div");
      const button = el("button", SolvexI18n.text("Продолжить редактирование"), "secondary");
      text.append(el("span", task.topic, "eyebrow"), el("strong", task.card.title || SolvexI18n.text("Без названия")),
        el("span", SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("Готовность: "),task.score),"/100 · "),task.status === "published" ? SolvexI18n.text("В каталоге") : SolvexI18n.text("Черновик"))));
      button.type = "button";
      button.addEventListener("click", () => {
        if (state.busy) return;
        action(button, () => openSavedTask(task.id));
      });
      const actions = el("div", null, "actions"); actions.append(button);
      if (task.status === "published") {
        const match = el("button", SolvexI18n.text("Подобрать команду →"), "text-button"); match.type = "button";
        match.onclick = () => view("matches", {taskId:task.id}); actions.append(match);
      }
      item.append(text, actions); list.append(item);
    }
  }
}
function upsertBusinessTask(task) {
  businessRequest++;
  state.businessTasks = [task, ...state.businessTasks.filter(saved => saved.id !== task.id)].sort((a, b) => b.id - a.id);
  renderBusinessTasks();
}
async function loadBusinessTasks(quiet = false) {
  const request = ++businessRequest;
  try {
    if (!quiet) message(SolvexI18n.text("Загружаем сохранённые задачи..."));
    const data = await api("/api/me/tasks");
    if (request !== businessRequest) return;
    state.businessTasks = data.tasks;
    renderBusinessTasks();
    if (!quiet) message(SolvexI18n.text("Сохранённые задачи загружены: {0}.",data.tasks.length));
  } catch (error) { message(error.message, true); }
}
async function loadTasks(refreshTopics = false) {
  const request = ++catalogRequest;
  detailRequest++;
  try {
    message(SolvexI18n.text("Загружаем каталог..."));
    $("task-detail").hidden = true;
    $("task-detail").replaceChildren();
    const topic = $("topic-filter").value, level = $("level-filter").value;
    const params = new URLSearchParams();
    if (topic) params.set("topic", topic);
    if (level) params.set("level", level);
    if ($("catalog-search").value.trim()) params.set("q", $("catalog-search").value.trim());
    const suffix = params.toString() ? `?${params}` : "";
    const data = await api(`/api/catalog/tasks${suffix}`);
    if (request !== catalogRequest) return;
    state.tasks = data.tasks;
    if (refreshTopics || !state.topics.length) {
      const allTasks = suffix ? (await api("/api/catalog/tasks")).tasks : data.tasks;
      if (request !== catalogRequest) return;
      state.topics = [...new Set(allTasks.map(task => task.topic))];
      const filter = $("topic-filter"), chosen = filter.value;
      filter.replaceChildren(SolvexI18n.option(SolvexI18n.text("Все темы"),""), ...state.topics.map(t => SolvexI18n.option(t,t)));
      filter.value = state.topics.includes(chosen) ? chosen : "";
    }
    renderTasks();
    message(SolvexI18n.text("Найдено задач: {0}. Сортировка — по рейтингу.",data.tasks.length));
  } catch (error) { message(error.message, true); }
}
function renderTasks() {
  const list = $("task-list"); list.replaceChildren();
  SolvexI18n.set($("catalog-count"),String(state.tasks.length));
  if (!state.tasks.length) { list.append(el("p", SolvexI18n.text("Задач с такими параметрами пока нет. Попробуйте другую тему или готовность."), "empty-state")); return; }
  for (const task of state.tasks) {
    const box = el("article", null, "task-card"), top = el("div", null, "task-card-top");
    box.classList.add(`level-${task.level}`);
    const rating = el("div", null, "task-rating");
    SolvexI18n.attribute(rating,"aria-label",SolvexI18n.text("Готовность: {0} из 100",task.score));
    rating.append(el("strong", task.score), el("span", "/ 100"));
    top.append(el("span", task.topic, "chip"), rating);
    const open = el("button", state.user.role === "TEAM" ? SolvexI18n.text("Посмотреть и откликнуться") : SolvexI18n.text("Открыть задачу"), "secondary");
    open.addEventListener("click", () => openTask(task.id));
    const footer = el("div", null, "task-card-footer");
    footer.append(el("span", SolvexI18n.text("Готовность: {0}",LEVELS[task.level].toLowerCase()), `level-label level-${task.level}`), open);
    box.append(coverForTask(task), top, el("h2", task.card.title), el("p", task.card.need || task.card.context || SolvexI18n.text("Описание ещё уточняется")), footer);
    list.append(box);
  }
}
$("topic-filter").addEventListener("change", () => loadTasks());
$("level-filter").addEventListener("change", () => loadTasks());
$("refresh").addEventListener("click", () => loadTasks(true));

async function openTask(id) {
  const request = ++detailRequest;
  try {
    message(SolvexI18n.text("Открываем задачу…"));
    const task = await api("/api/catalog/tasks/" + id);
    if (request !== detailRequest) return;
    const detail = $("task-detail"); detail.replaceChildren();
    detail.append(taskGallery(task));
    detail.append(el("span", task.topic + " · " + LEVELS[task.level] + " · " + task.score + "/100", "eyebrow"), el("h2", task.card.title));
    const fields = el("div", null, "detail-grid");
    for (const [key, title] of Object.entries(FIELDS)) {
      if (key === "title") continue;
      const cell = el("div"); cell.append(el("b", title), el("span", task.card[key] || SolvexI18n.text("Не указано"))); fields.append(cell);
    }
    if (task.organization?.name) detail.append(organizationCard(task.organization));
    detail.append(contactActions(task),fields); detail.hidden = false; reveal(detail);
    if (state.user.role !== "TEAM") { message(SolvexI18n.text("Опубликованная карточка задачи.")); return; }
    const [{team}, {proposals:ownProposals}] = await Promise.all([api("/api/me/team"), api("/api/me/proposals")]);
    if (request !== detailRequest) return;
    if (!team) {
      const section = el('div'); section.id='proposal-section'; detail.append(section);
      const button = el("button", SolvexI18n.text("Заполнить профиль команды →"), "primary");
      button.type = "button"; button.addEventListener("click", () => view("team-profile"));
      section.append(el("p", SolvexI18n.text("Чтобы отправить отклик, расскажите о вашей команде.")), button);
      message(SolvexI18n.text("Создайте профиль команды, чтобы предложить решение.")); return;
    }
    if (ownProposals.some(p => p.task_id === id)) {
      const sent=el('div',null,'empty-state'), link=el('button',SolvexI18n.text('Мои отклики'),'secondary');
      sent.id='proposal-section'; link.type='button'; link.onclick=()=>view('my-proposals');
      sent.append(el('p',SolvexI18n.text('Вы уже отправили отклик. Продолжите обсуждение в сообщениях.')),link); detail.append(sent); message(''); return;
    }
    detail.append(el("h2", SolvexI18n.text("Ваш подход к решению")), el("p", SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("Отклик от команды «"),team.name),"»"), "hint"));
    const form = el("form"); form.noValidate = true;
    const inputs = {};
    for (const [key, title, tag] of [["idea",SolvexI18n.text("Идея решения"),"textarea"],["plan",SolvexI18n.text("План"),"textarea"],["duration_days",SolvexI18n.text("Срок в днях"),"input"],["prototype_url",SolvexI18n.text("Ссылка на прототип"),"input"]]) {
      const label = el("label", title), input = el(tag); inputs[key] = input;
      input.id = "proposal-" + key; label.htmlFor = input.id;
      if (key === "duration_days") { input.type = "number"; input.min = "1"; input.max = "365"; }
      if (key === "prototype_url") { input.type = "url"; SolvexI18n.attribute(input,"placeholder","https://…"); }
      if (key === "idea" || key === "plan") { input.minLength = 10; input.maxLength = 2000; }
      input.required = true; form.append(label, input);
    }
    const submit = el("button", SolvexI18n.text("Отправить предложение"), "primary"); submit.type = "submit"; form.append(submit);
    form.addEventListener("submit", event => {event.preventDefault(); action(submit, async () => {
      if (inputs.idea.value.trim().length < 10 || inputs.plan.value.trim().length < 10) throw new Error(SolvexI18n.text("Идея и план должны содержать не менее 10 символов"));
      const duration = Number(inputs.duration_days.value);
      if (!Number.isInteger(duration) || duration < 1 || duration > 365) throw new Error(SolvexI18n.text("Укажите срок от 1 до 365 дней"));
      let url;
      try { url = new URL(inputs.prototype_url.value.trim()); } catch { throw new Error(SolvexI18n.text("Укажите полный URL прототипа")); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error(SolvexI18n.text("Ссылка должна начинаться с http:// или https://"));
      await api("/api/catalog/tasks/" + id + "/proposals", "POST", {
        idea: inputs.idea.value.trim(), plan: inputs.plan.value.trim(),
        duration_days: duration, prototype_url: url.href});
      const confirmation = el("div", null, "empty-state");
      confirmation.id='proposal-section';
      confirmation.append(el("h3", SolvexI18n.text("Первый шаг сделан")), el("p", SolvexI18n.text("Отклик отправлен. Решение бизнеса появится в разделе «Мои отклики».")));
      form.replaceWith(confirmation);
      message(SolvexI18n.text("Предложение отправлено. Решение примет бизнес."));
    });});
    form.id='proposal-section'; detail.append(form); message(SolvexI18n.text("Задача открыта. Предложите свой подход."));
  } catch (error) { message(error.message, true); }
}

let businessLoad = 0;
async function loadBusiness(preferredId) {
  const generation = ++businessLoad;
  try {
    message(SolvexI18n.text("Загружаем задачи бизнеса и отклики..."));
    const data = await api("/api/me/tasks");
    if (generation !== businessLoad || state.currentView !== "business") return;
    data.tasks = data.tasks.filter(task => task.status === "published"); state.tasks = data.tasks;
    const select = $("business-task"), previous = select.value;
    select.replaceChildren(...data.tasks.map(task => SolvexI18n.option(`${task.card.title} · ${task.score}/100`,task.id)));
    if (preferredId && data.tasks.some(task => task.id === preferredId)) select.value = String(preferredId);
    else if (data.tasks.some(task => String(task.id) === previous)) select.value = previous;
    else if (state.taskId && data.tasks.some(task => task.id === state.taskId)) select.value = String(state.taskId);
    await loadProposals();
  } catch (error) { if (generation === businessLoad && state.currentView === "business") message(error.message, true); }
}
let proposalRequest = 0;
async function loadProposals(successMessage = "") {
  const request = ++proposalRequest;
  const list = $("proposal-list"), taskId = $("business-task").value;
  list.replaceChildren();
  $("proposal-comparison").hidden = true;
  if (!taskId) { list.append(el("p", SolvexI18n.text("Сначала опубликуйте задачу."))); message(SolvexI18n.text("Опубликованных задач пока нет.")); return; }
  try {
    const [{proposals}, {teams}] = await Promise.all([api(`/api/me/tasks/${taskId}/proposals`), api("/api/catalog/teams")]);
    if (request !== proposalRequest || $("business-task").value !== taskId || state.currentView !== "business") return;
    list.replaceChildren();
    if (!proposals.length) {
      const find = el("button", SolvexI18n.text("Посмотреть подходящие команды →"), "secondary"); find.type = "button";
      find.onclick = () => view("matches", {taskId:Number(taskId)});
      list.append(el("p", SolvexI18n.text("Пока нет предложений. Можно изучить команды и сохранить интересные профили.")), find);
      message(SolvexI18n.text("Отклики загружены: пока ни одного.")); return;
    }
    renderComparison(proposals, teams);
    for (const p of proposals) {
      const article = el("article"), team = teams.find(t => t.id === p.team_id), actions = el("div", null, "actions");
      article.classList.toggle("selected", p.status === "selected");
      const profile = el("div", null, "team-profile");
      profile.append(el("span", SolvexI18n.text("Навыки: {0}",team?.skills?.join(", ") || SolvexI18n.text("не указаны"))), el("span", SolvexI18n.text("Технологии: {0}",team?.technologies?.join(", ") || SolvexI18n.text("не указаны"))));
      article.append(el("h3", team?.name || SolvexI18n.text("Команда")), el("p", SolvexI18n.combine("",p.status === "selected" ? SolvexI18n.text("Выбрана") : p.status === "rejected" ? SolvexI18n.text("Отклонена") : SolvexI18n.text("Ожидает решения"),"",p.milestone_confirmed ? SolvexI18n.text(" · Этап подтверждён · +10 однократно") : "",""), "proposal-status"), profile,
        el("p", p.idea), el("p", SolvexI18n.text("План: {0}",p.plan)), el("p", SolvexI18n.text("Срок: {0} дн. · Баллы команды: {1} · За этот этап: {2}",p.duration_days,team?.points ?? 0,p.points), "proposal-meta"));
      const link = el("a", SolvexI18n.text("Открыть прототип")); link.href = p.prototype_url; link.target = "_blank"; link.rel = "noopener noreferrer"; article.append(link);
      for (const [status, title] of [["selected",SolvexI18n.text("Выбрать")],["rejected",SolvexI18n.text("Отклонить")]]) {
        if ((p.milestone_confirmed || p.project_id) && status === "rejected") continue;
        const button = el("button", title, status === "selected" ? "primary" : "secondary");
        button.disabled = p.status === status;
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/me/proposals/${p.id}`, "PATCH", {status});
          await loadProposals(SolvexI18n.text("Решение сохранено вручную. Остальные отклики не изменены."));
        })); actions.append(button);
      }
      if (p.status === "selected") actions.append(projectProposalButton(p));
      actions.append(conversationButton(Number(taskId),p.id));
      if (p.status === "selected" && !p.project_id) {
        const button = el("button", p.milestone_confirmed ? SolvexI18n.text("Этап подтверждён") : SolvexI18n.text("Подтвердить этап +10"), "secondary");
        button.disabled = p.milestone_confirmed;
        button.addEventListener("click", () => action(button, async () => {
          await api(`/api/me/proposals/${p.id}/milestones/confirm`, "POST", {});
          await loadProposals(SolvexI18n.text("Этап подтверждён: за этот этап начислено 10 баллов однократно."));
        })); actions.append(button);
      }
      article.id = "proposal-card-" + p.id; article.classList.add("proposal-card");
      if (team) article.prepend(organizationCard(team, true));
      attachReview(article, p, taskId);
      article.append(actions); list.append(article);
    }
    message(successMessage || SolvexI18n.text("Отклики загружены: {0}. Каждое решение принимается независимо.",proposals.length));
  } catch (error) { if (request === proposalRequest) message(error.message, true); }
}
$("business-task").addEventListener("change", () => loadProposals());
$("start-new-task").addEventListener("click", () => {
  view("create"); $("new-task").click();
});
$("catalog-search").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); loadTasks(); }
});

async function loadMyProposals() {
  try {
    const {proposals} = await api("/api/me/proposals"), list = $("my-proposal-list");
    list.replaceChildren();
    if (!proposals.length) {
      const empty = el("div", null, "empty-state"), button = el("button", SolvexI18n.text("Найти свою задачу →"), "primary");
      button.type = "button"; button.addEventListener("click", () => view("catalog"));
      empty.append(el("h2", SolvexI18n.text("Покажите, что вы можете")), el("p", SolvexI18n.text("Выберите задачу в каталоге и предложите свой подход.")), button);
      list.append(empty);
    }
    for (const proposal of proposals) {
      const box = el("article", null, "panel");
      box.append(el("span", proposal.status === "selected" ? SolvexI18n.text("Команда выбрана") : proposal.status === "rejected" ? SolvexI18n.text("Отклик отклонён") : SolvexI18n.text("Ожидает решения"), "proposal-status"),
        el("h2", proposal.task_title), el("p", proposal.idea),
        el("p", proposal.milestone_confirmed ? SolvexI18n.text("Этап подтверждён · +10 баллов") : SolvexI18n.combine(SolvexI18n.combine(SolvexI18n.text("Срок: "),proposal.duration_days),SolvexI18n.text(" дн.")), "hint"));
      if (proposal.project_id) box.append(projectProposalButton(proposal));
      list.append(box);
    }
    message("");
  } catch (error) { message(error.message, true); }
}

function applySession(session) {
  state.user = session.user; state.csrf = session.csrf_token;
  SolvexI18n.set($("account-email"),session.user.email);
  SolvexI18n.set($("account-role"),session.user.role === "BUSINESS" ? SolvexI18n.text("Бизнес-аккаунт") : SolvexI18n.text("Команда"));
  SolvexI18n.set($("account-avatar"),session.user.email.charAt(0).toUpperCase());
  document.querySelectorAll("[data-access]").forEach(node => { node.hidden = node.dataset.access !== session.user.role; });
}
async function boot() {
  try {
    const session = await SolvexAuth.getSession(true);
    if (!session) { location.replace("/?auth=login"); return; }
    applySession(session);
    loadUsage();
    if (session.user.role === "BUSINESS") await initAgent();
    document.body.classList.remove("booting");
    $("boot-state").hidden = true;
    view(location.hash.slice(1) || (session.user.role === "BUSINESS" ? "create" : "catalog"));
  } catch (error) {
    SolvexI18n.set($("boot-state").firstChild,error.message + " ");
    $("retry-session").hidden = false;
  }
}
$("retry-session").addEventListener("click", boot);
window.addEventListener("solvex:session", event => {
  if (state.user && state.user.id !== event.detail.user.id) {
    state.dirty = state.sourceDirty = state.profileDirty = state.projectDirty = false;
    state.contactDirty=false; dm.drafts.clear();
    document.body.classList.add("booting");
    $("card-fields").replaceChildren();
    location.replace("/app"); return;
  }
  applySession(event.detail);
  message(SolvexI18n.text("Вход восстановлен. Можно продолжить с несохранёнными изменениями."));
});
$("logout").addEventListener("click", event => {
  if (state.busy || dm.sending) { message(SolvexI18n.text("Дождитесь завершения текущего действия.")); return; }
  if (!canReplaceWork(true)) return;
  action(event.currentTarget, async () => {
    await api("/api/auth/logout", "POST", {});
    state.dirty = state.sourceDirty = state.profileDirty = state.projectDirty = false; state.user = null; state.csrf = "";
    state.contactDirty=false; dm.drafts.clear();
    location.replace("/");
  });
});
window.addEventListener("beforeunload", event => {
  if (state.dirty || state.sourceDirty || state.profileDirty || state.projectDirty || state.contactDirty || hasMessageDrafts()) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("hashchange", () => view(location.hash.slice(1)));
