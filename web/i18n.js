"use strict";

// Only marked interface text is localized. User content is always a plain string.
(() => {
  let locale = "ru";
  try { locale = localStorage.getItem("solvex-language") === "en" ? "en" : "ru"; } catch {}
  const bindings = new Set(), values = new WeakMap(), switches = new WeakSet();
  class Text {
    constructor(source, args = [], parts = null, lower = false) { this.source = source; this.args = args; this.parts = parts; this.lower = lower; }
    toString() {
      let result = this.parts ? this.parts.map(v => String(v ?? "")).join("") :
        (locale === "en" ? window.SolvexTranslations[this.source] ?? this.source : this.source).replace(/\{(\d+)\}/g, (_, i) => String(this.args[i] ?? ""));
      return this.lower ? result.toLocaleLowerCase(locale) : result;
    }
    toLowerCase() { return new Text(this.source, this.args, this.parts, true); }
    toJSON() { return String(this); }
  }
  function text(source, ...args) { return new Text(source, args); }
  function combine(...parts) { return parts.some(v => v instanceof Text) ? new Text("", [], parts) : parts.reduce((a, b) => a + b); }
  function bind(node, property, value) {
    let map = values.get(node); if (!map) { map = new Map(); values.set(node, map); }
    const old = map.get(property); if (old) bindings.delete(old);
    if (value instanceof Text) { const binding = {reference:new WeakRef(node), property, value}; map.set(property, binding); bindings.add(binding); }
    else map.delete(property);
    if (property.startsWith("@")) node.setAttribute(property.slice(1), String(value ?? ""));
    else node[property] = String(value ?? "");
  }
  function set(node, value) {
    if (node.nodeType === Node.TEXT_NODE) { bind(node, 'data', value); return value; }
    const child = document.createTextNode(""); node.replaceChildren(child); bind(child, "data", value);
    return value;
  }
  function attribute(node, key, value) { bind(node, "@" + key, value); }
  function staticText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest("script,style")) continue;
      const raw = node.data, source = raw.trim();
      if (Object.hasOwn(window.SolvexTranslations, source)) {
        bind(node, "data", combine(raw.slice(0, raw.indexOf(source)), text(source), raw.slice(raw.indexOf(source) + source.length)));
      }
    }
    for (const node of [root, ...root.querySelectorAll("*")]) {
      if (!(node instanceof Element)) continue;
      for (const key of ["placeholder", "aria-label", "title", "data-starter", "content"]) {
        const source = node.getAttribute(key);
        if (source && Object.hasOwn(window.SolvexTranslations, source)) attribute(node, key, text(source));
      }
    }
    root.querySelectorAll('[data-language]').forEach(select => {
      select.value = locale;
      if (!switches.has(select)) { switches.add(select); select.addEventListener('change', () => change(select.value)); }
    });
  }
  function refresh() {
    document.documentElement.lang = locale;
    for (const binding of bindings) {
      const node = binding.reference.deref();
      if (!node?.isConnected) { bindings.delete(binding); continue; }
      if (binding.property.startsWith("@")) node.setAttribute(binding.property.slice(1), String(binding.value));
      else node[binding.property] = String(binding.value);
    }
    document.querySelectorAll("[data-language]").forEach(select => { select.value = locale; });
  }
  function change(next) {
    locale = next === "en" ? "en" : "ru";
    try { localStorage.setItem("solvex-language", locale); } catch {}
    refresh(); window.dispatchEvent(new CustomEvent("solvex:language", {detail:locale}));
  }
  function option(label, value) { const node = document.createElement("option"); node.value = value; set(node, label); return node; }
  function value(node) { return values.get(node.firstChild)?.get('data')?.value ?? node.textContent; }
  function failure(error) {
    if (locale === 'ru') return error?.message || 'Не удалось выполнить запрос';
    const message = error?.message;
    if (message && window.SolvexTranslations[message]) return text(message);
    return {VALIDATION_ERROR:'Check the field values and file format.', FORBIDDEN:'You do not have access to this action. Refresh your session and try again.',
      NOT_FOUND:'The requested item was not found.', CONFLICT:'The data changed or this action is already in progress. Refresh and try again.',
      PROFILE_REQUIRED:'Complete your team profile first.', UNAUTHORIZED:'Sign in to continue.', RATE_LIMITED:'Too many attempts. Please try again later.',
      AI_NOT_CONFIGURED:'AI is not configured on the server.', AI_UNAVAILABLE:'AI is temporarily unavailable. Your data is saved; please retry.',
      QUOTA_EXCEEDED:'Your daily AI allowance is used up. Saved work remains available. Limits reset at midnight Kazakhstan time (UTC+05:00).',
      BILLING_NOT_CONFIGURED:'Payments are not connected yet. No subscription was activated or payment taken.',
      AI_TIMEOUT:'AI did not respond in time. Please retry.', AI_INVALID_OUTPUT:'AI returned an invalid result. Please retry.'}[error?.code] || 'The request could not be completed. Please try again.';
  }
  window.SolvexI18n = {text, combine, set, attribute, staticText, option, value, failure, get locale() { return locale; }, change};
  staticText(document.documentElement); refresh();
  window.addEventListener("storage", event => { if (event.key === "solvex-language") change(event.newValue); });
})();
