"use strict";

(() => {
  let mode = "register", current = null, pending = null, busy = false;
  const dialog = document.createElement("dialog");
  dialog.className = "auth-dialog";
  dialog.setAttribute("aria-labelledby", "auth-title");
  dialog.innerHTML = '<div class="auth-inner"><button type="button" class="auth-close" aria-label="Закрыть окно">×</button><a class="solvex-brand" href="/"><img src="/static/assets/mark.svg" width="30" height="30" alt=""><span>SOLVEX</span></a><label class="language-switch auth-language"><span class="sr-only">Язык интерфейса</span><select data-language aria-label="Язык интерфейса"><option value="ru">RU</option><option value="en">EN</option></select></label><h2 id="auth-title">Начнём с вас</h2><p class="auth-description" id="auth-description"></p><form id="auth-form"><fieldset class="role-choice" id="auth-roles"><legend>Как вы хотите участвовать?</legend><label><input type="radio" name="role" value="BUSINESS" checked>Я представляю бизнес</label><label><input type="radio" name="role" value="TEAM">Я в команде</label></fieldset><label for="auth-email">Электронная почта</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@company.ru" required maxlength="254"><label for="auth-password">Пароль</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="password-note"><small id="password-note" class="password-note">От 12 символов. Можно использовать фразу.</small><p id="auth-error" class="auth-error" role="alert" aria-live="polite"></p><button class="button primary" id="auth-submit" type="submit">Создать аккаунт →</button></form><p class="auth-switch"><span id="auth-switch-label"></span> <button type="button" id="auth-switch"></button></p><p class="auth-note">Здесь ваша задача становится понятной.<br>А следующий шаг — возможным.</p></div>';
  document.body.append(dialog);
  SolvexI18n.staticText(dialog);
  const byId = id => document.getElementById(id);
  window.addEventListener("solvex:language", () => dialog.querySelectorAll("input").forEach(input => input.setCustomValidity("")));

  async function request(path, method = "GET", body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {method, credentials: "same-origin", cache: "no-store",
        headers: body ? {"Content-Type": "application/json"} : {},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal});
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(SolvexI18n.failure(data.error));
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error(SolvexI18n.text("Сервер не ответил вовремя. Попробуйте ещё раз."));
      if (error instanceof TypeError) throw new Error(SolvexI18n.text("Нет связи с сервером. Проверьте подключение и повторите."));
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function getSession(force = false) {
    if (pending && !force) return pending;
    pending = request("/api/auth/me").then(data => { current = data; return data; })
      .catch(error => {
        pending = null;
        if (error.status === 401) { current = null; return null; }
        throw error;
      });
    return pending;
  }
  function setMode(next) {
    mode = next;
    const register = mode === "register";
    SolvexI18n.set(byId("auth-title"),register ? SolvexI18n.text("Начнём с вас") : SolvexI18n.text("С возвращением"));
    SolvexI18n.set(byId("auth-description"),register
      ? SolvexI18n.text("Один аккаунт — от первой идеи до совместной работы.")
      : SolvexI18n.text("Ваши задачи и следующие шаги уже здесь."));
    byId("auth-roles").hidden = !register;
    byId("auth-password").minLength = register ? 12 : 1;
    byId("auth-password").autocomplete = register ? "new-password" : "current-password";
    byId("password-note").hidden = !register;
    SolvexI18n.set(byId("auth-submit"),register ? SolvexI18n.text("Создать аккаунт →") : SolvexI18n.text("Войти →"));
    SolvexI18n.set(byId("auth-switch-label"),register ? SolvexI18n.text("Уже с нами?") : SolvexI18n.text("Первый раз здесь?"));
    SolvexI18n.set(byId("auth-switch"),register ? SolvexI18n.text("Войти") : SolvexI18n.text("Создать аккаунт"));
    SolvexI18n.set(byId("auth-error"),"");
    byId("auth-password").setCustomValidity("");
  }
  function open(next = "login", role = "BUSINESS") {
    if (busy) return;
    setMode(next);
    dialog.querySelector('input[value="' + (role === "TEAM" ? "TEAM" : "BUSINESS") + '"]').checked = true;
    if (!dialog.open) dialog.showModal();
    byId("auth-email").focus();
  }
  function close() { if (!busy) dialog.close(); }
  dialog.querySelector(".auth-close").addEventListener("click", close);
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    byId("auth-password").value = "";
    SolvexI18n.set(byId("auth-error"),"");
  });
  byId("auth-switch").addEventListener("click", () => { if (!busy) setMode(mode === "login" ? "register" : "login"); });
  for (const input of [byId("auth-email"), byId("auth-password")]) {
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("invalid", () => {
      input.setCustomValidity(input.id === "auth-email"
        ? SolvexI18n.text("Введите корректный адрес электронной почты.")
        : mode === "register" ? SolvexI18n.text("Введите пароль длиной от 12 до 128 символов.") : SolvexI18n.text("Введите пароль."));
    });
  }
  byId("auth-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = byId("auth-submit"), label = SolvexI18n.value(button);
    const controls = [...dialog.querySelectorAll("input,button")];
    controls.forEach(control => { control.disabled = true; });
    SolvexI18n.set(button,mode === "register" ? SolvexI18n.text("Создаём аккаунт…") : SolvexI18n.text("Входим…"));
    button.setAttribute("aria-busy", "true");
    SolvexI18n.set(byId("auth-error"),"");
    const payload = {email: byId("auth-email").value.trim(), password: byId("auth-password").value};
    if (mode === "register") payload.role = dialog.querySelector('input[name="role"]:checked').value;
    try {
      current = await request("/api/auth/" + mode, "POST", payload);
      pending = Promise.resolve(current);
      byId("auth-password").value = "";
      dialog.close();
      if (document.body.dataset.workspace === "true") {
        window.dispatchEvent(new CustomEvent("solvex:session", {detail: current}));
      } else { location.assign("/app"); }
    } catch (error) {
      SolvexI18n.set(byId("auth-error"),error.message);
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      SolvexI18n.set(button,label);
      button.removeAttribute("aria-busy");
    }
  });
  document.querySelectorAll("[data-auth]").forEach(button => button.addEventListener("click", () => {
    if (current) { location.assign("/app"); return; }
    open(button.dataset.auth, button.dataset.role);
  }));
  window.SolvexAuth = {getSession, open};
  if (document.body.classList.contains("landing")) {
    getSession().then(session => {
      if (session) {
        document.querySelectorAll(".header-actions [data-auth]").forEach(node => { node.hidden = true; });
        byId("return-to-app").hidden = false;
      } else if (new URLSearchParams(location.search).get("auth") === "login") {
        open("login");
        history.replaceState(null, "", "/");
      }
    }).catch(() => {});
  }
})();
