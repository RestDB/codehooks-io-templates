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
  const t = el('div', 'toast', message);
  if (kind) t.setAttribute('data-kind', kind);
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

// Two-step confirmation in place, never window.confirm — the same pattern the
// delete-form control already uses, so destructive actions look alike.
export function confirmInline(host, message, onConfirm) {
  clear(host);
  host.hidden = false;
  host.appendChild(el('p', null, message));

  const yes = el('button', 'act danger', 'Yes, delete');
  yes.type = 'button';
  const no = el('button', 'act', 'Cancel');
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
      const e = el('p', 'err', err.message);
      if (existing) {
        existing.replaceWith(e);
      } else {
        host.appendChild(e);
      }
    }
  });

  const row = el('div', 'actions');
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
