import { test } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { signFileToken, verifyFileToken } from '#lib/signed-links';

function withSecret(secret: string, fn: () => void) {
  const prev = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prev;
  }
}

test('a signed token round-trips to its submission and file', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    assert.deepEqual(verifyFileToken(t), { sid: 'sub-1', fid: 'file-9' });
  });
});

test('a token scopes to ONE file, not a whole submission', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    const claims = verifyFileToken(t);
    assert.equal(claims?.fid, 'file-9');
    // there is no wildcard or omitted fid form
    assert.notEqual(claims?.fid, undefined);
  });
});

test('a tampered token is rejected', () => {
  withSecret('test-secret', () => {
    const t = signFileToken('sub-1', 'file-9');
    const parts = t.split('.');
    const forged = parts[0] + '.' + Buffer.from('{"sid":"sub-1","fid":"other"}').toString('base64url') + '.' + parts[2];
    assert.equal(verifyFileToken(forged), null);
  });
});

test('a token signed with a DIFFERENT secret is rejected', () => {
  let foreign = '';
  withSecret('another-secret', () => { foreign = signFileToken('sub-1', 'file-9'); });
  withSecret('test-secret', () => {
    assert.equal(verifyFileToken(foreign), null);
  });
});

test('an expired token is rejected', () => {
  withSecret('test-secret', () => {
    const expired = jwt.sign({ sid: 'sub-1', fid: 'file-9' }, 'test-secret', { expiresIn: -10 });
    assert.equal(verifyFileToken(expired), null);
  });
});

test('garbage is rejected without throwing', () => {
  withSecret('test-secret', () => {
    assert.equal(verifyFileToken('not-a-token'), null);
    assert.equal(verifyFileToken(''), null);
  });
});

test('verification fails closed when JWT_SECRET is unset', () => {
  let t = '';
  withSecret('test-secret', () => { t = signFileToken('sub-1', 'file-9'); });
  const prev = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    assert.equal(verifyFileToken(t), null);
  } finally {
    if (prev !== undefined) process.env.JWT_SECRET = prev;
  }
});
