"use strict";

(() => {
  let mode = "register", current = null, pending = null, busy = false;
  const dialog = document.createElement("dialog");
  dialog.className = "auth-dialog";
  dialog.setAttribute("aria-labelledby", "auth-title");
  dialog.innerHTML = '<div class="auth-inner"><button type="button" class="auth-close" aria-label="Закрыть окно">×</button><a class="solvex-brand" href="/"><img src="/static/assets/mark.svg" width="30" height="30" alt=""><span>SOLVEX</span></a><h2 id="auth-title">Начнём с вас</h2><p class="auth-description" id="auth-description"></p><form id="auth-form"><fieldset class="role-choice" id="auth-roles"><legend>Как вы хотите участвовать?</legend><label><input type="radio" name="role" value="BUSINESS" checked>Я представляю бизнес</label><label><input type="radio" name="role" value="TEAM">Я в команде</label></fieldset><label for="auth-email">Электронная почта</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@company.ru" required maxlength="254"><label for="auth-password">Пароль</label><input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="password-note"><small id="password-note" class="password-note">От 12 символов. Можно использовать фразу.</small><p id="auth-error" class="auth-error" role="alert" aria-live="polite"></p><button class="button primary" id="auth-submit" type="submit">Создать аккаунт →</button></form><p class="auth-switch"><span id="auth-switch-label"></span> <button type="button" id="auth-switch"></button></p><p class="auth-note">Здесь ваша задача становится понятной.<br>А следующий шаг — возможным.</p></div>';
  document.body.append(dialog);
  const byId = id => document.getElementById(id);

  async function request(path, method = "GET", body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(path, {method, credentials: "same-origin", cache: "no-store",
        headers: body ? {"Content-Type": "application/json"} : {},
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal});
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error?.message || "Не удалось выполнить запрос");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Сервер не ответил вовремя. Попробуйте ещё раз.");
      if (error instanceof TypeError) throw new Error("Нет связи с сервером. Проверьте подключение и повторите.");
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
    byId("auth-title").textContent = register ? "Начнём с вас" : "С возвращением";
    byId("auth-description").textContent = register
      ? "Один аккаунт — от первой идеи до совместной работы."
      : "Ваши задачи и следующие шаги уже здесь.";
    byId("auth-roles").hidden = !register;
    byId("auth-password").minLength = register ? 12 : 1;
    byId("auth-password").autocomplete = register ? "new-password" : "current-password";
    byId("password-note").hidden = !register;
    byId("auth-submit").textContent = register ? "Создать аккаунт →" : "Войти →";
    byId("auth-switch-label").textContent = register ? "Уже с нами?" : "Первый раз здесь?";
    byId("auth-switch").textContent = register ? "Войти" : "Создать аккаунт";
    byId("auth-error").textContent = "";
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
    byId("auth-error").textContent = "";
  });
  byId("auth-switch").addEventListener("click", () => { if (!busy) setMode(mode === "login" ? "register" : "login"); });
  for (const input of [byId("auth-email"), byId("auth-password")]) {
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("invalid", () => {
      input.setCustomValidity(input.id === "auth-email"
        ? "Введите корректный адрес электронной почты."
        : mode === "register" ? "Введите пароль длиной от 12 до 128 символов." : "Введите пароль.");
    });
  }
  byId("auth-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = byId("auth-submit"), label = button.textContent;
    const controls = [...dialog.querySelectorAll("input,button")];
    controls.forEach(control => { control.disabled = true; });
    button.textContent = mode === "register" ? "Создаём аккаунт…" : "Входим…";
    button.setAttribute("aria-busy", "true");
    byId("auth-error").textContent = "";
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
      byId("auth-error").textContent = error.message;
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      button.textContent = label;
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
