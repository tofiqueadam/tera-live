import { STRINGS, translate } from './strings.js';

const KEY = 'tera.lang';
let lang = 'en';

export function initLang(param) {
  const stored = safeGet(KEY);
  const nav = (navigator.language || '').toLowerCase().startsWith('am') ? 'am' : null;
  setLang(param || stored || nav || 'en', false);
}

export function setLang(next, persist = true) {
  lang = STRINGS[next] ? next : 'en';
  document.documentElement.lang = lang;
  if (persist) safeSet(KEY, lang);
  apply();
}

export const getLang = () => lang;
export const t = (key, vars) => translate(lang, key, vars);

/** Fill static markup tagged with data-i18n / data-i18n-placeholder / data-i18n-aria. */
export function apply(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  const langBtn = document.getElementById('lang-btn');
  if (langBtn) langBtn.lang = lang === 'en' ? 'am' : 'en';
}

export function safeGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function safeSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}
