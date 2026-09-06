import { test } from 'node:test';
import assert from 'node:assert';
import { pickReplyTo, renderSubject, buildNotification } from '#lib/notify';
import type { FileRef } from '#lib/attachments';

const f = (id: string, size: number): FileRef => ({
  id, filename: `${id}.pdf`, contentType: 'application/pdf', size, path: `/uploads/${id}`,
});

// --- Reply-To selection ---

test('prefers a field whose schema type is email', () => {
  const got = pickReplyTo(
    { contact: 'ada@example.com', other: 'zz@example.com' },
    [{ name: 'other', type: 'text' }, { name: 'contact', type: 'email' }]
  );
  assert.equal(got, 'ada@example.com');
});

test('falls back to the first value that looks like an email when no schema says so', () => {
  const got = pickReplyTo({ name: 'Ada', whatever: 'ada@example.com' }, []);
  assert.equal(got, 'ada@example.com');
});

test('returns null when nothing resembles an email', () => {
  assert.equal(pickReplyTo({ name: 'Ada', note: 'hello' }, []), null);
});

test('ignores an email-typed field that is empty', () => {
  const got = pickReplyTo({ contact: '' }, [{ name: 'contact', type: 'email' }]);
  assert.equal(got, null);
});

// --- subject ---

test('renders the form name into the subject', () => {
  assert.equal(renderSubject('New submission: {{form}}', 'Contact', {}), 'New submission: Contact');
});

test('renders a submitted field into the subject', () => {
  assert.equal(renderSubject('From {{name}}', 'Contact', { name: 'Ada' }), 'From Ada');
});

test('an unknown placeholder renders empty rather than leaving braces', () => {
  assert.equal(renderSubject('X {{nope}} Y', 'Contact', {}), 'X Y');
});

test('an empty template falls back to a usable subject', () => {
  assert.equal(renderSubject('', 'Contact', {}), 'New submission: Contact');
});

// --- body ---

const base = {
  formName: 'Contact',
  subjectTemplate: 'New submission: {{form}}',
  fields: { name: 'Ada', email: 'ada@example.com' },
  fieldDefs: [{ name: 'email', type: 'email' }],
  meta: { created: '2026-09-06T10:00:00.000Z', ip: '203.0.113.5', referer: 'https://example.com' },
  plan: { attach: [], tooLarge: [] },
  submissionId: 'sub-1',
  baseUrl: 'https://api.example.com',
};

test('the body lists every submitted field', () => {
  const out = buildNotification(base);
  assert.match(out.text, /name:\s*Ada/);
  assert.match(out.text, /email:\s*ada@example\.com/);
});

test('the body carries submission metadata', () => {
  const out = buildNotification(base);
  assert.match(out.text, /203\.0\.113\.5/);
  assert.match(out.text, /example\.com/);
});

test('attached files are listed', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({ ...base, plan: { attach: [f('cv', 100)], tooLarge: [] } });
  assert.match(out.text, /cv\.pdf/);
  assert.match(out.text, /attached/i);
});

test('files too large to attach are named, not silently omitted', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({ ...base, plan: { attach: [], tooLarge: [f('huge', 99999999)] } });
  assert.match(out.text, /huge\.pdf/);
  assert.match(out.text, /too large/i);
});

test('every file gets a download link regardless of whether it attached', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({
    ...base,
    plan: { attach: [f('a', 10)], tooLarge: [f('b', 99999999)] },
  });
  const links = out.text.match(/https:\/\/api\.example\.com\/files\//g) || [];
  assert.equal(links.length, 2);
});

test('Reply-To is surfaced on the result', () => {
  const out = buildNotification(base);
  assert.equal(out.replyTo, 'ada@example.com');
});

// --- security: body structure spoofing ---

test('body rejects column-0 spoofing via newlines in field values', () => {
  process.env.JWT_SECRET = 'test-secret';
  const out = buildNotification({
    ...base,
    fields: { message: 'Ada\n\n--- files ---\n  https://attacker.example/x' },
  });
  const lines = out.text.split('\n');
  const fakeMarkers = lines.filter(l => l.match(/^---/));
  assert.equal(fakeMarkers.length, 1); // Only the real "--- submission ---"
});

test('multiline field content is preserved in body, just indented', () => {
  const out = buildNotification({
    ...base,
    fields: { message: 'Line 1\nLine 2\nLine 3' },
  });
  assert.match(out.text, /message: Line 1\n    Line 2\n    Line 3/);
});

// --- security: subject header injection ---

test('renderSubject strips CR/LF from field values', () => {
  const out = renderSubject('From {{name}}', 'Contact', { name: 'Ada\r\nBcc: attacker@evil.com' });
  assert.equal(out.includes('\r'), false);
  assert.equal(out.includes('\n'), false);
});

test('renderSubject collapses control characters into spaces', () => {
  const out = renderSubject('Subject: {{msg}}', 'Form', { msg: 'hello\t\tworld' });
  assert.equal(out, 'Subject: hello world');
});

test('renderSubject still renders normal form and field placeholders', () => {
  const out = renderSubject('From {{name}}', 'Contact', { name: 'Ada' });
  assert.equal(out, 'From Ada');
});

test('renderSubject caps subject at 200 chars', () => {
  const longName = 'A'.repeat(300);
  const out = renderSubject('New submission: {{form}}', longName, {});
  assert.equal(out.length <= 200, true);
});

// --- security fix round 2: additional line-break variants ---

test('body neutralises a lone CR so it cannot start a line', () => {
  const out = buildNotification({
    ...base,
    fields: { msg: 'Ada\r\r--- files ---\r  https://attacker.example/x' },
  });
  // The fix converts every line-break variant to "\n" + indent. If a raw CR survives,
  // a renderer that treats it as a break would put "--- files ---" at column 0.
  assert.ok(!out.text.includes('\r'), 'raw CR must not survive into the body');
  const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
  assert.equal(atColumnZero.length, 1, 'only the genuine --- section may start a line');
});

test('body neutralises U+2028 so it cannot start a line', () => {
  const msg = 'Ada' + String.fromCharCode(0x2028) + '--- files ---' + String.fromCharCode(0x2028) + '  https://attacker.example/x';
  const out = buildNotification({
    ...base,
    fields: { msg },
  });
  assert.ok(!out.text.includes(String.fromCharCode(0x2028)), 'raw U+2028 must not survive into the body');
  const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
  assert.equal(atColumnZero.length, 1, 'only the genuine --- section may start a line');
});

test('renderSubject preserves hyphens in dates', () => {
  const out = renderSubject('Submission from {{date}}', 'Contact', { date: '2026-09-06' });
  assert.equal(out, 'Submission from 2026-09-06');
});

test('renderSubject preserves hyphens in compound words', () => {
  const out = renderSubject('About {{topic}}', 'Contact', { topic: 'well-known-issue' });
  assert.equal(out, 'About well-known-issue');
});

test('renderSubject strips U+2028 and U+2029', () => {
  const msg = 'hello' + String.fromCharCode(0x2028) + 'world' + String.fromCharCode(0x2029) + 'end';
  const out = renderSubject('Subject: {{msg}}', 'Form', { msg });
  assert.ok(!out.includes(String.fromCharCode(0x2028)), 'U+2028 must not survive');
  assert.ok(!out.includes(String.fromCharCode(0x2029)), 'U+2029 must not survive');
});

// --- security fix round 3: the field-NAME path (final review, finding 2) ---
//
// Field names come from the same untrusted source as values: a schema-less form
// (`defaultForm()` ships `fields: []`, `strict: false`) accepts any key,
// multipart's `/name="([^"]*)"/` matches CR and LF, and a JSON body reaches
// `flattenFields()` with arbitrary keys. Before the fix the key was interpolated
// raw while only the value was normalised.

test('body rejects column-0 spoofing via newlines in a field NAME', () => {
  process.env.JWT_SECRET = 'test-secret';
  const key = 'msg\n\n--- files ---\ninvoice.pdf (attached)\n  https://evil.example/pwn\n\nx';
  const out = buildNotification({
    ...base,
    fields: { [key]: 'hi' },
    plan: { attach: [f('real', 10)], tooLarge: [] },
  });
  // The raw newline from the key must not survive as a break at column 0.
  const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
  assert.deepEqual(
    atColumnZero,
    ['--- submission ---', '--- files ---'],
    'only the genuine section markers may start a line'
  );
  assert.ok(
    !out.text.includes('\nhttps://evil.example/pwn') &&
      !out.text.includes('\n  https://evil.example/pwn'),
    'a forged download link must not appear as a link line'
  );
});

test('a field NAME containing a lone CR or U+2028 cannot start a line', () => {
  for (const brk of ['\r', '\r\n', String.fromCharCode(0x2028), String.fromCharCode(0x2029)]) {
    const out = buildNotification({
      ...base,
      fields: { [`a${brk}--- files ---`]: 'v' },
      plan: { attach: [], tooLarge: [] },
    });
    assert.ok(!out.text.includes(brk === '\r\n' ? '\r' : brk), `raw ${JSON.stringify(brk)} survived`);
    const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
    assert.equal(atColumnZero.length, 1, `only the genuine --- section may start a line (${JSON.stringify(brk)})`);
  }
});

test('an ordinary field name is unchanged — hyphens and dots survive', () => {
  const out = buildNotification({
    ...base,
    fields: { 'order-ref.2026-09-06': 'ok' },
  });
  assert.match(out.text, /order-ref\.2026-09-06: ok/);
});

test('an uploaded FILENAME cannot forge a section marker', () => {
  process.env.JWT_SECRET = 'test-secret';
  const evil = {
    id: 'x',
    filename: 'ok.pdf\n\n--- submission ---\nreceived: whenever',
    contentType: 'application/pdf',
    size: 10,
    path: '/uploads/x',
  };
  const out = buildNotification({ ...base, plan: { attach: [evil], tooLarge: [] } });
  const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
  assert.deepEqual(atColumnZero, ['--- submission ---', '--- files ---']);
});

test('meta.ip and meta.referer are line-break normalised too', () => {
  const out = buildNotification({
    ...base,
    meta: {
      created: '2026-09-06T10:00:00.000Z',
      ip: '1.2.3.4\n--- files ---',
      referer: 'https://x.example/\n--- files ---',
    },
  });
  const atColumnZero = out.text.split('\n').filter((l) => l.startsWith('---'));
  assert.equal(atColumnZero.length, 1);
});

// --- the inbox link (final review, finding 12) ---

test('the body links to the submission in the inbox', () => {
  const out = buildNotification(base);
  assert.match(
    out.text,
    /https:\/\/api\.example\.com\/admin\/api\/submissions\/sub-1/
  );
});

test('the inbox link says an admin sign-in is needed, so it is not mistaken for a file link', () => {
  const out = buildNotification(base);
  assert.match(out.text, /admin sign-in required/i);
});

test('no inbox link is emitted when no base URL is known', () => {
  const out = buildNotification({ ...base, baseUrl: '' });
  assert.ok(!out.text.includes('/admin/api/submissions/'));
});
