import { test } from 'node:test';
import assert from 'node:assert';
import { validateFields } from '#lib/validation';
import type { FieldDef } from '#lib/validation';

test('an empty schema accepts anything', () => {
  const r = validateFields([], { anything: 'goes', more: 'fields' });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
});

test('strict is ignored when the schema is empty', () => {
  const r = validateFields([], { unknown: 'x' }, true);
  assert.equal(r.ok, true);
});

test('a missing required field fails', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email', required: true }];
  const r = validateFields(defs, {});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'email');
  assert.match(r.errors[0].message, /required/i);
});

test('an empty string counts as missing for a required field', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email', required: true }];
  assert.equal(validateFields(defs, { email: '   ' }).ok, false);
});

test('an optional field left blank passes', () => {
  const defs: FieldDef[] = [{ name: 'phone', type: 'phone' }];
  assert.equal(validateFields(defs, { phone: '' }).ok, true);
});

test('email format is enforced', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  assert.equal(validateFields(defs, { email: 'ada@example.com' }).ok, true);
  assert.equal(validateFields(defs, { email: 'not-an-email' }).ok, false);
});

test('url must be http or https', () => {
  const defs: FieldDef[] = [{ name: 'site', type: 'url' }];
  assert.equal(validateFields(defs, { site: 'https://example.com' }).ok, true);
  assert.equal(validateFields(defs, { site: 'javascript:alert(1)' }).ok, false);
});

test('number rejects non-numeric input and honours min/max', () => {
  const defs: FieldDef[] = [{ name: 'qty', type: 'number', min: 1, max: 10 }];
  assert.equal(validateFields(defs, { qty: '5' }).ok, true);
  assert.equal(validateFields(defs, { qty: 'abc' }).ok, false);
  assert.equal(validateFields(defs, { qty: '0' }).ok, false);
  assert.equal(validateFields(defs, { qty: '11' }).ok, false);
});

test('date must be ISO formatted', () => {
  const defs: FieldDef[] = [{ name: 'when', type: 'date' }];
  assert.equal(validateFields(defs, { when: '2026-09-03' }).ok, true);
  assert.equal(validateFields(defs, { when: '03/09/2026' }).ok, false);
});

test('rating must fall within its range', () => {
  const defs: FieldDef[] = [{ name: 'stars', type: 'rating', min: 1, max: 5 }];
  assert.equal(validateFields(defs, { stars: '4' }).ok, true);
  assert.equal(validateFields(defs, { stars: '9' }).ok, false);
});

test('select must match one of its options', () => {
  const defs: FieldDef[] = [{ name: 'plan', type: 'select', options: ['free', 'pro'] }];
  assert.equal(validateFields(defs, { plan: 'pro' }).ok, true);
  assert.equal(validateFields(defs, { plan: 'enterprise' }).ok, false);
});

test('strict rejects unknown fields when a schema exists', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  assert.equal(validateFields(defs, { email: 'a@b.com', extra: 'x' }, true).ok, false);
  assert.equal(validateFields(defs, { email: 'a@b.com', extra: 'x' }, false).ok, true);
});

test('honeypot and control fields are exempt from strict mode', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email' }];
  const r = validateFields(defs, { email: 'a@b.com', _gotcha: '', _redirect: '/thanks' }, true);
  assert.equal(r.ok, true);
});

test('all failures are reported, not just the first', () => {
  const defs: FieldDef[] = [
    { name: 'email', type: 'email', required: true },
    { name: 'qty', type: 'number' },
  ];
  const r = validateFields(defs, { qty: 'abc' });
  assert.equal(r.errors.length, 2);
});

test('select with no options rejects non-empty value', () => {
  const defs: FieldDef[] = [{ name: 'category', type: 'select' }];
  assert.equal(validateFields(defs, { category: 'any' }).ok, false);
});

test('optional select with no options accepts blank value', () => {
  const defs: FieldDef[] = [{ name: 'category', type: 'select' }];
  assert.equal(validateFields(defs, { category: '' }).ok, true);
});

test('a required file field passes when the file was uploaded', () => {
  const defs: FieldDef[] = [{ name: 'cv', type: 'file', required: true }];
  assert.equal(validateFields(defs, {}, false, ['cv']).ok, true);
});

test('a required file field fails when no file was uploaded', () => {
  const defs: FieldDef[] = [{ name: 'cv', type: 'file', required: true, label: 'Your CV' }];
  const r = validateFields(defs, {}, false, []);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, 'cv');
  assert.match(r.errors[0].message, /Your CV is required/);
});

test('a required file field is not satisfied by a different upload', () => {
  const defs: FieldDef[] = [{ name: 'cv', type: 'file', required: true }];
  assert.equal(validateFields(defs, {}, false, ['photo']).ok, false);
});

test('an optional file field passes with no upload', () => {
  const defs: FieldDef[] = [{ name: 'cv', type: 'file' }];
  assert.equal(validateFields(defs, {}, false, []).ok, true);
});

test('max is applied as a length cap to email, url, phone and date', () => {
  const cases: FieldDef[] = [
    { name: 'email', type: 'email', max: 10 },
    { name: 'url', type: 'url', max: 10 },
    { name: 'phone', type: 'phone', max: 6 },
    { name: 'date', type: 'date', max: 5 },
  ];
  const data = {
    email: 'averylongaddress@example.com',
    url: 'https://example.com/very/long',
    phone: '+47 123 456 789',
    date: '2026-09-03',
  };
  for (const def of cases) {
    const r = validateFields([def], data);
    assert.equal(r.ok, false, `${def.name} should fail its max`);
    assert.match(r.errors[0].message, /at most \d+ characters/);
  }
});

test('max still leaves a value within the cap valid', () => {
  const defs: FieldDef[] = [{ name: 'email', type: 'email', max: 40 }];
  assert.equal(validateFields(defs, { email: 'ada@example.com' }).ok, true);
});

test('a zero-byte upload does not satisfy a required file field', () => {
  const defs: FieldDef[] = [{ name: 'cv', type: 'file', required: true }];
  // The submit handler filters empty parts out before passing field names, so an
  // empty upload must present as absent.
  assert.equal(validateFields(defs, {}, false, []).ok, false);
  assert.equal(validateFields(defs, {}, false, ['cv']).ok, true);
});
