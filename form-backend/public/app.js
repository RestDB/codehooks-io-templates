// Boot, login gate, form rail, tabs. The list and record panes are wired by
// later tasks — this module only owns the shell: signing in, which form is
// selected, and which tab is showing.

import { login, listForms, createForm } from './api.js';
import { el, clear, toast, setBusy } from './ui.js';
import { relativeTime, formatCount } from './format.js';

export const state = { forms: [], formId: null, tab: 'submissions' };

const loginEl = document.getElementById('login');
const appEl = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const passwordInput = document.getElementById('password');

const railEl = document.getElementById('rail');
const railSelect = document.getElementById('rail-select');
const railFoot = document.getElementById('rail-foot');
const newFormBtn = document.getElementById('new-form');

const tabSubmissions = document.getElementById('tab-submissions');
const tabSettings = document.getElementById('tab-settings');
const recordEl = document.getElementById('record');
const paneSettings = document.getElementById('pane-settings');
const rowsEl = document.getElementById('rows');
const filterRows = document.querySelectorAll('.filters');
const listFoot = document.querySelector('.list-foot');

// #app ships with the `hidden` attribute in index.html, but `.panes` in
// app.css hard-codes `display: grid`, which — as author CSS — outranks the
// browser's default `[hidden] { display: none }` rule at equal specificity.
// Left alone, #app would flash visible (stacked under the login gate) on
// every load until boot() resolves. Force it off immediately, synchronously,
// before the first paint has a chance to show it. See setHidden() below.
appEl.style.display = 'none';

// Every api call funnels through here so a rejection becomes a toast rather
// than an unhandled promise rejection. Returns undefined on failure.
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  }
}

function dispatchFormChanged() {
  window.dispatchEvent(new CustomEvent('form-changed'));
}

// `.gate`, `.panes`, `.record` and `.filters`/`.list-foot` in app.css each set
// their own explicit `display`, which — being author CSS — outranks the
// browser's default `[hidden] { display: none }` UA rule at equal specificity.
// Toggling the `hidden` IDL property alone therefore does not visually hide
// these elements. This also drives inline `display` so hiding actually works;
// clearing it on show lets the element's own class supply its display again.
function setHidden(node, hidden) {
  node.hidden = hidden;
  node.style.display = hidden ? 'none' : '';
}

// The one place newCount/newCountExact turn into what the rail shows. A
// failed count query reports {newCount: 0, newCountExact: false} — that must
// never render as a confident "0", so it renders no badge at all.
function badgeText(form) {
  if (form.newCountExact === false && form.newCount === 0) return null;
  return formatCount(form.newCount, form.newCountExact);
}

function buildRailItem(form) {
  const btn = el('button', 'rail-item');
  btn.type = 'button';
  const current = form._id === state.formId;
  btn.setAttribute('aria-current', current ? 'true' : 'false');
  btn.appendChild(el('span', null, form.name));

  const text = badgeText(form);
  if (text !== null) {
    const badge = el('span', 'badge', text);
    badge.setAttribute('data-zero', text === '0' ? 'true' : 'false');
    btn.appendChild(badge);
  }

  btn.addEventListener('click', () => selectForm(form._id));
  return btn;
}

function renderRailFoot() {
  clear(railFoot);
  const total = state.forms.reduce((sum, f) => sum + (f.stats?.total || 0), 0);
  railFoot.appendChild(el('div', null, total + (total === 1 ? ' submission' : ' submissions')));

  let latest = null;
  for (const f of state.forms) {
    const at = f.stats?.lastSubmissionAt;
    if (!at) continue;
    if (!latest || new Date(at) > new Date(latest)) latest = at;
  }
  if (latest) {
    railFoot.appendChild(el('div', null, 'last ' + relativeTime(latest)));
  }
}

function renderRail() {
  clear(railEl);
  clear(railSelect);

  for (const form of state.forms) {
    railEl.appendChild(buildRailItem(form));

    const opt = document.createElement('option');
    opt.value = form._id;
    opt.textContent = form.name;
    if (form._id === state.formId) opt.selected = true;
    railSelect.appendChild(opt);
  }

  renderRailFoot();
}

// The only place state.formId is written, so "dispatch form-changed whenever
// it changes" can't be forgotten at a second call site.
function setFormId(id) {
  if (state.formId === id) return;
  state.formId = id;
  dispatchFormChanged();
}

export function selectForm(id) {
  setFormId(id);
  renderRail();
}

function applyForms(list) {
  state.forms = Array.isArray(list) ? list : [];
  if (!state.forms.some((f) => f._id === state.formId)) {
    setFormId(state.forms[0] ? state.forms[0]._id : null);
  }
  renderRail();
}

export async function refreshForms() {
  await guarded(async () => {
    const res = await listForms();
    applyForms(res.data);
  });
}

railSelect.addEventListener('change', () => selectForm(railSelect.value));

// --- new form, inline prompt (never window.prompt) --------------------------

let newFormRow = null;

function closeNewFormPrompt() {
  if (newFormRow) {
    newFormRow.remove();
    newFormRow = null;
  }
}

function openNewFormPrompt() {
  if (newFormRow) {
    newFormRow.querySelector('input').focus();
    return;
  }

  const row = el('div', 'note-add');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Form name';
  input.setAttribute('aria-label', 'New form name');
  row.appendChild(input);

  const create = el('button', 'act primary', 'Create');
  create.type = 'button';
  row.appendChild(create);

  const cancel = el('button', 'act', 'Cancel');
  cancel.type = 'button';
  row.appendChild(cancel);

  newFormBtn.insertAdjacentElement('afterend', row);
  newFormRow = row;
  input.focus();

  cancel.addEventListener('click', closeNewFormPrompt);

  const submit = async () => {
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    setBusy(create, true);
    const created = await guarded(async () => {
      const res = await createForm(name);
      await refreshForms();
      return res.data;
    });
    setBusy(create, false);
    if (created) {
      closeNewFormPrompt();
      selectForm(created._id);
    }
  };

  create.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeNewFormPrompt();
    }
  });
}

newFormBtn.addEventListener('click', openNewFormPrompt);

// --- tabs --------------------------------------------------------------------

function setTab(tab) {
  state.tab = tab;
  const submissionsActive = tab === 'submissions';

  tabSubmissions.setAttribute('aria-selected', submissionsActive ? 'true' : 'false');
  tabSettings.setAttribute('aria-selected', submissionsActive ? 'false' : 'true');

  setHidden(recordEl, !submissionsActive);
  setHidden(paneSettings, submissionsActive);
  setHidden(rowsEl, !submissionsActive);
  setHidden(listFoot, !submissionsActive);
  filterRows.forEach((row) => {
    setHidden(row, !submissionsActive);
  });
}

tabSubmissions.addEventListener('click', () => setTab('submissions'));
tabSettings.addEventListener('click', () => setTab('settings'));

// --- session lifecycle ---------------------------------------------------------

function showApp() {
  setHidden(loginEl, true);
  setHidden(appEl, false);
}

function showLogin() {
  setHidden(loginEl, false);
  setHidden(appEl, true);
}

async function boot() {
  try {
    const res = await listForms();
    applyForms(res.data);
    showApp();
    sessionExpiredHandled = false;
  } catch {
    // A thrown error here means there is no session — not an error to toast,
    // just the normal "please sign in" state.
    showLogin();
  }
}

// api.js fires a fresh `session-expired` event on every 401 with no
// de-duplication of its own — two concurrent requests that both 401 fire it
// twice. This handler is the only listener, so de-duplication belongs here:
// two events in quick succession show the gate once and toast once.
let sessionExpiredHandled = false;
window.addEventListener('session-expired', () => {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;
  showLogin();
  toast('Your session has expired. Sign in again.', 'error');
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const password = passwordInput.value;

  setBusy(submitBtn, true);
  try {
    await login(password);
    passwordInput.value = '';
    await boot();
  } catch (err) {
    loginError.textContent = err.message;
    passwordInput.focus();
  } finally {
    setBusy(submitBtn, false);
  }
});

boot();
