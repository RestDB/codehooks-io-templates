import { test } from 'node:test';
import assert from 'node:assert';
import { partitionRecipients, checkRecipients, checkNotifyPatch } from '#lib/recipients';

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

// --- non-array shapes must never be SILENT (fix-wave review, finding 5) ---
//
// This block previously asserted that a bare string is "treated as no
// recipients". That assertion was wrong, and it locked in F4's exact failure
// mode: a form whose `recipients` is the string "owner@example.com" — saved by
// curl before the PATCH gate existed, or written straight to the datastore —
// produced no target, no rejected entry, and therefore NO DELIVERY ROW. The panel
// built to answer "why did no email arrive" was empty, which is indistinguishable
// from notifications being switched off.

test('a bare string is coerced to a single recipient rather than silently dropped', () => {
  const out = partitionRecipients('ada@example.com' as any);
  assert.deepEqual(out.valid, ['ada@example.com']);
  assert.deepEqual(out.rejected, []);
});

test('a bare string that is NOT an address is rejected visibly, not dropped', () => {
  const out = partitionRecipients('team.customer.example' as any);
  assert.deepEqual(out.valid, []);
  assert.equal(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, /team\.customer\.example/);
});

test('any other non-array shape produces a visible rejection, never silence', () => {
  for (const shape of [42, true, { a: 1 }]) {
    const out = partitionRecipients(shape as any);
    assert.deepEqual(out.valid, [], String(shape));
    assert.equal(out.rejected.length, 1, String(shape));
    assert.match(out.rejected[0].reason, /list of email addresses/i);
  }
});

test('nothing configured is still nothing configured — no phantom failed row', () => {
  // The one case that MUST stay silent: `skipped`/no-row semantics depend on it,
  // and a phantom `failed` row for an unconfigured form is its own kind of noise.
  for (const shape of [undefined, null, []]) {
    const out = partitionRecipients(shape as any);
    assert.deepEqual(out.valid, [], String(shape));
    assert.deepEqual(out.rejected, [], String(shape));
  }
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


// --- the PATCH shape gate (fix-wave review, finding 6) ---
//
// `patch.notify.email.recipients = check.recipients` is an assignment into
// whatever the client sent. In strict-mode ESM, assigning a property to a
// primitive THROWS — so PATCH {"notify":{"email":"a@b.com"}} produced a
// TypeError out of a handler with no try/catch, instead of the 400 with a named
// cause that validating recipients was added to produce.

test('a primitive notify.email is a named 400, not a thrown TypeError', () => {
  for (const email of ['a@b.com', 42, true]) {
    const check = checkNotifyPatch({ email });
    assert.equal(check.ok, false, String(email));
    assert.equal(check.assign, false, String(email));
    assert.match(check.error as string, /notify\.email must be an object/i);
  }
});

test('an array notify.email is refused too — assigning into it would not throw, it would hide', () => {
  const check = checkNotifyPatch({ email: ['a@b.com'] });
  assert.equal(check.ok, false);
  assert.match(check.error as string, /notify\.email must be an object/i);
});

test('a primitive notify is a named 400', () => {
  for (const notify of ['on', 7, true, []]) {
    const check = checkNotifyPatch(notify);
    assert.equal(check.ok, false, String(notify));
    assert.match(check.error as string, /notify must be an object/i);
  }
});

test('a well-formed notify.email is accepted and its recipients normalised', () => {
  const check = checkNotifyPatch({ email: { enabled: true, recipients: [' ada@example.com '] } });
  assert.equal(check.ok, true);
  assert.equal(check.assign, true);
  assert.deepEqual(check.recipients, ['ada@example.com']);
});

test('a bad address inside a well-formed notify.email still names itself', () => {
  const check = checkNotifyPatch({ email: { recipients: ['team.customer.example'] } });
  assert.equal(check.ok, false);
  assert.match(check.error as string, /team\.customer\.example/);
});

test('notify without an email key is accepted and normalises nothing', () => {
  for (const notify of [{}, { email: undefined }, { email: null }, { webhook: { url: 'x' } }]) {
    const check = checkNotifyPatch(notify);
    assert.equal(check.ok, true, JSON.stringify(notify));
    assert.equal(check.assign, false, JSON.stringify(notify));
  }
});

test('an absent notify is not an error and touches nothing', () => {
  const check = checkNotifyPatch(undefined);
  assert.equal(check.ok, true);
  assert.equal(check.assign, false);
});
