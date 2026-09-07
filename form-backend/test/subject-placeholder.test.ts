import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { renderSubject } from '#lib/notify';

// The setup page told customers to write {{formName}}. renderSubject only knows
// {{form}}, and an unknown key falls through to `fields[key] ?? ''` — so the
// documented placeholder rendered as EMPTY and the form name silently vanished
// from every subject line. Nothing failed; the email just arrived wrong.
//
// These tests pin the behaviour and keep the page's own copy honest, because the
// drift was between two files that no single test read.

test('{{form}} interpolates the form name', () => {
  assert.equal(renderSubject('New submission: {{form}}', 'Careers', {}), 'New submission: Careers');
});

test('an unsupported placeholder renders empty rather than erroring', () => {
  // Documents WHY the drift was invisible: this is a silent substitution, not a throw.
  assert.equal(renderSubject('To {{formName}}', 'Careers', {}), 'To');
});

test('{{fieldName}} interpolates a submitted field', () => {
  assert.equal(renderSubject('Re: {{subject}}', 'Careers', { subject: 'Broken export' }), 'Re: Broken export');
});

// The dashboard rebuild (2026-09-06) moves the settings UI out of index.html
// and into public/settings.js (landing in a later task), and this plan's view
// layer builds text with el()/textContent rather than innerHTML — so a guard
// that string-splits on HTML structure like `class="notify-subject"` can
// never match a plain text node, and would sleep forever once Task 8 lands.
// Instead, scan the RAW SOURCE BYTES of both files for every {{token}}: a
// literal {{form}} appears in the file whether it was authored as markup or
// passed as a string argument to el(), so this works regardless of how the
// DOM gets built. Until either file mentions a {{token}} at all, there is
// nothing to check yet, so that state is a clean skip, not a failure.
function readIfExists(rel: string): string {
  try {
    return readFileSync(new URL(rel, import.meta.url), 'utf8');
  } catch {
    return ''; // file doesn't exist yet — not an error, just not ported here
  }
}

test('every {{placeholder}} documented in the setup page or settings script is one renderSubject supports', (t) => {
  const source = readIfExists('../public/index.html') + '\n' + readIfExists('../public/settings.js');
  const documented = [...source.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  if (documented.length === 0) {
    t.skip('no {{placeholder}} found in index.html or settings.js — settings markup has not been ported yet');
    return;
  }

  for (const key of documented) {
    // {{fieldName}} is the generic stand-in for "any submitted field", which
    // renderSubject supports by design; {{form}} is the one literal name.
    if (key === 'fieldName') continue;
    const out = renderSubject(`X {{${key}}} Y`, 'Careers', {});
    assert.notEqual(
      out,
      'X Y',
      `the setup page/settings script documents {{${key}}}, but renderSubject drops it and renders nothing`
    );
  }
});
