import { test } from 'node:test';
import assert from 'node:assert';
import { composeStats, formView, statsUpdate } from '#lib/stats';

// A fresh form's counter fields, mirroring defaultForm(). Inlined rather than
// imported: lib/forms.ts pulls in codehooks-js, which cannot load under node --test.
const freshForm = () => ({ statsTotal: 0, statsSpam: 0, statsLastSubmissionAt: null });

// --- The dot-notation trap ---------------------------------------------------
//
// This datastore does NOT interpret dot notation in an update as a path into a
// nested object: `$inc: {'stats.total': 1}` creates a TOP-LEVEL key literally
// NAMED "stats.total", and never touches `total` inside `stats`. No error is
// raised. Probed against the deployed platform; see lib/forms.ts.

test('the counter update touches no dotted key — that is the whole bug', () => {
  const update = statsUpdate(false, '2026-09-06T12:00:00.000Z');
  const keys = [...Object.keys(update.$inc), ...Object.keys(update.$set)];
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.ok(!key.includes('.'), `update key "${key}" contains a dot and would be applied literally`);
  }
});

test('the counter update increments the fields the view actually reads', () => {
  const update = statsUpdate(false, '2026-09-06T12:00:00.000Z');
  // Apply the update by hand the way the datastore would, then read it back
  // through the same function the API uses. If the two ever drift apart, the
  // counter goes back to reading zero forever.
  const doc: any = freshForm();
  for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + (v as number);
  Object.assign(doc, update.$set);
  assert.equal(composeStats(doc).total, 1);
  assert.equal(composeStats(doc).lastSubmissionAt, '2026-09-06T12:00:00.000Z');
});

test('a spam submission counts toward both total and spam', () => {
  const doc: any = freshForm();
  for (const isSpam of [true, false, true]) {
    const update = statsUpdate(isSpam, '2026-09-06T12:00:00.000Z');
    for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + (v as number);
  }
  assert.deepEqual(
    { total: composeStats(doc).total, spam: composeStats(doc).spam },
    { total: 3, spam: 2 }
  );
});

test('a new form starts at zero', () => {
  assert.deepEqual(composeStats(freshForm()), { total: 0, spam: 0, lastSubmissionAt: null });
});

// --- Surviving the upgrade ---------------------------------------------------

test('a document written before the fix keeps its true count, with no migration', () => {
  // The stray literal key holds the real historical count. It is frozen — nothing
  // writes it any more — so it is added to the new counter rather than replaced.
  const doc: any = {
    stats: { total: 0, spam: 0, lastSubmissionAt: null },
    'stats.total': 16,
    'stats.lastSubmissionAt': '2026-09-06T20:10:35.600Z',
  };
  assert.equal(composeStats(doc).total, 16);
  assert.equal(composeStats(doc).lastSubmissionAt, '2026-09-06T20:10:35.600Z');
});

test('new submissions add to a legacy count rather than resetting it', () => {
  const doc: any = { 'stats.total': 16, statsTotal: 3, 'stats.spam': 1, statsSpam: 2 };
  assert.equal(composeStats(doc).total, 19);
  assert.equal(composeStats(doc).spam, 3);
});

test('the newer of the two lastSubmissionAt values wins', () => {
  assert.equal(
    composeStats({ 'stats.lastSubmissionAt': '2026-01-01T00:00:00.000Z', statsLastSubmissionAt: '2026-09-06T00:00:00.000Z' }).lastSubmissionAt,
    '2026-09-06T00:00:00.000Z'
  );
  assert.equal(
    composeStats({ 'stats.lastSubmissionAt': '2026-09-06T00:00:00.000Z', statsLastSubmissionAt: null }).lastSubmissionAt,
    '2026-09-06T00:00:00.000Z'
  );
});

test('junk in any counter field is treated as zero, never NaN', () => {
  const doc: any = { statsTotal: 'nonsense', 'stats.total': null, stats: { total: undefined } };
  assert.deepEqual(composeStats(doc), { total: 0, spam: 0, lastSubmissionAt: null });
});

// --- The API projection ------------------------------------------------------

test('the API returns one composed stats object and no raw counter fields', () => {
  const view = formView({
    uuid: 'u', name: 'X',
    statsTotal: 4, statsSpam: 1, statsLastSubmissionAt: '2026-09-06T00:00:00.000Z',
    'stats.total': 16,
    stats: { total: 0, spam: 0, lastSubmissionAt: null },
  });
  assert.deepEqual(view.stats, { total: 20, spam: 1, lastSubmissionAt: '2026-09-06T00:00:00.000Z' });
  for (const leaked of ['statsTotal', 'statsSpam', 'statsLastSubmissionAt', 'stats.total']) {
    assert.ok(!(leaked in view), `${leaked} leaked into the API response`);
  }
});

test('the projection leaves every other field alone', () => {
  const doc = { uuid: 'u', name: 'X', enabled: true, notify: { email: { enabled: false } }, _id: 'abc' };
  const view = formView({ ...doc, statsTotal: 1 });
  for (const [k, v] of Object.entries(doc)) assert.deepEqual(view[k], v);
});

test('the projection is null-safe', () => {
  assert.equal(formView(null), null);
  assert.deepEqual(formView({}).stats, { total: 0, spam: 0, lastSubmissionAt: null });
});
