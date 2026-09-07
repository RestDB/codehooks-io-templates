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
// and into public/settings.js (landing in a later task). Until that lands,
// index.html's #pane-settings is an empty placeholder and documents nothing —
// so the guard below checks both locations rather than pinning to one file,
// and treats "neither documents a placeholder yet" as a clean skip, not a
// failure. Once the settings markup is ported, whichever file carries the
// notify-subject help text is the one this test will start reading again.
function findSubjectHelp() {
  for (const rel of ['../public/index.html', '../public/settings.js']) {
    let content;
    try {
      content = readFileSync(new URL(rel, import.meta.url), 'utf8');
    } catch {
      continue; // file doesn't exist yet — not an error, just not ported here
    }
    const help = content.split('class="notify-subject"')[1]?.split('</p>')[0];
    if (help) return help;
  }
  return '';
}

test('every placeholder the setup page documents is one renderSubject supports', (t) => {
  const help = findSubjectHelp();
  const documented = help ? [...help.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]) : [];

  if (documented.length === 0) {
    t.skip('settings markup (notify-subject help text) has not been ported to index.html or settings.js yet');
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
      `the setup page documents {{${key}}}, but renderSubject drops it and renders nothing`
    );
  }
});
