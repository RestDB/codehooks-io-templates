// Boot, login gate, form rail, tabs. The list and record panes are wired by
// later tasks — this module only owns the shell: signing in, which form is
// selected, and which tab is showing.

import { login, logout, listForms, createForm } from './api.js';
import { el, clear, toast, setBusy, openModal, closeModal, modalError, emptyState, dropdown } from './ui.js';
import { relativeTime, formatCount } from './format.js';
import { initList } from './submissions.js';

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
const logoutBtn = document.getElementById('logout');

const tabSubmissions = document.getElementById('tab-submissions');
const tabSettings = document.getElementById('tab-settings');
const recordEl = document.getElementById('record');
const paneSettings = document.getElementById('pane-settings');
const rowsEl = document.getElementById('rows');
const filterRows = document.querySelectorAll('.filters');
const listFoot = document.querySelector('.list-foot');

// Every api call funnels through here so a rejection becomes a toast rather
// than an unhandled promise rejection. Returns undefined on failure.
// Every api call goes through here, so a rejection becomes a visible message
// rather than an unhandled promise rejection. `onError` lets a caller show the
// message somewhere more useful than a toast — inside an open modal, say.
async function guarded(fn, onError) {
  try {
    return await fn();
  } catch (err) {
    if (onError) onError(err.message);
    else toast(err.message, 'error');
    return undefined;
  }
}

function dispatchFormChanged() {
  window.dispatchEvent(new CustomEvent('form-changed'));
}

// The one place newCount/newCountExact turn into what the rail shows. A
// failed count query reports {newCount: 0, newCountExact: false} — that must
// never render as a confident "0", so it renders no badge at all.
function badgeText(form) {
  if (form.newCountExact === false && form.newCount === 0) return null;
  return formatCount(form.newCount, form.newCountExact);
}

function buildRailItem(form) {
  const btn = el('button', 'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-body transition hover:bg-white/70 aria-[current=true]:bg-white aria-[current=true]:font-medium aria-[current=true]:text-ink aria-[current=true]:shadow-sm');
  btn.type = 'button';
  const current = form._id === state.formId;
  btn.setAttribute('aria-current', current ? 'true' : 'false');
  btn.appendChild(el('span', null, form.name));

  const text = badgeText(form);
  if (text !== null) {
    const badge = el('span', 'chip', text);
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

  for (const form of state.forms) {
    railEl.appendChild(buildRailItem(form));
  }

  // The narrow-screen switcher shows the same forms as the rail.
  railDropdown.setOptions(state.forms.map((f) => ({ value: f._id, label: f.name })));
  if (state.formId) railDropdown.setValue(state.formId);

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


function closeNewFormPrompt() {
  closeModal();
}

function openNewFormPrompt() {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field';
  input.placeholder = 'Contact form';
  input.setAttribute('aria-label', 'Form name');

  const submit = async (btn) => {
    const name = input.value.trim();
    if (!name) {
      modalError('Give the form a name so you can tell it apart later.');
      input.focus();
      return;
    }
    setBusy(btn, true);
    const created = await guarded(async () => {
      const res = await createForm(name);
      await refreshForms();
      return res.data;
    }, (msg) => modalError(msg));
    setBusy(btn, false);
    if (created) {
      closeModal();
      selectForm(created._id);
      toast('Form created.');
    }
  };

  openModal({
    title: 'New form',
    description: 'Name it after the page it lives on, so submissions are easy to place.',
    body: input,
    actions: [{ label: 'Create form', onClick: submit }],
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const btn = document.querySelector('#modal-actions .btn-primary');
      if (btn) submit(btn);
    }
  });
}

// --- listboxes ---------------------------------------------------------------
// The value lives in a hidden input carrying the public id, so every consumer
// still reads `.value` and listens for `change` exactly as with a <select>.

const statusSlot = document.getElementById('status-slot');
if (statusSlot) {
  dropdown(document.getElementById('status'), [
    { value: '', label: 'All' },
    { value: 'new', label: 'New' },
    { value: 'read', label: 'Read' },
    { value: 'archived', label: 'Archived' },
    { value: 'spam', label: 'Spam' },
  ], 'Filter by status');
  // Move the listbox INTO the slot. replaceWith() would discard the slot and the
  // layout classes it carries — which is how the mobile-only switcher ended up
  // visible on desktop, its lg:hidden thrown away with the element holding it.
  statusSlot.appendChild(document.getElementById('status').nextElementSibling);
}

const railDropdown = dropdown(railSelect, [], 'Select a form');
document.getElementById('rail-select-slot')?.appendChild(railSelect.nextElementSibling);

newFormBtn.addEventListener('click', openNewFormPrompt);

// --- date range --------------------------------------------------------------
// Two date fields permanently parked above an inbox is a lot of furniture for a
// filter most people never touch, so they fold away behind the calendar button.

const datesToggle = document.getElementById('dates-toggle');
const datesRow = document.getElementById('dates');
if (datesToggle && datesRow) {
  datesToggle.addEventListener('click', () => {
    const open = datesRow.hidden;
    datesRow.hidden = !open;
    datesToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) datesRow.querySelector('input')?.focus();
  });
}

// --- placeholder pane ----------------------------------------------------------
// Task 7 owns #record. Until then it carries an empty state, because a blank
// third of the screen reads as broken rather than as waiting. #rows is owned
// entirely by submissions.js (see initList()) as of Task 6.

function renderPlaceholders() {
  const record = document.getElementById('record');
  if (record && !record.children.length) {
    record.appendChild(emptyState('Nothing selected', 'Choose a submission from the list to read it.'));
  }
}

window.addEventListener('form-changed', renderPlaceholders);


// --- tabs --------------------------------------------------------------------

function setTab(tab) {
  state.tab = tab;
  const submissionsActive = tab === 'submissions';

  tabSubmissions.setAttribute('aria-selected', submissionsActive ? 'true' : 'false');
  tabSettings.setAttribute('aria-selected', submissionsActive ? 'false' : 'true');

  recordEl.hidden = !submissionsActive;
  paneSettings.hidden = submissionsActive;
  rowsEl.hidden = !submissionsActive;
  listFoot.hidden = !submissionsActive;
  filterRows.forEach((row) => {
    row.hidden = !submissionsActive;
  });
}

tabSubmissions.addEventListener('click', () => setTab('submissions'));
tabSettings.addEventListener('click', () => setTab('settings'));

// --- session lifecycle ---------------------------------------------------------

function showApp() {
  loginEl.hidden = true;
  appEl.hidden = false;
  renderPlaceholders();
}

function showLogin() {
  loginEl.hidden = false;
  appEl.hidden = true;
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

logoutBtn.addEventListener('click', async () => {
  const ok = await guarded(async () => {
    await logout();
    return true;
  });
  if (!ok) return;
  state.forms = [];
  state.tab = 'submissions';
  setFormId(null);
  showLogin();
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

initList();
boot();
