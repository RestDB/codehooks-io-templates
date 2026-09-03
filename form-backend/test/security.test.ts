import { test } from 'node:test';
import assert from 'node:assert';
import { originOf, corsHeaders, safeRedirect } from '#lib/security';
import { safeName } from '#lib/files';

// --- safeRedirect -----------------------------------------------------

const allowGood = { allowRedirectOverride: true, allowedDomains: ['good.com'] };

test('safeRedirect rejects a protocol-relative //host (open redirect)', () => {
  assert.equal(safeRedirect(allowGood, '//evil.com'), null);
});

test('safeRedirect rejects a backslash-host /\\evil.com (open redirect)', () => {
  assert.equal(safeRedirect(allowGood, '/\\evil.com'), null);
});

test('safeRedirect rejects an absolute URL whose host is not allowlisted', () => {
  assert.equal(safeRedirect(allowGood, 'https://evil.com'), null);
});

test('safeRedirect rejects a non-http(s) scheme', () => {
  assert.equal(safeRedirect(allowGood, 'javascript:alert(1)'), null);
});

test('safeRedirect rejects everything when allowRedirectOverride is false', () => {
  const form = { allowRedirectOverride: false, allowedDomains: ['good.com'] };
  assert.equal(safeRedirect(form, 'https://good.com/x'), null);
  assert.equal(safeRedirect(form, '/thanks'), null);
  assert.equal(safeRedirect(form, '//evil.com'), null);
});

test('safeRedirect allows a plain relative path', () => {
  assert.equal(safeRedirect(allowGood, '/thanks'), '/thanks');
});

test('safeRedirect allows an absolute URL whose host is allowlisted', () => {
  assert.equal(safeRedirect(allowGood, 'https://good.com/x'), 'https://good.com/x');
});

test('safeRedirect rejects a host that merely ends with an allowed domain', () => {
  assert.equal(safeRedirect(allowGood, 'https://notgood.com/x'), null);
});

test('safeRedirect returns null for an empty or missing request', () => {
  assert.equal(safeRedirect(allowGood, ''), null);
});

// --- corsHeaders --------------------------------------------------------

test('corsHeaders omits Access-Control-Allow-Origin for a disallowed origin', () => {
  const form = { allowedDomains: ['good.com'] };
  const req = { headers: { origin: 'https://evil.com' } };
  const headers = corsHeaders(form, req);
  assert.equal('Access-Control-Allow-Origin' in headers, false);
});

test('corsHeaders returns * when allowedDomains is empty', () => {
  const form = { allowedDomains: [] };
  const req = { headers: { origin: 'https://anything.com' } };
  const headers = corsHeaders(form, req);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
});

test('corsHeaders echoes the origin and sets Vary when allowed', () => {
  const form = { allowedDomains: ['good.com'] };
  const req = { headers: { origin: 'https://good.com' } };
  const headers = corsHeaders(form, req);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://good.com');
  assert.equal(headers['Vary'], 'Origin');
});

// --- originOf -------------------------------------------------------------

test('originOf returns empty string and does not throw for a garbage Origin header', () => {
  const req = { headers: { origin: 'not a url at all' } };
  assert.doesNotThrow(() => originOf(req));
  assert.equal(originOf(req), '');
});

test('originOf returns empty string and does not throw for a garbage Referer header', () => {
  const req = { headers: { referer: '::::not-a-url::::' } };
  assert.doesNotThrow(() => originOf(req));
  assert.equal(originOf(req), '');
});

test('originOf returns empty string when neither header is present', () => {
  assert.equal(originOf({ headers: {} }), '');
});

// --- safeName ---------------------------------------------------------

test('safeName strips path separators and traversal tokens', () => {
  const name = safeName('../../x');
  assert.equal(name.includes('/'), false);
  assert.equal(name.includes('\\'), false);
  assert.equal(name.includes('..'), false);
});

test('safeName strips NUL bytes', () => {
  const name = safeName('evil\0.txt');
  assert.equal(name.includes('\0'), false);
});
