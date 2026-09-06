import { test } from 'node:test';
import assert from 'node:assert';

process.env.JWT_SECRET = 'token-confusion-test-secret';

const { signToken, verifyRequest } = await import('#lib/auth');
const { signFileToken, verifyFileToken } = await import('#lib/signed-links');

const asCookie = (t: string) => ({ headers: { cookie: 'token=' + t } });

// The two token families are signed with the SAME JWT_SECRET, so a valid
// signature proves only that this deployment minted the token — never what the
// token is FOR. Before the claim check, a file-download token lifted from a
// notification email authenticated as a full admin session.

test('a file-download token is NOT accepted as an admin session', () => {
  const fileToken = signFileToken('sub123', 'file456');
  assert.equal(
    verifyRequest(asCookie(fileToken)),
    false,
    'a /files/<token> value replayed as a session cookie granted admin access'
  );
});

test('an admin session token is NOT accepted as a file-download token', () => {
  assert.equal(
    verifyFileToken(signToken()),
    null,
    'a session cookie was accepted as a per-file download grant'
  );
});

test('a genuine admin session token still authenticates', () => {
  assert.equal(verifyRequest(asCookie(signToken())), true);
});

test('a genuine file token still resolves to its file', () => {
  assert.deepEqual(verifyFileToken(signFileToken('sub123', 'file456')), {
    sid: 'sub123',
    fid: 'file456',
  });
});

test('an alg:none token is refused by both verifiers', async () => {
  const jwt = (await import('jsonwebtoken')).default as any;
  const forgedSession = jwt.sign({ role: 'admin', typ: 'session' }, '', { algorithm: 'none' });
  const forgedFile = jwt.sign({ sid: 'a', fid: 'b', typ: 'file' }, '', { algorithm: 'none' });
  assert.equal(verifyRequest(asCookie(forgedSession)), false);
  assert.equal(verifyFileToken(forgedFile), null);
});

test('a token with no claims at all is refused as a session', async () => {
  const jwt = (await import('jsonwebtoken')).default as any;
  const bare = jwt.sign({}, process.env.JWT_SECRET as string, { algorithm: 'HS256' });
  assert.equal(verifyRequest(asCookie(bare)), false);
});

test('an empty sid or fid does not produce a usable file token', () => {
  assert.equal(verifyFileToken(signFileToken('', 'file456')), null);
  assert.equal(verifyFileToken(signFileToken('sub123', '')), null);
});
