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

test('every placeholder the setup page documents is one renderSubject supports', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

  // Scope to the notification subject help text, not the whole page.
  const help = html.split('class="notify-subject"')[1]?.split('</p>')[0] ?? '';
  assert.ok(help, 'could not locate the subject-template help text in index.html');

  const documented = [...help.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  assert.ok(documented.length > 0, 'the help text documents no placeholder at all');

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
