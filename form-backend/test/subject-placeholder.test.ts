import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// The dashboard rebuild (2026-09-06) moved the settings UI out of index.html
// and into public/settings.js, and this plan's view layer builds text with
// el()/textContent rather than innerHTML — so a guard that string-splits on
// HTML structure like `class="notify-subject"` can never match a plain text
// node. Instead, scan the RAW SOURCE BYTES for every {{token}}: a literal
// {{form}} appears in the file whether it was authored as markup or passed as
// a string argument to el(), so this works regardless of how the DOM gets
// built.
//
// Scanned files: index.html plus EVERY public/*.js module, not just
// settings.js — help text documenting a placeholder could land in any view
// module, and a guard that only reads settings.js would miss it there. Until
// some file mentions a {{token}} at all, there is nothing to check yet, so
// that state is a clean skip, not a failure.
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

function readIfExists(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return ''; // file doesn't exist — not an error, just nothing to scan
  }
}

function readAllSources(): string {
  const jsFiles = readdirSync(publicDir).filter((name) => name.endsWith('.js')).sort();
  const paths = [publicDir + 'index.html', ...jsFiles.map((name) => publicDir + name)];
  return paths.map(readIfExists).join('\n');
}

test('every {{placeholder}} documented across public/*.js and index.html is one renderSubject supports', (t) => {
  const source = readAllSources();
  const documented = [...source.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  if (documented.length === 0) {
    t.skip('no {{placeholder}} found in index.html or any public/*.js — settings markup has not been ported yet');
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
      `the admin UI documents {{${key}}}, but renderSubject drops it and renders nothing`
    );
  }
});
