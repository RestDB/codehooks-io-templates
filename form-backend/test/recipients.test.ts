import { test } from 'node:test';
import assert from 'node:assert';
import { partitionRecipients, checkRecipients } from '#lib/recipients';

// --- partitioning (final review, finding 4) ---

test('a well-formed address is valid', () => {
  const out = partitionRecipients(['team@customer.example']);
  assert.deepEqual(out.valid, ['team@customer.example']);
  assert.deepEqual(out.rejected, []);
});

test('an address with no @ is REJECTED, not silently dropped', () => {
  // The whole point: the old `r.includes('@')` filter dropped this with no trace,
  // so the delivery panel showed nothing and looked like "notifications are off".
  const out = partitionRecipients(['team.customer.example']);
  assert.deepEqual(out.valid, []);
  assert.equal(out.rejected.length, 1);
  assert.equal(out.rejected[0].target, 'team.customer.example');
  assert.match(out.rejected[0].reason, /team\.customer\.example/);
});

test('a display-name form passes a bare @ test but is still rejected', () => {
  const out = partitionRecipients(['Ada <ada@example.com>']);
  assert.deepEqual(out.valid, []);
  assert.equal(out.rejected.length, 1);
});

test('an address with a stray internal space is rejected', () => {
  const out = partitionRecipients(['ada @example.com']);
  assert.deepEqual(out.valid, []);
  assert.equal(out.rejected.length, 1);
});

test('surrounding whitespace is trimmed rather than rejected', () => {
  assert.deepEqual(partitionRecipients(['  ada@example.com  ']).valid, ['ada@example.com']);
});

test('a domain with no dot is rejected', () => {
  assert.equal(partitionRecipients(['ada@localhost']).rejected.length, 1);
});

test('a blank entry is neither valid nor reported', () => {
  const out = partitionRecipients(['', '   ']);
  assert.deepEqual(out.valid, []);
  assert.deepEqual(out.rejected, []);
});

test('a non-string entry is rejected without echoing it back', () => {
  const out = partitionRecipients([{ evil: 'x' }, 42]);
  assert.deepEqual(out.valid, []);
  assert.equal(out.rejected.length, 2);
});

test('the same address twice is one recipient, not two emails', () => {
  assert.deepEqual(
    partitionRecipients(['a@b.com', ' a@b.com ']).valid,
    ['a@b.com']
  );
});

test('good and bad addresses are separated, not all-or-nothing at delivery time', () => {
  const out = partitionRecipients(['ok@example.com', 'nope']);
  assert.deepEqual(out.valid, ['ok@example.com']);
  assert.equal(out.rejected.length, 1);
});

test('a non-array is treated as no recipients', () => {
  const out = partitionRecipients('ada@example.com' as any);
  assert.deepEqual(out.valid, []);
  assert.deepEqual(out.rejected, []);
});

// --- the PATCH gate ---

test('PATCH accepts a valid recipient list and returns it trimmed', () => {
  const check = checkRecipients([' ada@example.com ']);
  assert.equal(check.ok, true);
  assert.deepEqual(check.recipients, ['ada@example.com']);
});

test('PATCH rejects the whole update and NAMES the bad address', () => {
  const check = checkRecipients(['ok@example.com', 'team.customer.example']);
  assert.equal(check.ok, false);
  assert.match(check.error as string, /team\.customer\.example/);
});

test('PATCH pluralises when more than one address is bad', () => {
  const check = checkRecipients(['a', 'b']);
  assert.equal(check.ok, false);
  assert.match(check.error as string, /Invalid recipients:/);
});

test('PATCH rejects a recipients value that is not a list', () => {
  const check = checkRecipients('ada@example.com');
  assert.equal(check.ok, false);
  assert.match(check.error as string, /list of email addresses/);
});

test('PATCH treats an absent recipients value as an empty list, not an error', () => {
  const check = checkRecipients(undefined);
  assert.equal(check.ok, true);
  assert.deepEqual(check.recipients, []);
});
