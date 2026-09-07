// DOM helpers. `el` takes text, never markup — the single reason this page has
// no innerHTML in it: submission content and server error strings are both
// attacker-controlled and both end up on screen.

export function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null && text !== undefined) node.textContent = String(text);
  return node;
}

export function clear(node) {
  node.textContent = '';
  return node;
}

export function toast(message, kind) {
  const host = document.getElementById('toasts');
  const t = el('div', 'rounded-lg px-3 py-2 text-sm shadow-lg ' + (kind === 'error' ? 'bg-flag text-white' : 'bg-ink text-paper'), message);
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

// Two-step confirmation in place, never window.confirm — the same pattern the
// delete-form control already uses, so destructive actions look alike.
export function confirmInline(host, message, onConfirm) {
  clear(host);
  host.hidden = false;
  host.appendChild(el('p', null, message));

  const yes = el('button', 'btn btn-danger', 'Yes, delete');
  yes.type = 'button';
  const no = el('button', 'btn', 'Cancel');
  no.type = 'button';

  no.addEventListener('click', () => {
    host.hidden = true;
    clear(host);
  });

  yes.addEventListener('click', async () => {
    setBusy(yes, true);
    try {
      await onConfirm();
      host.hidden = true;
      clear(host);
    } catch (err) {
      setBusy(yes, false);
      const existing = host.querySelector('p.err');
      const e = el('p', 'mt-2 text-xs text-flag', err.message);
      if (existing) {
        existing.replaceWith(e);
      } else {
        host.appendChild(e);
      }
    }
  });

  const row = el('div', 'mt-4 flex justify-end gap-2');
  row.appendChild(yes);
  row.appendChild(no);
  host.appendChild(row);
}

export function setBusy(button, busy) {
  button.disabled = !!busy;
  if (busy) {
    if (!('label' in button.dataset)) {
      button.dataset.label = button.textContent;
      button.textContent = 'Working…';
    }
  } else if ('label' in button.dataset) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
}

// --- modal -------------------------------------------------------------------
// A plain overlay rather than <dialog>, matching the sibling admin template.
// Escape and a backdrop click both close it, and focus moves to the first field
// so the keyboard path works without a mouse.

const modal = () => document.getElementById('modal');

export function closeModal() {
  const m = modal();
  if (!m) return;
  m.hidden = true;
  clear(document.getElementById('modal-body'));
  clear(document.getElementById('modal-actions'));
  document.getElementById('modal-error').textContent = '';
}

export function modalError(message) {
  document.getElementById('modal-error').textContent = message || '';
}

/** Open the modal. `actions` is [{label, kind, onClick}]; a Cancel is always added. */
export function openModal({ title, description, body, actions }) {
  const m = modal();
  document.getElementById('modal-title').textContent = title || '';
  document.getElementById('modal-desc').textContent = description || '';
  modalError('');

  const bodyHost = clear(document.getElementById('modal-body'));
  if (body) bodyHost.appendChild(body);

  const actionHost = clear(document.getElementById('modal-actions'));
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  actionHost.appendChild(cancel);

  for (const a of actions || []) {
    const b = el('button', 'btn ' + (a.kind === 'danger' ? 'btn-danger' : 'btn-primary'), a.label);
    b.type = 'button';
    b.addEventListener('click', () => a.onClick(b));
    actionHost.appendChild(b);
  }

  m.hidden = false;
  const first = bodyHost.querySelector('input, textarea, select') || actionHost.querySelector('button');
  if (first) first.focus();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal()?.hidden) closeModal();
});
document.getElementById('modal-backdrop')?.addEventListener('click', closeModal);

// --- empty states ------------------------------------------------------------
// An empty pane should read as waiting, not broken.

export function emptyState(title, hint) {
  const wrap = el('div', 'm-auto max-w-xs px-6 py-10 text-center');
  const ring = el('div', 'mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-sunk text-muted');
  ring.appendChild(inboxIcon());
  wrap.appendChild(ring);
  wrap.appendChild(el('p', 'text-sm font-medium text-body', title));
  if (hint) wrap.appendChild(el('p', 'mt-1 text-xs leading-relaxed text-muted', hint));
  return wrap;
}

function inboxIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'h-5 w-5');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0h-3.6a1 1 0 00-.9.55l-.8 1.9a1 1 0 01-.9.55h-3.6a1 1 0 01-.9-.55l-.8-1.9a1 1 0 00-.9-.55H4m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5');
  svg.appendChild(path);
  return svg;
}

// --- dropdown ----------------------------------------------------------------
// A listbox built from buttons rather than a native <select>, so it takes the
// same palette, type and focus treatment as everything else. The value lives in
// a hidden <input> carrying the original id, and selecting dispatches `change`
// on it — so consumers keep reading `el.value` and listening for `change`
// exactly as they would with a select.

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'h-3.5 w-3.5 shrink-0 text-muted');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('d', 'M6 9l6 6 6-6');
  svg.appendChild(p);
  return svg;
}

/**
 * Replace a hidden input with a styled listbox.
 * `input` is the hidden <input> holding the value and the public id.
 * Returns { setOptions, setValue }.
 */
export function dropdown(input, options, ariaLabel) {
  const wrap = el('div', 'relative');
  const button = el('button', 'field flex items-center justify-between gap-2 text-left');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);

  const labelSpan = el('span', 'truncate');
  button.appendChild(labelSpan);
  button.appendChild(chevron());

  const list = el('div', 'absolute left-0 right-0 z-30 mt-1 max-h-64 min-w-max overflow-y-auto rounded-lg border border-cream bg-white p-1 shadow-lg');
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  wrap.appendChild(button);
  wrap.appendChild(list);
  input.insertAdjacentElement('afterend', wrap);

  let opts = [];

  function close() {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }

  function open() {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    (list.querySelector('[aria-selected="true"]') || list.firstElementChild)?.focus();
  }

  function setValue(value, fire) {
    input.value = value;
    const hit = opts.find((o) => o.value === value);
    labelSpan.textContent = hit ? hit.label : (opts[0] ? opts[0].label : '');
    for (const node of list.children) {
      node.setAttribute('aria-selected', node.dataset.value === value ? 'true' : 'false');
    }
    if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setOptions(next) {
    opts = next || [];
    clear(list);
    for (const o of opts) {
      const item = el('button', 'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-body transition hover:bg-sunk aria-[selected=true]:bg-primary-soft aria-[selected=true]:font-medium aria-[selected=true]:text-primary', o.label);
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.dataset.value = o.value;
      item.addEventListener('click', () => {
        setValue(o.value, true);
        close();
        button.focus();
      });
      list.appendChild(item);
    }
    setValue(input.value, false);
  }

  button.addEventListener('click', () => (list.hidden ? open() : close()));

  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); button.focus(); return; }
    if (list.hidden) return;
    const items = [...list.children];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(at + 1, items.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(at - 1, 0)]?.focus(); }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  setOptions(options || []);
  return { setOptions, setValue: (v) => setValue(v, false) };
}
