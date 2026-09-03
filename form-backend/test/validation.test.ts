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
