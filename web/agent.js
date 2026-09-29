"use strict";

const agent = {task:null, messages:[], run:null, generation:0, polling:null, sending:false, request:null};
const blankCard = () => Object.fromEntries(Object.keys(FIELDS).map(key => [key, ""]));
const storageKey = () => "solvex-agent-" + state.user.id;
function rememberTask(id) {
  try { if (id) sessionStorage.setItem(storageKey(), String(id)); else sessionStorage.removeItem(storageKey()); } catch {}
}
function markDirty() {
  state.dirty = true;
  $("unsaved").hidden = false;
  $("unsaved").textContent = "Изменения и подтверждения ещё не сохранены";
}
function markSaved() { state.dirty = false; $("unsaved").hidden = true; }
function selectPane(pane) {
  $("create").dataset.pane = pane;
  document.querySelectorAll(".agent-mobile-tabs button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.pane === pane));
  });
}
document.querySelectorAll(".agent-mobile-tabs button").forEach(button => {
  button.addEventListener("click", () => selectPane(button.dataset.pane));
});
function lockAgent() {
  const pending = agent.sending || agent.run?.status === "pending";
  $("send-message").disabled = pending;
  $("send-message").setAttribute("aria-busy", String(pending));
  for (const node of $("editor").querySelectorAll("input,textarea,button")) node.disabled = pending;
  $("new-task").disabled = pending;
  $("retry-message").disabled = pending;
  $("reload-agent").disabled = pending;
  $("agent-activity").hidden = !pending;
  $("agent-status").textContent = pending ? "Работаю над вашим сообщением" :
    agent.run?.status === "failed" ? "Сообщение сохранено · нужен повтор" :
    agent.messages.length ? "История сохранена · можно продолжать" : "Начните с того, что важно";
}
function focusField(field) {
  selectPane("card");
  const input = $("field-" + field);
  const details = input?.closest("details");
  if (details) details.open = true;
  input?.focus({preventScroll:true});
  input?.scrollIntoView({block:"nearest", behavior:"auto"});
}
function renderEditor(card, confirmed = []) {
  const target = $("card-fields"); target.replaceChildren();
  for (const [key, label] of Object.entries(FIELDS)) {
    const wrapper = el(key === "title" ? "div" : "details", null, key === "title" ? "preview-title" : "preview-field");
    const input = el(key === "title" ? "input" : "textarea");
    input.id = "field-" + key; input.value = card[key] || "";
    input.maxLength = key === "title" ? 160 : 2000;
    input.placeholder = key === "title" ? "Название появится здесь" : "Пока не уточнили";
    let checkbox;
    if (key === "title") {
      const title = el("label", label); title.htmlFor = input.id;
      wrapper.append(title, input);
    } else {
      input.rows = 3;
      const summary = el("summary", label);
      const badge = el("span", confirmed.includes(key) ? "Проверено" : card[key] ? "Проверить" : "", "field-state");
      badge.classList.toggle("confirmed", confirmed.includes(key));
      summary.append(badge);
      const value = el("p", card[key] || "Уточним в диалоге", "field-value" + (card[key] ? "" : " empty"));
      const edit = el("div", null, "field-editor"), inputLabel = el("label", label);
      inputLabel.htmlFor = input.id; inputLabel.className = "sr-only";
      const confirmLabel = el("label", "Подтверждаю эти сведения", "check");
      checkbox = el("input"); checkbox.type = "checkbox"; checkbox.id = "confirm-" + key;
      checkbox.checked = confirmed.includes(key);
      checkbox.addEventListener("change", () => {
        markDirty(); badge.textContent = checkbox.checked ? "Сохраните" : "Проверить";
        badge.classList.remove("confirmed");
      });
      confirmLabel.prepend(checkbox); edit.append(inputLabel, input, confirmLabel);
      summary.append(value); wrapper.append(summary, edit);
      input.addEventListener("input", () => {
        value.textContent = input.value || "Уточним в диалоге";
        value.classList.toggle("empty", !input.value);
        badge.textContent = input.value ? "Проверить" : "";
        badge.classList.remove("confirmed");
      });
    }
    input.addEventListener("input", () => { if (checkbox) checkbox.checked = false; markDirty(); });
    target.append(wrapper);
  }
}
function showScore(task) {
  $("score").textContent = task.score;
  $("preview-score").textContent = "Готовность " + task.score + "/100";
  $("readiness-ring").style.setProperty("--progress", (task.score * 3.6) + "deg");
  $("readiness-ring").setAttribute("aria-label", "Готовность: " + task.score + " из 100");
  $("context-title").textContent = task.card.title || "Новая возможность";
  $("task-state").textContent = task.status === "published" ? "В каталоге" : "Черновик";
  $("level").textContent = "Готовность · " + LEVELS[task.level].toLowerCase();
  const fields = Object.keys(FIELDS).filter(key => key !== "title");
  $("filled-count").textContent = fields.filter(key => task.card[key]?.trim()).length + " / 9";
  $("agent-checklist").replaceChildren(...fields.map(key => {
    const li = el("li"), button = el("button");
    button.type = "button";
    const checked = task.score_breakdown?.[key] > 0;
    button.className = checked ? "confirmed" : task.card[key] ? "filled" : "";
    button.append(el("i"), el("span", FIELDS[key]));
    button.setAttribute("aria-label", FIELDS[key] + (checked ? ": подтверждено" : task.card[key] ? ": нужно проверить" : ": не заполнено"));
    button.addEventListener("click", () => focusField(key)); li.append(button); return li;
  }));
  $("publish").hidden = task.status === "published";
  $("publication-hint").textContent = task.status === "published"
    ? "Задача в каталоге. Чат доступен для обсуждения; изменения публикации вносите вручную."
    : "Публикация откроет все поля карточки, включая контакт. Можно с любым рейтингом.";
}
function renderMessages() {
  $("chat-welcome").hidden = agent.messages.length > 0;
  const target = $("chat-messages");
  const known = new Set([...target.children].map(node => node.dataset.id));
  for (const item of agent.messages) {
    if (known.has(String(item.id))) continue;
    const row = el("article", null, "chat-message " + item.role); row.dataset.id = String(item.id);
    const avatar = el("span", "✳", "message-avatar"); avatar.setAttribute("aria-hidden", "true");
    const body = el("div", null, "message-body");
    body.append(el("span", item.role === "user" ? "Вы" : "SOLVEX", "message-author"), el("p", item.text, "message-text"));
    const time = el("time", new Date(item.created_at).toLocaleTimeString("ru", {hour:"2-digit",minute:"2-digit"}), "message-time");
    time.dateTime = item.created_at; body.append(time); row.append(avatar, body); target.append(row);
  }
  const scroll = $("chat-scroll"); scroll.scrollTop = scroll.scrollHeight;
}
function acceptSnapshot(data, replaceCard = true) {
  agent.task = data.task; agent.messages = data.messages; agent.run = data.run;
  state.taskId = data.task.id; state.card = data.task.card;
  rememberTask(data.task.id);
  if (replaceCard && !state.dirty) {
    $("topic").value = data.task.topic === "Без темы" ? "" : data.task.topic;
    renderEditor(data.task.card, data.task.confirmed_fields); markSaved();
  }
  if (agent.request?.id === data.run?.request_id && data.messages.some(m => m.role === "user" && m.text === agent.request.text)) {
    if ($("chat-input").value.trim() === agent.request.text) { $("chat-input").value = ""; state.sourceDirty = false; }
  }
  showScore(data.task); renderMessages(); upsertBusinessTask(data.task);
  $("agent-error").hidden = data.run?.status !== "failed";
  $("agent-error-text").textContent = data.run?.error || "";
  $("retry-message").hidden = data.run?.status !== "failed";
  lockAgent();
  requestAnimationFrame(() => { $("chat-scroll").scrollTop = $("chat-scroll").scrollHeight; });
}
function resetAgent() {
  clearTimeout(agent.polling); agent.generation++;
  Object.assign(agent, {task:null,messages:[],run:null,sending:false,request:null});
  state.taskId = null; state.card = null; state.sourceDirty = false;
  $("chat-messages").replaceChildren(); $("chat-input").value = ""; $("topic").value = "";
  $("chat-welcome").hidden = false; $("agent-error").hidden = true;
  renderEditor(blankCard()); markSaved();
  showScore({card:blankCard(),confirmed_fields:[],score:0,level:"draft",status:"draft",score_breakdown:{}});
  lockAgent(); selectPane("chat");
}
async function initAgent() {
  resetAgent();
  let id; try { id = Number(sessionStorage.getItem(storageKey())); } catch {}
  if (id > 0) {
    try { await openSavedTask(id, true); }
    catch (error) { if (error.status === 404) rememberTask(null); message(error.message, true); }
  }
}
async function openSavedTask(id, initial = false) {
  if (!initial && !canReplaceWork()) return;
  const generation = ++agent.generation;
  const data = await api("/api/me/agent/" + id);
  if (generation !== agent.generation) return;
  clearTimeout(agent.polling);
  state.sourceDirty = false; markSaved();
  $("chat-input").value = ""; $("chat-messages").replaceChildren();
  acceptSnapshot(data); selectPane("chat");
  if (!initial) view("create");
  if (data.run?.status === "pending") pollAgent();
}
async function ensureTask() {
  if (agent.task) return;
  let id;
  try { id = sessionStorage.getItem(storageKey() + "-create"); } catch {}
  id ||= crypto.randomUUID();
  try { sessionStorage.setItem(storageKey() + "-create", id); } catch {}
  const data = await api("/api/me/agent", "POST", {request_id:id});
  // Preserve a card the user has already typed by hand.
  acceptSnapshot(data, false);
  try { sessionStorage.removeItem(storageKey() + "-create"); } catch {}
}
function readEditor() {
  const card = {}, confirmed_fields = [];
  for (const key of Object.keys(FIELDS)) {
    card[key] = $("field-" + key).value.trim();
    if (key !== "title" && $("confirm-" + key).checked) confirmed_fields.push(key);
  }
  return {topic:$("topic").value.trim() || "Без темы", card, confirmed_fields, expected_revision:agent.task?.revision};
}
async function saveCard() {
  await ensureTask();
  const task = await api("/api/me/tasks/" + agent.task.id, "PUT", readEditor());
  agent.task = task; state.card = task.card; state.taskId = task.id;
  showScore(task); upsertBusinessTask(task); markSaved();
  for (const key of Object.keys(FIELDS).filter(key => key !== "title")) {
    const badge = $("field-" + key).closest("details").querySelector(".field-state");
    const checked = task.score_breakdown[key] > 0;
    badge.classList.toggle("confirmed", checked);
    badge.textContent = checked ? "Проверено" : task.card[key] ? "Проверить" : "";
  }
  message("Карточка сохранена. Рейтинг " + task.score + "/100.");
  return task;
}
function pollAgent(delay = 1800) {
  clearTimeout(agent.polling);
  const generation = agent.generation, id = agent.task?.id;
  if (!id) return;
  agent.polling = setTimeout(async () => {
    if (generation !== agent.generation) return;
    try {
      const data = await api("/api/me/agent/" + id);
      if (generation !== agent.generation) return;
      acceptSnapshot(data);
      if (data.run?.status === "pending") pollAgent();
    } catch (error) {
      if (generation !== agent.generation) return;
      $("agent-error").hidden = false; $("agent-error-text").textContent = error.message;
      $("retry-message").hidden = true;
      // A failed read is not evidence that the server run failed.
      agent.run = null; lockAgent();
    }
  }, delay);
}
async function sendMessage(retry = false) {
  if (agent.sending || agent.run?.status === "pending") return;
  const text = retry ? [...agent.messages].reverse().find(m => m.role === "user")?.text : $("chat-input").value.trim();
  if (!text) { $("chat-input").focus(); return; }
  const requestId = retry ? agent.run.request_id : (agent.request?.text === text ? agent.request.id : crypto.randomUUID());
  agent.request = {id:requestId,text};
  agent.sending = true; state.busy = true; lockAgent(); message("");
  const generation = agent.generation;
  try {
    await ensureTask();
    if (state.dirty) await saveCard();
    const request = api("/api/me/agent/" + agent.task.id + "/messages", "POST",
      {request_id:requestId,text,revision:agent.task.revision}, 55000);
    pollAgent(150);
    const data = await request;
    if (generation !== agent.generation) return;
    acceptSnapshot(data);
    if (!retry && $("chat-input").value.trim() === text) {
      $("chat-input").value = ""; state.sourceDirty = false;
    }
    agent.request = null;
    if (data.run?.status === "pending") pollAgent();
  } catch (error) {
    if (generation !== agent.generation) return;
    $("agent-error").hidden = false; $("agent-error-text").textContent = error.message;
    $("retry-message").hidden = true;
    // Keep the text and UUID so a lost response cannot send the same message twice.
  } finally {
    agent.sending = false; state.busy = false; lockAgent();
  }
}
$("chat-form").addEventListener("submit", event => { event.preventDefault(); sendMessage(); });
$("chat-input").addEventListener("input", () => { state.sourceDirty = Boolean($("chat-input").value.trim()); });
$("chat-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); sendMessage(); }
});
$("retry-message").addEventListener("click", () => sendMessage(true));
$("reload-agent").addEventListener("click", () => {
  if (agent.task) openSavedTask(agent.task.id).catch(error => message(error.message, true));
});
$("topic").addEventListener("input", markDirty);
$("save").addEventListener("click", event => action(event.currentTarget, saveCard));
$("publish").addEventListener("click", event => action(event.currentTarget, async () => {
  await saveCard();
  const task = await api("/api/me/tasks/" + agent.task.id + "/publish", "POST", {});
  agent.task = task; showScore(task); upsertBusinessTask(task);
  message("Задача «" + task.card.title + "» опубликована. Рейтинг " + task.score + "/100.");
}));
$("new-task").addEventListener("click", () => {
  if (state.busy || !canReplaceWork()) return;
  resetAgent(); rememberTask(null);
  try { sessionStorage.removeItem(storageKey() + "-create"); } catch {}
  message(""); $("chat-input").focus();
});
document.querySelectorAll("[data-starter]").forEach(button => button.addEventListener("click", () => {
  $("chat-input").value = button.dataset.starter; state.sourceDirty = true; $("chat-input").focus();
}));
boot();
