// Boot, login gate, form rail, tabs. The list and record panes are wired by
// submissions.js — this module only owns the shell: signing in, which form is
// selected, and which tab is showing.

import { login, logout, listForms, createForm } from './api.js';
import { el, clear, toast, setBusy, openModal, closeModal, modalError, dropdown } from './ui.js';
import { relativeTime, railBadgeText } from './format.js';
import { initList } from './submissions.js';
import { initSettings, renderSettings } from './settings.js';

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
// Bind by id, not by utility class. These were `.filters` and `.list-foot`
// until the UI moved to Tailwind, at which point both selectors silently matched
// nothing: listFoot became null and threw on the Settings tab, and the filter bar
// stopped hiding. Utility classes change whenever the design does; ids are the
// contract every view module already binds to.
const filterBar = document.getElementById('filter-bar');
const datesToggle = document.getElementById('dates-toggle');
const datesRow = document.getElementById('dates');
const listFoot = document.getElementById('list-foot');
const listPane = document.getElementById('list-pane');

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

function buildRailItem(form) {
  const btn = el('button', 'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-body transition hover:bg-white/70 aria-[current=true]:bg-white aria-[current=true]:font-medium aria-[current=true]:text-ink aria-[current=true]:shadow-sm');
  btn.type = 'button';
  const current = form._id === state.formId;
  btn.setAttribute('aria-current', current ? 'true' : 'false');
  btn.appendChild(el('span', null, form.name));

  const text = railBadgeText(form.newCount, form.newCountExact);
  if (text !== null) {
    btn.appendChild(el('span', 'chip', text));
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
  // Browser history from other sites is noise in a field like this.
  input.autocomplete = 'off';
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

if (datesToggle && datesRow) {
  datesToggle.addEventListener('click', () => {
    const open = datesRow.hidden;
    datesRow.hidden = !open;
    datesToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) datesRow.querySelector('input')?.focus();
  });
}

// --- tabs --------------------------------------------------------------------
// `#record` (the record pane) and `#rows` (the list) are both owned entirely
// by submissions.js as of Task 7 — this module only ever toggles `.hidden` on
// the shell around them, never their content.

function setTab(tab) {
  state.tab = tab;
  const submissionsActive = tab === 'submissions';

  tabSubmissions.setAttribute('aria-selected', submissionsActive ? 'true' : 'false');
  tabSettings.setAttribute('aria-selected', submissionsActive ? 'false' : 'true');

  // Drives the grid: on Settings the list column collapses instead of sitting
  // empty. Toggling `hidden` alone left 22rem of blank white beside the pane.
  appEl.setAttribute('data-tab', tab);

  // Hide the whole list SECTION, not just its children — it is a grid item, so
  // leaving it in place kept a stretched empty column and squeezed the settings
  // pane into the rail's width.
  listPane.hidden = !submissionsActive;

  recordEl.hidden = !submissionsActive;
  paneSettings.hidden = submissionsActive;
  rowsEl.hidden = !submissionsActive;
  listFoot.hidden = !submissionsActive;
  // The date row is owned by its toggle, not by the tab. Unhiding it here would
  // unfold it every time you came back from Settings, regardless of whether the
  // customer had asked for it.
  filterBar.hidden = !submissionsActive;
  datesRow.hidden = !submissionsActive || datesToggle.getAttribute('aria-expanded') !== 'true';

  // settings.js only fetches (snippet, deliveries) while its own `form-changed`
  // listener sees this tab active — see its initSettings() for why. That means
  // switching TO this tab, with no form change involved, needs its own trigger,
  // or the pane would sit on whatever it last rendered (possibly the empty
  // state from boot, or a stale form) until the next rail click.
  if (!submissionsActive) renderSettings();
}

tabSubmissions.addEventListener('click', () => setTab('submissions'));
tabSettings.addEventListener('click', () => setTab('settings'));

// --- session lifecycle ---------------------------------------------------------

function showApp() {
  loginEl.hidden = true;
  appEl.hidden = false;
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
  // `setTab`, not a bare `state.tab =` assignment: the tab is DOM state
  // (aria-selected, `data-tab`, pane visibility) that only `setTab` actually
  // moves. A plain field write here was silently doing nothing — sign back in
  // after logging out from Settings and the app reappeared on Settings, not
  // Submissions, even though nothing on screen said so.
  setTab('submissions');
  setFormId(null);
  showLogin();
});

// Ported from the legacy login page's `startRetryCountdown` (deleted with the
// old index.html during the Tailwind rebuild — api.js's fetch wrapper never
// picked it back up, so a throttled visitor saw only the server's static
// "Too many login attempts. Try again later." with no sense of when trying
// again might actually work).
let retryTimer = null;

function stopRetryCountdown() {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

function startRetryCountdown(seconds) {
  if (seconds === null) {
    loginError.textContent = 'Too many login attempts. Try again later.';
    return;
  }
  let remaining = seconds;
  const render = () => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const readable = mins > 0 ? (mins + 'm ' + secs + 's') : (secs + 's');
    loginError.textContent = 'Too many login attempts. Try again in ' + readable + '.';
  };
  render();
  retryTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      stopRetryCountdown();
      loginError.textContent = '';
      return;
    }
    render();
  }, 1000);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  stopRetryCountdown();
  const submitBtn = loginForm.querySelector('button[type="submit"]');
  const password = passwordInput.value;

  setBusy(submitBtn, true);
  try {
    await login(password);
    passwordInput.value = '';
    await boot();
  } catch (err) {
    if (err.status === 429) {
      startRetryCountdown(err.retryAfter);
    } else {
      loginError.textContent = err.message;
    }
    passwordInput.focus();
  } finally {
    setBusy(submitBtn, false);
  }
});

initList();
initSettings();
boot();
