import { test } from 'node:test';
import assert from 'node:assert';
import {
  relativeTime,
  pickWho,
  pickSnippet,
  formatBytes,
  formatCount,
  rangeLabel,
  buildQuery,
  actionsFor,
  mailtoHref,
} from '../public/format.js';

const NOW = new Date('2026-09-06T21:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

// --- relativeTime ---------------------------------------------------

test('relativeTime reports seconds as "just now"', () => {
  assert.equal(relativeTime(iso(5 * 1000), NOW), 'just now');
  assert.equal(relativeTime(iso(59 * 1000), NOW), 'just now');
});

test('relativeTime crosses into minutes, hours and days at the right boundary', () => {
  assert.equal(relativeTime(iso(60 * 1000), NOW), '1 min');
  assert.equal(relativeTime(iso(59 * 60 * 1000), NOW), '59 min');
  assert.equal(relativeTime(iso(60 * 60 * 1000), NOW), '1 hr');
  assert.equal(relativeTime(iso(23 * 60 * 60 * 1000), NOW), '23 hr');
  assert.equal(relativeTime(iso(24 * 60 * 60 * 1000), NOW), '1 day');
  assert.equal(relativeTime(iso(2 * 24 * 60 * 60 * 1000), NOW), '2 days');
});

test('relativeTime falls back to a date beyond 30 days', () => {
  assert.equal(relativeTime('2026-06-01T10:00:00.000Z', NOW), '2026-06-01');
});

test('relativeTime never throws on junk and never renders "NaN"', () => {
  for (const bad of ['', 'not-a-date', null, undefined, 12345]) {
    const out = relativeTime(bad as any, NOW);
    assert.equal(typeof out, 'string');
    assert.ok(!out.includes('NaN'), `"${out}" contains NaN for input ${String(bad)}`);
    assert.ok(!out.includes('Invalid'), `"${out}" leaks Invalid Date for input ${String(bad)}`);
  }
});

test('relativeTime does not render a future timestamp as a negative age', () => {
  const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
  const out = relativeTime(future, NOW);
  assert.ok(!out.startsWith('-'), `future time rendered as "${out}"`);
});

// --- pickWho --------------------------------------------------------

const FIELDS = [
  { name: 'name', type: 'text' },
  { name: 'email', type: 'email' },
  { name: 'message', type: 'textarea' },
];

test('pickWho prefers a name field', () => {
  assert.equal(pickWho({ name: 'Ada Lovelace', email: 'ada@x.dev' }, FIELDS), 'Ada Lovelace');
});

test('pickWho falls back to an email-looking value', () => {
  assert.equal(pickWho({ email: 'grace@navy.example' }, FIELDS), 'grace@navy.example');
});

test('pickWho falls back to the first non-empty string', () => {
  assert.equal(pickWho({ subject: 'Broken export' }, []), 'Broken export');
});

test('pickWho returns Anonymous rather than empty for an empty submission', () => {
  assert.equal(pickWho({}, FIELDS), 'Anonymous');
  assert.equal(pickWho({ name: '   ' }, FIELDS), 'Anonymous');
  assert.equal(pickWho(null as any, FIELDS), 'Anonymous');
});

test('pickWho collapses newlines so one value cannot fake two list rows', () => {
  const out = pickWho({ name: 'Ada\nLovelace\r\nInjected' }, FIELDS);
  assert.ok(!/[\r\n]/.test(out), `pickWho leaked a line break: ${JSON.stringify(out)}`);
});

test('pickWho truncates a very long value', () => {
  const out = pickWho({ name: 'x'.repeat(500) }, FIELDS);
  assert.ok(out.length <= 80, `pickWho returned ${out.length} chars`);
});

test('pickWho ignores non-string values rather than rendering [object Object]', () => {
  const out = pickWho({ name: { nested: true }, subject: 'Real' } as any, []);
  assert.ok(!out.includes('object Object'), `pickWho rendered ${out}`);
});

test('pickWho and pickSnippet preserve hyphens rather than stripping them', () => {
  assert.equal(pickWho({ name: 'Smith-Jones' }, []), 'Smith-Jones');
  assert.equal(
    pickSnippet({ name: 'Ada', message: 'Meeting on 2026-09-06' }, []),
    'Meeting on 2026-09-06'
  );
});

// --- pickSnippet ----------------------------------------------------

test('pickSnippet prefers a message field', () => {
  assert.equal(pickSnippet({ name: 'Ada', message: 'Hello there' }, FIELDS), 'Hello there');
});

test('pickSnippet does not repeat the value pickWho already used', () => {
  const data = { name: 'Ada Lovelace' };
  assert.notEqual(pickSnippet(data, FIELDS), pickWho(data, FIELDS));
});

test('pickSnippet collapses newlines and truncates', () => {
  const out = pickSnippet({ message: 'a\nb\r\nc' + 'x'.repeat(400) }, FIELDS);
  assert.ok(!/[\r\n]/.test(out), 'snippet leaked a line break');
  assert.ok(out.length <= 140, `snippet was ${out.length} chars`);
});

test('pickSnippet returns an empty string when there is nothing else to show', () => {
  assert.equal(pickSnippet({ name: 'Ada' }, FIELDS), '');
});

// --- formatBytes ----------------------------------------------------

test('formatBytes scales through the units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(240 * 1024), '240.0 KB');
  assert.equal(formatBytes(2.4 * 1024 * 1024), '2.4 MB');
});

test('formatBytes never renders NaN for junk', () => {
  for (const bad of [NaN, -1, null, undefined, 'x']) {
    const out = formatBytes(bad as any);
    assert.ok(!out.includes('NaN'), `formatBytes(${String(bad)}) = ${out}`);
  }
});

// --- formatCount and rangeLabel -------------------------------------

test('formatCount marks a capped count rather than lying', () => {
  assert.equal(formatCount(214, true), '214');
  assert.equal(formatCount(5000, false), '5000+');
});

test('rangeLabel describes the visible window', () => {
  assert.equal(rangeLabel(0, 50, 214, true), '1-50 of 214');
  assert.equal(rangeLabel(200, 14, 214, true), '201-214 of 214');
  assert.equal(rangeLabel(0, 50, 5000, false), '1-50 of 5000+');
});

test('rangeLabel handles an empty result without producing "1-0 of 0"', () => {
  assert.equal(rangeLabel(0, 0, 0, true), 'No submissions');
});

// --- buildQuery -----------------------------------------------------

test('buildQuery omits empty values', () => {
  assert.equal(buildQuery({ search: '', status: 'new', limit: 50 }), 'status=new&limit=50');
});

test('buildQuery percent-encodes values', () => {
  const q = buildQuery({ search: 'a&b=c d' });
  assert.ok(!q.includes('a&b=c d'), `unencoded: ${q}`);
  assert.equal(new URLSearchParams(q).get('search'), 'a&b=c d');
});

test('buildQuery returns an empty string when nothing is set', () => {
  assert.equal(buildQuery({ search: '', status: '' }), '');
});

// --- actionsFor -----------------------------------------------------

test('actionsFor never offers a transition to the status already held', () => {
  for (const s of ['new', 'read', 'archived', 'spam']) {
    const nexts = actionsFor(s).map((a) => a.next);
    assert.ok(!nexts.includes(s), `actionsFor('${s}') offered '${s}'`);
  }
});

test('actionsFor offers "Not spam" only for a spam submission', () => {
  assert.ok(actionsFor('spam').some((a) => a.label === 'Not spam'));
  for (const s of ['new', 'read', 'archived']) {
    assert.ok(!actionsFor(s).some((a) => a.label === 'Not spam'), `'${s}' offered Not spam`);
  }
});

test('actionsFor always offers delete', () => {
  for (const s of ['new', 'read', 'archived', 'spam']) {
    assert.ok(actionsFor(s).some((a) => a.kind === 'danger'), `'${s}' had no delete`);
  }
});

test('actionsFor tolerates an unknown status rather than throwing', () => {
  const out = actionsFor('wat');
  assert.ok(Array.isArray(out) && out.length > 0);
});

test('actionsFor never offers two buttons for the same transition', () => {
  for (const s of ['new', 'read', 'archived', 'spam']) {
    const nexts = actionsFor(s)
      .filter((a) => a.next !== null)
      .map((a) => a.next);
    assert.equal(nexts.length, new Set(nexts).size, `actionsFor('${s}') duplicated a transition: ${nexts}`);
  }
});

test('actionsFor offers exactly one way back to the inbox from archived, labelled "Move to inbox"', () => {
  const toRead = actionsFor('archived').filter((a) => a.next === 'read');
  assert.equal(toRead.length, 1);
  assert.equal(toRead[0].label, 'Move to inbox');
});

// --- mailtoHref -------------------------------------------------------------
// The submitter's address is attacker-controlled: the person filling in a
// public contact form can type a `?subject=...&body=...` query string onto
// the end of it. A bare `'mailto:' + email` lets that ride straight into the
// href, opening a pre-composed message in the *operator's* mail client that
// looks like it came from the sender — a phishing vector aimed at whoever
// clicks Reply.

test('mailtoHref refuses an address carrying a mailto query string (header injection)', () => {
  const malicious = 'boss@example.com?subject=URGENT&body=Please+wire+50000+today';
  assert.equal(mailtoHref(malicious), null);
});

test('the naive concatenation this replaces really was exploitable', () => {
  // Not testing mailtoHref here — this documents the vulnerability the fix
  // above addresses, so the regression stays legible without re-reading the
  // finding: the pre-fix code was exactly `'mailto:' + email`.
  const malicious = 'boss@example.com?subject=URGENT&body=Please+wire+50000+today';
  const vulnerableHref = 'mailto:' + malicious;
  assert.ok(vulnerableHref.includes('?') && vulnerableHref.includes('&'));
});

test('mailtoHref refuses an address carrying whitespace or a fragment', () => {
  assert.equal(mailtoHref('boss@example.com#x'), null);
  assert.equal(mailtoHref('boss@example.com\nBcc:evil@example.com'), null);
  assert.equal(mailtoHref('boss @example.com'), null);
});

test('mailtoHref never returns a value with a raw ? or & — even for edge-case addresses', () => {
  const addresses = ['boss@example.com?x=1', 'a&b@example.com', 'plain@example.com', '', undefined, null];
  for (const address of addresses) {
    const href = mailtoHref(address as any);
    if (href !== null) {
      assert.ok(!href.includes('?'), address + ' -> ' + href);
      assert.ok(!href.includes('&'), address + ' -> ' + href);
    }
  }
});

test('mailtoHref builds an encoded mailto: link for an ordinary address', () => {
  assert.equal(mailtoHref('person@example.com'), 'mailto:person%40example.com');
});

test('mailtoHref returns null for empty or non-string input', () => {
  assert.equal(mailtoHref(''), null);
  assert.equal(mailtoHref('   '), null);
  assert.equal(mailtoHref(undefined as any), null);
  assert.equal(mailtoHref(null as any), null);
});
