// The submissions list — the middle pane. Fetches the selected form's
// submissions (search, status/date filters, pagination) and renders one row
// per submission. Clicking a row dispatches `submission-selected` on
// `window`, which a later task uses to fill the record pane on the right —
// this module never touches `#record`.
//
// Consumes `state`/`refreshForms` from app.js (both already exported), the
// `form-changed` event app.js dispatches whenever the selected form changes,
// `listSubmissions`/`patchSubmission` from api.js, and the pure formatters in
// format.js. Every api call here follows the same shape as app.js's private
// `guarded()` — a local equivalent, since app.js does not export its
// version — so a rejection always surfaces as a message, never an unhandled
// promise rejection.

import { state, refreshForms } from './app.js';
import { listSubmissions, patchSubmission } from './api.js';
import { el, clear, toast, emptyState } from './ui.js';
import { pickWho, pickSnippet, relativeTime, buildQuery, rangeLabel } from './format.js';

const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const searchInput = document.getElementById('q');
const statusInput = document.getElementById('status');
const fromInput = document.getElementById('from');
const toInput = document.getElementById('to');

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let offset = 0;
// Bumped on every fetch; a response is applied only if it is still the most
// recent request in flight. Without this, a slow response to an earlier
// keystroke can land after a faster later one and show a stale page.
let fetchSeq = 0;
let filterTimer = null;

// --- local guarded() ---------------------------------------------------------
// Mirrors app.js's private helper: a rejection either surfaces through
// `onError` (for a caller that wants to render it somewhere specific) or a
// toast. Not imported from app.js because app.js does not export it.
async function guarded(fn, onError) {
  try {
    return await fn();
  } catch (err) {
    if (onError) onError(err.message);
    else toast(err.message, 'error');
    return undefined;
  }
}

// A loosely-typed YYYY-MM-DD text field: an implausible value is dropped
// rather than blocking the fetch, per the field being free text, not
// `<input type="date">`.
function plausibleDate(raw) {
  const value = String(raw || '').trim();
  if (!DATE_RE.test(value)) return '';
  const asDate = new Date(value + 'T00:00:00Z');
  return Number.isFinite(asDate.getTime()) && asDate.toISOString().slice(0, 10) === value ? value : '';
}

function currentForm() {
  return state.forms.find((f) => f._id === state.formId) || null;
}

function activeFilters() {
  return {
    search: searchInput.value.trim(),
    status: statusInput.value,
    from: plausibleDate(fromInput.value),
    to: plausibleDate(toInput.value),
  };
}

// --- row rendering -------------------------------------------------------------
// Status reads at a glance from the left edge and the weight of the name —
// not a badge — so the list stays quiet: new gets an accent edge and a
// heavier name, read gets neither, archived recedes (the whole row dims),
// spam gets a red edge and muted text. Two accent colours in the whole list.

function rowClassName(status) {
  const base = 'block w-full border-b border-cream px-3 py-2 text-left transition hover:bg-sunk aria-[current=true]:bg-primary-soft';
  if (status === 'new') return base + ' border-l-2 border-l-primary';
  if (status === 'spam') return base + ' border-l-2 border-l-flag text-muted';
  if (status === 'archived') return base + ' border-l-2 border-l-transparent opacity-60';
  return base + ' border-l-2 border-l-transparent';
}

function nameClassName(status) {
  if (status === 'new') return 'truncate text-sm font-semibold text-ink';
  if (status === 'spam') return 'truncate text-sm text-muted';
  return 'truncate text-sm text-body';
}

function buildRow(sub, fields) {
  const btn = el('button');
  btn.type = 'button';
  btn.dataset.id = sub._id;
  btn.dataset.status = sub.status;
  btn.setAttribute('aria-current', 'false');

  const top = el('div', 'flex items-baseline justify-between gap-2');
  const who = el('span', nameClassName(sub.status), pickWho(sub.data, fields));
  const when = el('span', 'shrink-0 pl-2 font-mono text-[10px] text-muted', relativeTime(sub.created));
  top.appendChild(who);
  top.appendChild(when);

  const snip = el('p', 'truncate text-xs text-muted');
  const marks = [sub.starred ? '★' : '', sub.files && sub.files.length ? '❑' : ''].filter(Boolean).join(' ');
  if (marks) snip.appendChild(el('span', 'mr-1 text-star', marks));
  snip.appendChild(document.createTextNode(pickSnippet(sub.data, fields)));

  btn.appendChild(top);
  btn.appendChild(snip);

  function paint() {
    btn.className = rowClassName(sub.status);
    who.className = nameClassName(sub.status);
    btn.dataset.status = sub.status;
  }
  paint();
  btn._paint = paint;

  btn.addEventListener('click', () => selectRow(sub, btn));
  return btn;
}

function selectRow(sub, btn) {
  for (const node of rowsEl.querySelectorAll('[aria-current="true"]')) {
    node.setAttribute('aria-current', 'false');
  }
  btn.setAttribute('aria-current', 'true');

  window.dispatchEvent(new CustomEvent('submission-selected', { detail: sub }));

  if (sub.status === 'new') markRead(sub, btn);
}

// Optimistic: the row (and the shared submission object, so anything else
// holding a reference to it — the record pane — sees the same status) flips
// to `read` immediately; a failed PATCH reverts both and toasts.
async function markRead(sub, btn) {
  const previous = sub.status;
  sub.status = 'read';
  btn._paint();

  const ok = await guarded(
    () => patchSubmission(sub._id, { status: 'read' }),
    (message) => {
      sub.status = previous;
      btn._paint();
      toast(message, 'error');
    }
  );

  // The rail badge (`newCount`) is server-derived and lives in app.js's
  // `state`, rendered by app.js's own (unexported) rail renderer. Rather than
  // reach into that module's internals, resync through the same public
  // `refreshForms()` app.js already exposes and already guards — it re-fetches
  // the true count rather than guessing at a decrement that could drift under
  // a second admin session.
  if (ok) await refreshForms();
}

// --- fetch + render ------------------------------------------------------------

function renderEmpty(total, filtersActive) {
  clear(rowsEl);
  if (total === 0 && !filtersActive) {
    rowsEl.appendChild(emptyState(
      'No submissions yet',
      'Point a form at this endpoint and they will appear here.'
    ));
  } else {
    rowsEl.appendChild(emptyState('No submissions match that filter.'));
  }
}

function renderFailure(message) {
  clear(rowsEl);
  rowsEl.appendChild(emptyState('Could not load submissions', message || 'Try again.'));
  countEl.textContent = '';
  prevBtn.disabled = true;
  nextBtn.disabled = true;
}

function renderRows(rows, fields) {
  clear(rowsEl);
  for (const sub of rows) {
    rowsEl.appendChild(buildRow(sub, fields));
  }
}

async function fetchAndRender() {
  const form = currentForm();
  if (!state.formId || !form) {
    clear(rowsEl);
    rowsEl.appendChild(emptyState('No form selected', 'Choose a form on the left to see its submissions.'));
    countEl.textContent = '';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const filters = activeFilters();
  const query = buildQuery({ ...filters, limit: PAGE_SIZE, offset });
  const seq = ++fetchSeq;
  let failure = '';

  const res = await guarded(
    () => listSubmissions(state.formId, query),
    (message) => { failure = message; }
  );

  // A newer request has already landed; this response is stale.
  if (seq !== fetchSeq) return;

  if (!res) {
    renderFailure(failure);
    return;
  }

  const rows = Array.isArray(res.data) ? res.data : [];
  const total = Number(res.total) || 0;
  const exact = res.exact === true;
  const filtersActive = !!(filters.search || filters.status || filters.from || filters.to);

  if (rows.length === 0) {
    renderEmpty(total, filtersActive);
  } else {
    renderRows(rows, form.fields || []);
  }

  countEl.textContent = rangeLabel(offset, rows.length, total, exact);
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = offset + rows.length >= total && exact;
}

function resetAndFetch() {
  offset = 0;
  fetchAndRender();
}

function scheduleFetch() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(resetAndFetch, SEARCH_DEBOUNCE_MS);
}

// --- wiring ----------------------------------------------------------------

export function initList() {
  window.addEventListener('form-changed', resetAndFetch);

  searchInput.addEventListener('input', scheduleFetch);
  fromInput.addEventListener('input', scheduleFetch);
  toInput.addEventListener('input', scheduleFetch);
  // A custom listbox, not a native <select> — it writes `#status`'s value and
  // dispatches `change` on it, same contract as app.js's other listboxes.
  statusInput.addEventListener('change', resetAndFetch);

  prevBtn.addEventListener('click', () => {
    if (prevBtn.disabled) return;
    offset = Math.max(0, offset - PAGE_SIZE);
    fetchAndRender();
  });
  nextBtn.addEventListener('click', () => {
    if (nextBtn.disabled) return;
    offset += PAGE_SIZE;
    fetchAndRender();
  });

  // Paint an initial state synchronously (there is no form yet — `boot()`
  // hasn't resolved) so the pane never sits fully blank; `form-changed` fires
  // and replaces it as soon as a form is selected, if one exists.
  fetchAndRender();
}
