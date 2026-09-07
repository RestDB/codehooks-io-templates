// The Settings tab: everything the old setup page's per-form panel offered —
// the paste-in snippet with its copy button, email notification preferences,
// the recent-delivery-attempts diagnostics (refresh, per-row retry, retry-all,
// show more), the allowed-origins list, and delete-form with its two-step
// confirmation. Form creation, the forms rail, and log out already live in
// app.js (Task 5) — this module owns only what used to live inside
// legacy-setup.html's <template id="form-item-template">'s .form-detail.
//
// Consumes `state`/`refreshForms` from app.js and renders into `#pane-settings`
// on every `form-changed` event, exactly the pattern submissions.js already
// uses for `#record`.

import { state, refreshForms } from './app.js';
import { patchForm, deleteForm, getSnippet } from './api.js';
import { el, clear, toast, setBusy, emptyState } from './ui.js';
import { relativeTime } from './format.js';

const paneEl = document.getElementById('pane-settings');

// --- a private copy of api.js's `call()` --------------------------------------
// api.js's export surface was frozen at Task 4 (15 functions) and does not cover
// the three delivery-diagnostics endpoints below — a paged fetch, a per-row
// retry, and a bulk retry-all. Rather than modify api.js (out of scope for this
// task), this module carries its own copy of the same fetch wrapper, exactly as
// submissions.js already carries its own copy of app.js's private `guarded()`.
async function call(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('session-expired'));
    throw new Error('Your session has expired. Sign in again.');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    throw new Error('The server returned a response this page could not read.');
  }
  if (payload === null || typeof payload !== 'object') payload = {};

  // As in api.js: a crashed handler on this platform answers HTTP 200 with
  // {fatal: true}, so all three clauses are needed.
  if (!res.ok || payload.ok === false || payload.fatal === true) {
    throw new Error(payload.error || payload.text || ('Request failed (' + res.status + ')'));
  }
  return payload;
}

const listDeliveries = (formId, limit) =>
  call('/admin/api/forms/' + encodeURIComponent(formId) + '/deliveries?limit=' + encodeURIComponent(limit));
const retryAllDeliveries = (formId) =>
  call('/admin/api/forms/' + encodeURIComponent(formId) + '/deliveries/retry-all', { method: 'POST' });
const retryDelivery = (deliveryId) =>
  call('/admin/api/deliveries/' + encodeURIComponent(deliveryId) + '/retry', { method: 'POST' });

async function guarded(fn, onError) {
  try {
    return await fn();
  } catch (err) {
    if (onError) onError(err.message);
    else toast(err.message, 'error');
    return undefined;
  }
}

// Same rule the server enforces (lib/recipients.ts RECIPIENT_RE), checked here
// only to fail fast and point at the field — the server is the authority and
// rejects the PATCH regardless of what this does.
const RECIPIENT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DELIVERY_PAGE = 20;
// The endpoint refuses to return more than this, so the UI must not keep asking.
const DELIVERY_PAGE_MAX = 200;

let shownDeliveries = DELIVERY_PAGE;
// Bumped on every deliveries fetch; a response is applied only if it is still
// the most recent request in flight — the same stale-response guard
// submissions.js uses for the record pane.
let deliverySeq = 0;

// Form ids with a DELETE currently in flight. Module-scoped (not local to
// buildDeleteZone) because it has to survive a pane rebuild: navigating away
// from a form mid-delete and back before the request resolves rebuilds the
// delete zone from scratch, handing back a fresh, enabled "Delete form"
// button while the first request is still outstanding. Without this, a
// second click issues a second DELETE for the same form — not
// data-corrupting (the second call just 404s against an already-removed
// form), but the same staleness shape this branch has guarded elsewhere
// (the record pane's patch/delete races, the deliveries fetch above).
const deletingFormIds = new Set();

function currentForm() {
  return state.forms.find((f) => f._id === state.formId) || null;
}

// Inline placement only, for messages that belong next to the control or field
// they concern — a validation rejection, a save/retry/delete failure. Success
// acknowledgements are toasts (see the `toast(...)` calls throughout this
// file), so this only ever renders an error.
function showMsg(node, text) {
  node.hidden = false;
  node.textContent = text;
  node.className = 'mt-2 text-xs text-flag';
}

function hideMsg(node) {
  node.hidden = true;
  node.textContent = '';
}

// --- snippet -------------------------------------------------------------------

function buildSnippetSection(form) {
  const wrap = el('div', 'border-b border-cream px-5 py-4');
  wrap.appendChild(el('div', 'eyebrow mb-2', 'Paste this into your site'));

  const status = el('p', 'text-xs text-muted', 'Loading snippet…');
  const copyRow = el('div', 'mt-2 flex justify-end');
  copyRow.hidden = true;
  const copyBtn = el('button', 'btn', 'Copy snippet');
  copyBtn.type = 'button';
  copyRow.appendChild(copyBtn);

  const pre = el('pre', 'mt-2 overflow-x-auto rounded-lg bg-ink px-3 py-3 font-mono text-xs leading-relaxed text-paper');
  pre.hidden = true;
  const code = document.createElement('code');
  pre.appendChild(code);

  wrap.appendChild(status);
  wrap.appendChild(copyRow);
  wrap.appendChild(pre);

  guarded(() => getSnippet(form._id), (msg) => {
    status.hidden = false;
    status.textContent = 'Could not load snippet: ' + msg;
  }).then((body) => {
    if (!body) return;
    status.hidden = true;
    pre.hidden = false;
    copyRow.hidden = false;
    // textContent, never innerHTML: the snippet is HTML-as-text, not markup to
    // be parsed, and this is exactly the mistake a copied template should
    // never model.
    code.textContent = body.snippet;
    pre.dataset.raw = body.snippet;
  });

  copyBtn.addEventListener('click', () => {
    const text = pre.dataset.raw || code.textContent;
    const done = () => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  });

  return wrap;
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { /* nothing more to do */ }
  document.body.removeChild(ta);
}

// --- recent delivery attempts ---------------------------------------------------
// Read-only diagnostics for the notification settings below — not a submissions
// view. Shows why an email did or didn't arrive, so a customer never has to drop
// to curl on the /admin/api/forms/:id/deliveries collection.

function statusClass(status) {
  if (status === 'sent') return 'text-primary';
  if (status === 'failed') return 'text-flag';
  if (status === 'pending') return 'text-star';
  return 'text-muted';
}

function renderDeliveryRows(refs, rows, form) {
  clear(refs.list);
  refs.empty.hidden = rows.length !== 0;

  for (const row of rows) {
    const li = el('li', 'border-t border-cream py-2 text-xs first:border-t-0 first:pt-0');

    const top = el('div');
    const statusEl = el('strong', 'font-semibold capitalize ' + statusClass(row.status), row.status || 'unknown');
    top.appendChild(statusEl);
    top.appendChild(document.createTextNode(' → ' + (row.target || '')));
    li.appendChild(top);

    // The diagnosis a customer actually needs: why a failed or still-pending
    // attempt hasn't produced an email.
    if ((row.status === 'failed' || row.status === 'pending') && row.lastError) {
      li.appendChild(el('div', 'mt-1 rounded-md border border-flag/30 bg-flag/5 px-2 py-1 text-flag', row.lastError));
    }

    let metaText = 'Attempt ' + (row.attempts || 0);
    if (row.created) metaText += ' · ' + relativeTime(row.created);
    if (row.status === 'pending' && row.nextAttemptAt) {
      metaText += ' · next attempt ' + relativeTime(row.nextAttemptAt);
    }
    li.appendChild(el('div', 'mt-1 text-muted', metaText));

    // Whether this row can be re-driven is decided ONCE, server-side, by
    // planRetry (the same function the retry endpoint enforces) and arrives as
    // `retryable` — never re-derived from `status` here.
    if (row._id && row.retryable) {
      const retryBtn = el('button', 'btn mt-1.5 px-2 py-1 text-[11px]', 'Retry now');
      retryBtn.type = 'button';
      retryBtn.addEventListener('click', async () => {
        setBusy(retryBtn, true);
        const ok = await guarded(() => retryDelivery(row._id), (msg) => showMsg(refs.msg, msg));
        if (ok) {
          // Success reads as a toast, matching "Form created." / "Settings
          // saved." / delete's own confirmation — named after the control
          // that triggered it ("Retry now" -> "Queued for another attempt.").
          // Errors stay inline, next to this panel, via guarded()'s onError above.
          toast('Queued for another attempt.');
          await loadDeliveries(form, refs);
        } else {
          setBusy(retryBtn, false);
        }
      });
      li.appendChild(retryBtn);
    } else if (row.retryBlockedReason && row.status !== 'sent' && row.status !== 'skipped') {
      // An absent button with no explanation is indistinguishable from a bug.
      li.appendChild(el('div', 'mt-1 text-muted', row.retryBlockedReason));
    }

    refs.list.appendChild(li);
  }
}

async function loadDeliveries(form, refs) {
  const seq = ++deliverySeq;
  hideMsg(refs.msg);
  setBusy(refs.refreshBtn, true);
  try {
    const body = await listDeliveries(form._id, shownDeliveries);
    if (seq !== deliverySeq) return; // superseded by a newer request or form switch
    const rows = body.data || [];
    renderDeliveryRows(refs, rows, form);
    refs.moreBtn.hidden = !body.hasMore;
    // Any retryable row, not just a `failed` one — a configuration error parks
    // rows as `pending` with a growing wait, and that is exactly the backlog
    // this button exists for.
    refs.retryAllBtn.hidden = !rows.some((r) => r.retryable);
  } catch (err) {
    if (seq !== deliverySeq) return;
    showMsg(refs.msg, err.message);
  } finally {
    if (seq === deliverySeq) setBusy(refs.refreshBtn, false);
  }
}

function buildDeliveriesPanel(form) {
  const panel = el('div', 'mt-4 rounded-lg border border-cream bg-paper px-3 py-3');

  const header = el('div', 'flex items-center justify-between gap-2');
  header.appendChild(el('div', 'text-sm font-medium text-ink', 'Recent delivery attempts'));
  const actions = el('div', 'flex gap-1.5');
  const retryAllBtn = el('button', 'btn px-2 py-1 text-[11px]', 'Retry all failed');
  retryAllBtn.type = 'button';
  retryAllBtn.hidden = true;
  const refreshBtn = el('button', 'btn px-2 py-1 text-[11px]', 'Refresh');
  refreshBtn.type = 'button';
  actions.appendChild(retryAllBtn);
  actions.appendChild(refreshBtn);
  header.appendChild(actions);
  panel.appendChild(header);

  const empty = el('p', 'mt-2 text-xs text-muted', 'No delivery attempts yet — submit the form once to test.');
  empty.hidden = true;
  panel.appendChild(empty);

  const list = el('ul', 'mt-1');
  panel.appendChild(list);

  const moreBtn = el('button', 'btn mt-2 px-2 py-1 text-[11px]', 'Show more');
  moreBtn.type = 'button';
  moreBtn.hidden = true;
  panel.appendChild(moreBtn);

  const msg = el('p', 'mt-2 text-xs');
  msg.hidden = true;
  panel.appendChild(msg);

  const refs = { list, empty, moreBtn, retryAllBtn, refreshBtn, msg };

  refreshBtn.addEventListener('click', () => loadDeliveries(form, refs));

  moreBtn.addEventListener('click', () => {
    // Clamp to what the endpoint will actually return, or the count stops
    // changing and the button stays visible as a permanent no-op.
    shownDeliveries = Math.min(shownDeliveries + DELIVERY_PAGE, DELIVERY_PAGE_MAX);
    loadDeliveries(form, refs);
  });

  // The bulk way out of a backlog. Retrying one row at a time is unusable when
  // forty submissions failed over a weekend because BASE_URL was unset.
  retryAllBtn.addEventListener('click', async () => {
    setBusy(retryAllBtn, true);
    const body = await guarded(() => retryAllDeliveries(form._id), (msg2) => showMsg(msg, msg2));
    if (body) {
      const d = body.data || {};
      // Toast, named after the control ("Retry all failed" -> "Queued N
      // delivery attempts."), matching the rest of the success-acknowledgement
      // convention. Errors stay inline via guarded()'s onError above.
      let text = 'Queued ' + (d.queued || 0) + ' delivery attempt' + (d.queued === 1 ? '' : 's') + '.';
      if (d.skipped) text += ' ' + d.skipped + ' could not be retried (see the reasons below).';
      toast(text);
      await loadDeliveries(form, refs);
    }
    setBusy(retryAllBtn, false);
  });

  loadDeliveries(form, refs);

  return panel;
}

// --- notifications + allowed origins --------------------------------------------

function buildNotifySection(form) {
  const wrap = el('div', 'border-b border-cream px-5 py-4');
  wrap.appendChild(el('div', 'eyebrow mb-2', 'Email notifications'));

  const notifyForm = document.createElement('form');
  notifyForm.noValidate = true;

  const notify = (form.notify && form.notify.email) || {};

  // enabled
  const enabledRow = el('label', 'flex items-center gap-2 text-sm text-body');
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  enabledInput.className = 'h-4 w-4 rounded border-cream accent-primary';
  enabledInput.checked = !!notify.enabled;
  enabledRow.appendChild(enabledInput);
  enabledRow.appendChild(document.createTextNode('Send an email when this form receives a submission'));
  notifyForm.appendChild(enabledRow);

  // recipients
  const recipientsField = el('div', 'mt-3');
  recipientsField.appendChild(el('label', 'label', 'Recipients (comma-separated)'));
  const recipientsInput = document.createElement('input');
  recipientsInput.type = 'text';
  recipientsInput.className = 'field';
  recipientsInput.placeholder = 'you@example.com, team@example.com';
  recipientsInput.value = (notify.recipients || []).join(', ');
  recipientsField.appendChild(recipientsInput);
  notifyForm.appendChild(recipientsField);

  // subject
  const subjectField = el('div', 'mt-3');
  subjectField.appendChild(el('label', 'label', 'Subject line (optional)'));
  const subjectInput = document.createElement('input');
  subjectInput.type = 'text';
  subjectInput.className = 'field';
  subjectInput.placeholder = 'New submission: {{form}}';
  subjectInput.value = notify.subjectTemplate || '';
  subjectField.appendChild(subjectInput);

  // Documents exactly the two placeholders renderSubject supports (lib/notify.ts).
  // The old setup page's help text named the form-name token wrong (an extra
  // "Name" suffix that renderSubject does not recognise), and every subject
  // silently lost the form's name as a result. Do not reintroduce that typo below.
  const subjectHelp = el('p', 'mt-1 text-xs text-muted');
  subjectHelp.appendChild(document.createTextNode('Leave blank for a default subject. '));
  subjectHelp.appendChild(el('code', 'rounded bg-sunk px-1 py-0.5 font-mono text-[11px] text-body', '{{form}}'));
  subjectHelp.appendChild(document.createTextNode(" is replaced with the form's name, and "));
  subjectHelp.appendChild(el('code', 'rounded bg-sunk px-1 py-0.5 font-mono text-[11px] text-body', '{{fieldName}}'));
  subjectHelp.appendChild(document.createTextNode(' with a submitted field\'s value.'));
  subjectField.appendChild(subjectHelp);
  notifyForm.appendChild(subjectField);

  // attach files
  const attachRow = el('label', 'mt-3 flex items-center gap-2 text-sm text-body');
  const attachInput = document.createElement('input');
  attachInput.type = 'checkbox';
  attachInput.className = 'h-4 w-4 rounded border-cream accent-primary';
  attachInput.checked = notify.attachFiles !== false;
  attachRow.appendChild(attachInput);
  attachRow.appendChild(document.createTextNode('Attach uploaded files to the email (within the size budget)'));
  notifyForm.appendChild(attachRow);

  const providerHelp = el('p', 'mt-3 text-xs text-muted',
    'Notifications require an email provider configured on the deployment (FROM_EMAIL and either Brevo or ' +
    'Mailgun credentials as environment variables). Save your settings, then submit the form once through the ' +
    "snippet above to confirm the email arrives — if it doesn't, check those environment variables.");
  notifyForm.appendChild(providerHelp);

  notifyForm.appendChild(buildDeliveriesPanel(form));

  // allowed origins
  const allowlistWrap = el('div', 'mt-5');
  allowlistWrap.appendChild(el('div', 'eyebrow mb-2', 'Allowed origins'));
  allowlistWrap.appendChild(el('label', 'label', 'One domain per line'));
  const allowlistInput = document.createElement('textarea');
  allowlistInput.className = 'field font-mono text-xs';
  allowlistInput.rows = 3;
  allowlistInput.placeholder = 'example.com';
  allowlistInput.value = (form.allowedDomains || []).join('\n');
  allowlistWrap.appendChild(allowlistInput);
  allowlistWrap.appendChild(el('p', 'mt-1 text-xs text-muted',
    'Leave empty to accept submissions from any origin. When set, matching is exact — example.com does not also ' +
    'allow www.example.com; list both if you need them.'));
  notifyForm.appendChild(allowlistWrap);

  const saveRow = el('div', 'mt-4');
  const saveBtn = el('button', 'btn btn-primary', 'Save settings');
  saveBtn.type = 'submit';
  saveRow.appendChild(saveBtn);
  notifyForm.appendChild(saveRow);

  const settingsMsg = el('p', 'mt-2 text-xs');
  settingsMsg.hidden = true;
  notifyForm.appendChild(settingsMsg);

  notifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMsg(settingsMsg);

    const recipients = recipientsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const allowedDomains = allowlistInput.value.split('\n').map((s) => s.trim()).filter(Boolean);

    // Same rule the server enforces (lib/recipients.ts RECIPIENT_RE), checked
    // here only to fail instantly and point at the field. The server is the
    // authority: it rejects the PATCH regardless of what this does.
    const badRecipients = recipients.filter((r) => !RECIPIENT_RE.test(r));
    if (badRecipients.length) {
      showMsg(settingsMsg, 'Not a valid email address: ' + badRecipients.join(', '));
      recipientsInput.focus();
      return;
    }

    const patch = {
      notify: {
        email: {
          enabled: enabledInput.checked,
          recipients,
          subjectTemplate: subjectInput.value,
          attachFiles: attachInput.checked,
        },
      },
      allowedDomains,
    };

    setBusy(saveBtn, true);
    const ok = await guarded(() => patchForm(form._id, patch), (msg) => showMsg(settingsMsg, msg));
    setBusy(saveBtn, false);
    if (ok) {
      // A bare inline line next to a button that is simultaneously reverting
      // from "Working…" back to "Save settings" gives the eye nothing to
      // catch — a successful save read as nothing having happened. Toast
      // instead, matching "Form created." / delete's own confirmation /
      // Retry's, and named after the control: "Save settings" -> "Settings
      // saved." Validation and server rejections stay inline, next to this
      // form, via guarded()'s onError above and the recipient check below.
      hideMsg(settingsMsg);
      toast('Settings saved.');
      // Keeps state.forms current for the NEXT render of this pane (e.g. after
      // switching forms and back) — does not repaint the pane now, so the
      // fields the customer just set stay exactly as they typed them.
      await refreshForms();
    }
  });

  wrap.appendChild(notifyForm);
  return wrap;
}

// --- delete form -----------------------------------------------------------------
// Two-step inline confirmation, never window.confirm: it's blocked in some
// embedded contexts and can't name what's actually being lost. First click
// reveals the cost (name only — see below); second click performs it; a third
// control lets the customer back out at any point before that.

function buildDeleteZone(form) {
  const wrap = el('div', 'px-5 py-4');

  const deleteBtn = el('button', 'btn btn-quiet text-flag', 'Delete form');
  deleteBtn.type = 'button';

  const confirmBlock = el('div', 'mt-2');
  confirmBlock.hidden = true;

  const msg = el('p', 'mt-2 text-xs');
  msg.hidden = true;

  deleteBtn.addEventListener('click', () => {
    hideMsg(msg);
    clear(confirmBlock);

    // Deliberately NO submission count here. This datastore treats a dotted
    // $inc key literally (see lib/stats.ts), so form.stats.total has, in the
    // past, read 0 on every form regardless of how many submissions it holds.
    // A wrong count is worse than none before an irreversible delete — "and
    // its 0 submissions" made deleting a form with a thousand of them look
    // safe.
    const name = form.name || 'Untitled';
    const text = el('p', 'mb-2 rounded-lg border border-flag/30 bg-flag/5 px-3 py-2 text-xs text-flag',
      "Delete '" + name + "'? This permanently removes the form, every submission it has received, and every " +
      'uploaded file. This cannot be undone.');
    const yesBtn = el('button', 'btn btn-danger', 'Yes, delete');
    yesBtn.type = 'button';
    const cancelBtn = el('button', 'btn', 'Cancel');
    cancelBtn.type = 'button';
    const row = el('div', 'flex gap-2');
    row.appendChild(yesBtn);
    row.appendChild(cancelBtn);
    confirmBlock.appendChild(text);
    confirmBlock.appendChild(row);

    deleteBtn.hidden = true;
    confirmBlock.hidden = false;

    cancelBtn.addEventListener('click', () => {
      confirmBlock.hidden = true;
      deleteBtn.hidden = false;
      hideMsg(msg);
    });

    yesBtn.addEventListener('click', async () => {
      // Refuses a SECOND delete for this same form id while the first is
      // still in flight — see the comment on `deletingFormIds` above for why
      // this button being enabled at all does not mean it is safe to click.
      if (deletingFormIds.has(form._id)) {
        showMsg(msg, 'This form is already being deleted.');
        return;
      }
      deletingFormIds.add(form._id);
      hideMsg(msg);
      setBusy(yesBtn, true);
      cancelBtn.disabled = true;
      try {
        const ok = await guarded(() => deleteForm(form._id), (m) => showMsg(msg, m));
        if (ok) {
          toast("'" + name + "' was deleted.");
          // Removes the form from the rail and selects whatever is next (or
          // null), dispatching `form-changed` — which repaints this pane.
          await refreshForms();
        } else {
          setBusy(yesBtn, false);
          cancelBtn.disabled = false;
        }
      } finally {
        deletingFormIds.delete(form._id);
      }
    });
  });

  wrap.appendChild(deleteBtn);
  wrap.appendChild(confirmBlock);
  wrap.appendChild(msg);
  return wrap;
}

// --- assembly ----------------------------------------------------------------

function endpointUrl(form) {
  return window.location.origin + '/f/' + form.uuid;
}

export function renderSettings() {
  clear(paneEl);
  shownDeliveries = DELIVERY_PAGE;

  const form = currentForm();
  if (!form) {
    paneEl.appendChild(emptyState('No form selected', 'Create a form to configure notifications, the snippet, and delivery diagnostics.'));
    return;
  }

  const head = el('div', 'border-b border-cream px-5 py-4');
  head.appendChild(el('div', 'eyebrow mb-1', 'Settings'));
  head.appendChild(el('h2', 'text-lg font-semibold leading-tight text-ink', form.name || 'Untitled'));
  head.appendChild(el('div', 'mt-0.5 break-all font-mono text-xs text-muted', endpointUrl(form)));
  paneEl.appendChild(head);

  paneEl.appendChild(buildSnippetSection(form));
  paneEl.appendChild(buildNotifySection(form));
  paneEl.appendChild(buildDeleteZone(form));
}

export function initSettings() {
  // `form-changed` fires on every rail click regardless of which tab is
  // showing (app.js owns the rail; it has no notion of "don't bother, I'm
  // hidden"). Rendering here unconditionally used to mean every rail click,
  // Submissions tab or not, fired `getSnippet` + `listDeliveries` into a pane
  // nobody could see — including their errors, which rendered into that
  // hidden pane and were never shown to anyone. Only render (and therefore
  // only fetch) while this tab is actually the one on screen; app.js calls
  // `renderSettings()` itself, below, the moment the Settings tab is switched
  // to, so the pane is never left stale when it becomes visible.
  window.addEventListener('form-changed', () => {
    if (state.tab === 'settings') renderSettings();
  });
  // Paint an initial state synchronously, exactly as submissions.js does for
  // #record — there is no form yet when this runs (boot() hasn't resolved),
  // so the pane shows the empty state until `form-changed` fires. Harmless
  // while hidden: `currentForm()` is null at boot, so this never fetches.
  renderSettings();
}
