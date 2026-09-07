// The submissions list (the middle pane) and the record pane (the right
// third). The list fetches the selected form's submissions (search,
// status/date filters, pagination) and renders one row per submission.
// Clicking a row dispatches `submission-selected` on `window`; this module
// both dispatches it and listens for it, since it also owns `#record` — the
// payload view, its files, its metadata, its notes, and the triage actions.
//
// Consumes `state`/`refreshForms` from app.js (both already exported), the
// `form-changed` event app.js dispatches whenever the selected form changes,
// the submissions/api.js calls, and the pure formatters in format.js. Every
// api call here follows the same shape as app.js's private `guarded()` — a
// local equivalent, since app.js does not export its version — so a
// rejection always surfaces as a message, never an unhandled promise
// rejection.

import { state, refreshForms } from './app.js';
import { listSubmissions, patchSubmission, getSubmission, deleteSubmission, fileUrl, exportUrl } from './api.js';
import { el, clear, toast, setBusy, confirmInline, emptyState } from './ui.js';
import { pickWho, pickSnippet, relativeTime, buildQuery, rangeLabel, actionsFor, formatBytes, mailtoHref } from './format.js';

const rowsEl = document.getElementById('rows');
const countEl = document.getElementById('count');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const searchInput = document.getElementById('q');
const statusInput = document.getElementById('status');
const fromInput = document.getElementById('from');
const toInput = document.getElementById('to');
const recordEl = document.getElementById('record');

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

const MARK_PATHS = {
  star: 'M11.48 3.5a.56.56 0 011.04 0l2.13 4.32 4.77.69c.46.07.64.63.31.95l-3.45 3.36.81 4.75a.56.56 0 01-.81.59L12 15.92l-4.27 2.24a.56.56 0 01-.81-.59l.81-4.75-3.45-3.36a.56.56 0 01.31-.95l4.77-.69L11.48 3.5z',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
};

/** A small inline mark for the row: a star for starred, a clip for attachments. */
function markIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mr-1 inline-block h-3 w-3 align-[-1px] ' + (kind === 'star' ? 'text-star' : 'text-muted'));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  if (kind === 'star') {
    svg.setAttribute('fill', 'currentColor');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', MARK_PATHS[kind]);
  svg.appendChild(path);
  return svg;
}

function buildRow(sub, fields) {
  const btn = el('button');
  btn.type = 'button';
  btn.dataset.id = sub._id;
  btn.dataset.status = sub.status;
  btn.setAttribute('aria-current', 'false');

  const top = el('div', 'flex items-baseline justify-between gap-2');
  const who = el('span', nameClassName(sub.status), pickWho(sub.data, fields));
  who.dataset.role = 'who';
  const when = el('span', 'shrink-0 pl-2 font-mono text-[10px] text-muted', relativeTime(sub.created));
  top.appendChild(who);
  top.appendChild(when);

  const snip = el('p', 'truncate text-xs text-muted');
  // Icons, not glyphs. ❑ renders as an orange box in DM Sans on macOS — it falls
  // through to an emoji font — so an attachment looked like a broken character.
  if (sub.starred) snip.appendChild(markIcon('star'));
  if (sub.files && sub.files.length) snip.appendChild(markIcon('clip'));
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

// Repaints a row found fresh, by submission id, rather than a node captured at
// an earlier point in time. A row's DOM node is only valid for as long as
// nothing has re-rendered `#rows` since — a filter/pagination change (or a
// fresh `form-changed` fetch) clears and rebuilds the whole pane, which
// detaches every button already in hand. If the row for this id isn't in the
// DOM any more (filtered out, paged away, or the pane moved to another form
// entirely), there's nothing to repaint — the state is already correct,
// because whatever caused the row to change is what will show the truth on
// its own next render.
function paintRowById(id, status) {
  const btn = rowsEl.querySelector('[data-id="' + CSS.escape(id) + '"]');
  if (!btn) return;
  btn.className = rowClassName(status);
  btn.dataset.status = status;
  const who = btn.querySelector('[data-role="who"]');
  if (who) who.className = nameClassName(status);
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
  // Same tick as the click that produced `btn` — nothing has had a chance to
  // re-render `#rows` yet, so the captured node is still the right one.
  btn._paint();

  const ok = await guarded(
    () => patchSubmission(sub._id, { status: 'read' }),
    (message) => {
      sub.status = previous;
      // NOT `btn._paint()`: this runs after an `await`, by which point a
      // filter/pagination change (or a fresh fetch for another form) may have
      // cleared and rebuilt `#rows`, detaching `btn`. Resolve the row fresh.
      paintRowById(sub._id, previous);
      toast(message, 'error');
      // The record pane may already be showing this submission as "read" —
      // either `onSubmissionSelected()` trusted this same optimistic flip
      // over a still-"new" GET response, or the success path below already
      // synced it. A failed PATCH means the server never agreed; revert the
      // pane too, or it keeps showing "read" with the wrong action buttons
      // while the row right next to it, and the server, both say "new".
      if (currentSub && currentSub._id === sub._id && currentSub.status !== previous) {
        currentSub.status = previous;
        renderRecord();
      }
    }
  );

  // The rail badge (`newCount`) is server-derived and lives in app.js's
  // `state`, rendered by app.js's own (unexported) rail renderer. Rather than
  // reach into that module's internals, resync through the same public
  // `refreshForms()` app.js already exposes and already guards — it re-fetches
  // the true count rather than guessing at a decrement that could drift under
  // a second admin session.
  if (ok) {
    await refreshForms();
    // This fires in the same click that opens the record pane, and the two
    // requests race: `onSubmissionSelected`'s getSubmission() can resolve
    // before or after this PATCH does. If the record pane is already showing
    // this submission and this PATCH is the one that lands last, sync it —
    // otherwise the pane is left stuck on "new" with a stale "Mark read"
    // button even though the row right next to it, and the server, both
    // already say "read".
    if (currentSub && currentSub._id === sub._id && currentSub.status !== 'read') {
      currentSub.status = 'read';
      renderRecord();
    }
  }
}

// --- fetch + render ------------------------------------------------------------

function renderEmpty(total, filtersActive) {
  clear(rowsEl);
  if (total === 0 && !filtersActive) {
    rowsEl.appendChild(emptyState(
      'No submissions yet',
      'Point a form at this endpoint and they will appear here.'
    ));
    return;
  }
  // A zero-row page with no filter active and offset > 0 is not "no match" —
  // there is no filter to not match. It means the page paged past a total
  // that has since shrunk (rows deleted, elsewhere, since this page was
  // reached), and "No submissions match that filter" would be a lie in a
  // pane with no filter showing. Offer the honest way out: go back to the
  // page that still exists.
  if (!filtersActive && offset > 0) {
    const empty = emptyState(
      'You paged past the end',
      'Some of these submissions were removed. Go back to the first page to see what is left.'
    );
    const back = el('button', 'btn btn-quiet mt-3', 'Back to first page');
    back.type = 'button';
    back.addEventListener('click', resetAndFetch);
    empty.appendChild(back);
    rowsEl.appendChild(empty);
    return;
  }
  rowsEl.appendChild(emptyState('No submissions match that filter.'));
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
  // Bumped first, before any early return: every path that decides what the
  // pane should be showing has to invalidate a fetch already in flight, not
  // just the paths that start a new one. Deleting the only form while its
  // fetch is in flight used to leave this branch's synchronous "No form
  // selected" un-invalidating fetchSeq — the in-flight response would then
  // pass the staleness check below and overwrite the placeholder with a
  // deleted form's rows.
  const seq = ++fetchSeq;

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

// --- record pane -------------------------------------------------------------
// The signature element: the payload, set like a printed form. Field keys in
// the monospace face, right-aligned in a narrow column; values in the sans
// face, wide, `whitespace-pre-wrap` so a multi-line message renders as
// written. A hairline rule between rows. Everything else here stays quiet.
//
// `currentSub` is always the server's own copy — fetched fresh via
// `getSubmission` on selection, and replaced with the response of every
// mutation — never a value patched by hand, so the pane can never drift from
// what is actually stored.

let currentSub = null;
let recordSeq = 0;

const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The submitter's address: the schema's `email` field first, then `data.email`,
 *  then the first email-shaped value — same fallback order pickWho already
 *  uses for a name, just aimed at an address instead. */
function pickEmail(data, fields) {
  const d = data && typeof data === 'object' ? data : {};
  const schema = Array.isArray(fields) ? fields : [];

  for (const f of schema) {
    if (f && f.type === 'email') {
      const v = String(d[f.name] || '').trim();
      if (v) return v;
    }
  }
  if (typeof d.email === 'string' && d.email.trim()) return d.email.trim();
  for (const v of Object.values(d)) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && EMAILISH.test(s)) return s;
  }
  return '';
}

// One row per key actually present in `data`, the form's declared field
// order first, then any remaining keys in the order they appear on the
// document. A schema field the submitter left out never appears — this
// renders what was submitted, not the form's shape.
function orderedEntries(data, fields) {
  const d = data && typeof data === 'object' ? data : {};
  const schema = Array.isArray(fields) ? fields : [];
  const seen = new Set();
  const ordered = [];

  for (const f of schema) {
    if (f && f.name && Object.prototype.hasOwnProperty.call(d, f.name) && !seen.has(f.name)) {
      seen.add(f.name);
      ordered.push(f.name);
    }
  }
  for (const key of Object.keys(d)) {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  return ordered.map((key) => [key, d[key]]);
}

function dash(value) {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s || '—';
}

function buildFieldsBlock(data, fields) {
  const entries = orderedEntries(data, fields);
  if (!entries.length) return el('p', 'text-sm text-muted', 'No fields submitted.');

  const dl = el('dl', 'grid grid-cols-[7rem_minmax(0,1fr)]');
  entries.forEach(([key, value], i) => {
    const rule = i === 0 ? '' : ' border-t border-cream';
    dl.appendChild(el('dt', 'py-2 pr-3 text-right font-mono text-[11px] text-muted' + rule, key));
    const text = value === null || value === undefined ? '' : (typeof value === 'string' ? value : String(value));
    dl.appendChild(el('dd', 'min-w-0 py-2 text-sm text-ink whitespace-pre-wrap break-words' + rule, text));
  });
  return dl;
}

function buildFilesBlock(sub) {
  const wrap = el('div');
  wrap.appendChild(el('div', 'eyebrow mb-2', 'Files'));
  const list = el('div', 'flex flex-col gap-1.5');
  for (const file of sub.files) {
    const row = el('div', 'flex items-center gap-2.5 rounded-lg border border-cream bg-paper px-3 py-2');
    row.appendChild(el('span', 'min-w-0 flex-1 truncate text-sm text-ink', file.filename));
    row.appendChild(el('span', 'shrink-0 font-mono text-[11px] tabular-nums text-muted', formatBytes(file.size)));
    const link = el('a', 'shrink-0 border-b border-primary/30 text-xs text-primary hover:border-primary', 'Download');
    link.href = fileUrl(sub._id, file.id);
    link.download = file.filename || '';
    row.appendChild(link);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function buildMetaBlock(sub) {
  const wrap = el('div');
  wrap.appendChild(el('div', 'eyebrow mb-2', 'Metadata'));
  const meta = sub.meta && typeof sub.meta === 'object' ? sub.meta : {};
  const dl = el('dl', 'grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 font-mono text-[11px]');
  const rows = [
    ['submitted', sub.created],
    ['ip', meta.ip],
    ['referer', meta.referer],
    ['agent', meta.userAgent],
    ['id', sub._id],
  ];
  for (const [key, value] of rows) {
    dl.appendChild(el('dt', 'pr-3 text-right text-muted', key));
    dl.appendChild(el('dd', 'min-w-0 text-body break-words', dash(value)));
  }
  wrap.appendChild(dl);
  return wrap;
}

function buildNotesBlock(sub) {
  const wrap = el('div');
  wrap.appendChild(el('div', 'eyebrow mb-2', 'Notes'));
  const list = el('div', 'flex flex-col gap-2');

  for (const note of sub.notes || []) {
    const item = el('div', 'border-l-2 border-cream pl-3');
    item.appendChild(el('span', 'mb-0.5 block font-mono text-[10px] text-muted', relativeTime(note.at)));
    item.appendChild(document.createTextNode(note.text || ''));
    list.appendChild(item);
  }

  const addRow = el('div', 'flex gap-1.5 pt-1');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'field text-sm';
  input.placeholder = 'Add a note';
  input.setAttribute('aria-label', 'Add a note');
  const addBtn = el('button', 'btn shrink-0', 'Add');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => addNote(sub, input, addBtn));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNote(sub, input, addBtn); }
  });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  list.appendChild(addRow);

  wrap.appendChild(list);
  return wrap;
}

function buildRecordHead(sub, fields, form) {
  const head = el('div', 'border-b border-cream px-5 py-4');
  head.appendChild(el('div', 'eyebrow mb-1', (form ? form.name : 'Submission') + ' · ' + sub.status));
  head.appendChild(el('h2', 'text-lg font-semibold leading-tight text-ink', pickWho(sub.data, fields)));
  const email = pickEmail(sub.data, fields);
  if (email) head.appendChild(el('div', 'mt-0.5 font-mono text-xs text-primary', email));
  return head;
}

function buildActions(sub, fields, confirmHost) {
  const wrap = el('div', 'flex flex-wrap items-center gap-1.5 border-b border-cream bg-paper px-5 py-3');

  const star = el('button', sub.starred ? 'btn border-star/30 bg-star/10 text-star' : 'btn', sub.starred ? 'Starred' : 'Star');
  star.type = 'button';
  star.setAttribute('aria-pressed', sub.starred ? 'true' : 'false');
  star.addEventListener('click', () => applyPatch(sub, { starred: !sub.starred }, star));
  wrap.appendChild(star);

  const email = pickEmail(sub.data, fields);
  const replyHref = mailtoHref(email);
  if (replyHref) {
    // A real mailto: link, not a send feature — composing and sending mail to
    // an attacker-controlled address is deliberately out of scope. The
    // address itself is attacker-controlled too — mailtoHref() refuses one
    // carrying a query string (a `?subject=&body=` phishing payload aimed at
    // whoever clicks Reply) and percent-encodes the rest, so no raw `?`/`&`
    // ever reaches this href.
    const reply = el('a', 'btn btn-primary', 'Reply');
    reply.href = replyHref;
    wrap.appendChild(reply);
  }

  for (const action of actionsFor(sub.status)) {
    if (action.next === null) {
      const del = el('button', 'btn btn-danger', action.label);
      del.type = 'button';
      del.addEventListener('click', () => requestDelete(sub, fields, confirmHost));
      wrap.appendChild(del);
    } else {
      const btn = el('button', 'btn', action.label);
      btn.type = 'button';
      btn.addEventListener('click', () => applyPatch(sub, { status: action.next }, btn));
      wrap.appendChild(btn);
    }
  }

  return wrap;
}

function renderRecordEmpty(title, hint) {
  clear(recordEl);
  recordEl.appendChild(emptyState(title, hint));
}

function renderRecord() {
  clear(recordEl);
  if (!currentSub) {
    recordEl.appendChild(emptyState('Select a submission to read it.'));
    return;
  }

  const sub = currentSub;
  const form = currentForm();
  const fields = form ? form.fields || [] : [];

  recordEl.appendChild(buildRecordHead(sub, fields, form));

  // A dedicated, initially-hidden host for the two-step delete confirm —
  // never window.confirm for a destructive, irreversible action.
  const confirmHost = el('div', 'border-b border-cream bg-paper px-5 py-3');
  confirmHost.hidden = true;
  recordEl.appendChild(buildActions(sub, fields, confirmHost));
  recordEl.appendChild(confirmHost);

  const body = el('div', 'flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5');
  body.appendChild(buildFieldsBlock(sub.data, fields));
  if (sub.files && sub.files.length) body.appendChild(buildFilesBlock(sub));
  body.appendChild(buildMetaBlock(sub));
  body.appendChild(buildNotesBlock(sub));
  recordEl.appendChild(body);
}

// Re-fetches the list (respecting whatever filters/offset are active) so a
// status change that moves a submission out of the current filter — e.g.
// marking a "new" row read while the status filter is "New" — disappears
// exactly like it would on the next natural fetch, and the total/pagination
// stay honest. `#rows` is fully rebuilt by that fetch, which drops
// `aria-current`; if the submission still shown in the record pane is still
// in the (possibly narrower) list, its row gets it back.
async function refreshListPreservingSelection() {
  await fetchAndRender();
  if (!currentSub) return;
  const btn = rowsEl.querySelector('[data-id="' + CSS.escape(currentSub._id) + '"]');
  if (!btn) return;
  for (const node of rowsEl.querySelectorAll('[aria-current="true"]')) node.setAttribute('aria-current', 'false');
  btn.setAttribute('aria-current', 'true');
}

// The one place a mutating PATCH happens. Always re-renders from the
// server's own response — never a value guessed at locally — so the pane
// can't drift from what is actually stored.
async function applyPatch(sub, patch, btn) {
  if (btn) setBusy(btn, true);
  const res = await guarded(() => patchSubmission(sub._id, patch));
  if (btn) setBusy(btn, false);
  if (!res) return undefined;

  // The user may have selected a different submission (or cleared the pane)
  // while this request was in flight. Applying a slow response for a row
  // that is no longer the one on screen would repaint the pane with the
  // wrong submission — the list is still worth resyncing, but `currentSub`
  // and the record itself are not touched.
  if (!currentSub || currentSub._id !== sub._id) {
    await refreshListPreservingSelection();
    return res;
  }

  currentSub = res.data;
  await refreshListPreservingSelection();
  // A status change can move a submission into or out of "new" — the rail's
  // count badge is server-derived and must be resynced the same way markRead
  // already does for the automatic read-on-select transition.
  if (patch.status) await refreshForms();
  renderRecord();
  return res;
}

async function addNote(sub, input, btn) {
  const text = input.value.trim();
  if (!text) return;
  await applyPatch(sub, { note: text }, btn);
}

function requestDelete(sub, fields, host) {
  const who = pickWho(sub.data, fields);
  confirmInline(host, 'Delete the submission from ' + who + '? This cannot be undone.', async () => {
    // confirmInline's own try/catch surfaces a thrown error inline and
    // leaves the host open — no local try/catch needed here.
    await deleteSubmission(sub._id);
    // The user may have selected a different submission while this DELETE
    // was in flight — the same guard applyPatch() uses. Only clear the pane
    // if it is still the one just removed; the list still needs refreshing
    // either way, since the deleted row must disappear regardless of what
    // the pane is currently showing.
    if (currentSub && currentSub._id === sub._id) {
      currentSub = null;
      renderRecord();
    }
    await fetchAndRender();
    toast('Submission deleted.');
    await refreshForms();
  });
}

async function onSubmissionSelected(stub) {
  const seq = ++recordSeq;
  const res = await guarded(
    () => getSubmission(stub._id),
    (message) => {
      if (seq !== recordSeq) return;
      currentSub = null;
      renderRecordEmpty('Could not load this submission', message || 'Try again.');
    }
  );
  if (seq !== recordSeq || !res) return;

  const data = res.data;
  // Selecting a "new" row also triggers markRead() below, which flips the
  // shared row object to "read" synchronously, in the same click, well
  // before either its PATCH or this GET has actually resolved. If that PATCH
  // happens to land first, trust it over this (now-stale) GET rather than
  // reopening the "new" state and its "Mark read" button — the transition
  // only ever runs new -> read, never the reverse, so this can't mask a real
  // change the other direction.
  if (stub.status === 'read' && data.status === 'new') data.status = 'read';

  currentSub = data;
  renderRecord();
}

// --- wiring ----------------------------------------------------------------

export function initList() {
  window.addEventListener('form-changed', resetAndFetch);
  window.addEventListener('form-changed', () => {
    // Invalidates a getSubmission() already in flight from a click just
    // before the switch — without this, that response would land after the
    // switch and repaint the pane with a submission from the form just left.
    recordSeq++;
    currentSub = null;
    renderRecord();
  });
  window.addEventListener('submission-selected', (e) => onSubmissionSelected(e.detail));

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

  // The export capability exists on the server with no UI of its own — a
  // plain link in the list footer's actions row, next to Prev/Next.
  const exportLink = el('a', 'btn btn-quiet px-2 py-1 text-[11px]', 'Export CSV');
  exportLink.href = '#';
  prevBtn.parentElement.insertBefore(exportLink, prevBtn);
  window.addEventListener('form-changed', () => {
    if (state.formId) exportLink.href = exportUrl(state.formId);
    else exportLink.removeAttribute('href');
  });

  // Paint an initial state synchronously (there is no form yet — `boot()`
  // hasn't resolved) so the pane never sits fully blank; `form-changed` fires
  // and replaces it as soon as a form is selected, if one exists.
  fetchAndRender();
  renderRecord();
}
