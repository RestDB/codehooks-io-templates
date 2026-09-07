import { test } from 'node:test';
import assert from 'node:assert';
import { planAttachments } from '#lib/attachments';
import type { FileRef } from '#lib/attachments';

const f = (id: string, size: number): FileRef => ({
  id, filename: `${id}.bin`, contentType: 'application/octet-stream', size, path: `/uploads/${id}`,
});

test('everything attaches when it fits the budget', () => {
  const plan = planAttachments([f('a', 100), f('b', 200)], 1000);
  assert.deepEqual(plan.attach.map((x) => x.id), ['a', 'b']);
  assert.equal(plan.tooLarge.length, 0);
});

test('files over the budget are reported, never silently dropped', () => {
  const plan = planAttachments([f('big', 900), f('small', 50)], 500);
  assert.deepEqual(plan.attach.map((x) => x.id), ['small']);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['big']);
});

test('smallest first, so one big file cannot crowd out several small ones', () => {
  const plan = planAttachments([f('big', 600), f('a', 100), f('b', 100)], 700);
  assert.deepEqual(plan.attach.map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['big']);
});

test('a single file larger than the whole budget never attaches', () => {
  const plan = planAttachments([f('huge', 5000)], 1000);
  assert.equal(plan.attach.length, 0);
  assert.deepEqual(plan.tooLarge.map((x) => x.id), ['huge']);
});

test('no files yields empty lists rather than throwing', () => {
  const plan = planAttachments([], 1000);
  assert.deepEqual(plan.attach, []);
  assert.deepEqual(plan.tooLarge, []);
});

test('a zero budget attaches nothing and reports everything', () => {
  const plan = planAttachments([f('a', 1)], 0);
  assert.equal(plan.attach.length, 0);
  assert.equal(plan.tooLarge.length, 1);
});

test('every input file appears in exactly one output list', () => {
  const files = [f('a', 100), f('b', 900), f('c', 50)];
  const plan = planAttachments(files, 200);
  const seen = [...plan.attach, ...plan.tooLarge].map((x) => x.id).sort();
  assert.deepEqual(seen, ['a', 'b', 'c']);
});
