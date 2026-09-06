import { test } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { passwordMatches, verifyRequest, signToken, parseCookies } from '#lib/auth';

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// --- passwordMatches ---

test('passwordMatches returns false when ADMIN_PASSWORD is unset', () => {
  withEnv({ ADMIN_PASSWORD: undefined }, () => {
    assert.equal(passwordMatches('anything'), false);
  });
});

test('passwordMatches returns false when ADMIN_PASSWORD is empty', () => {
  withEnv({ ADMIN_PASSWORD: '' }, () => {
    assert.equal(passwordMatches('anything'), false);
  });
});

test('passwordMatches rejects a wrong password and accepts the correct one', () => {
  withEnv({ ADMIN_PASSWORD: 'correct-horse-battery-staple' }, () => {
    assert.equal(passwordMatches('wrong'), false);
    assert.equal(passwordMatches('correct-horse-battery-staple'), true);
  });
});

test('passwordMatches does not throw when candidate and expected differ wildly in length', () => {
  withEnv({ ADMIN_PASSWORD: 'a' }, () => {
    assert.doesNotThrow(() => passwordMatches('a'.repeat(5000)));
    assert.equal(passwordMatches('a'.repeat(5000)), false);
  });
  withEnv({ ADMIN_PASSWORD: 'a'.repeat(5000) }, () => {
    assert.doesNotThrow(() => passwordMatches('a'));
    assert.equal(passwordMatches('a'), false);
  });
});

// --- verifyRequest ---

test('verifyRequest returns false with no Cookie header', () => {
  withEnv({ JWT_SECRET: 'test-secret' }, () => {
    assert.equal(verifyRequest({ headers: {} }), false);
  });
});

test('verifyRequest returns false with a Cookie header carrying no token', () => {
  withEnv({ JWT_SECRET: 'test-secret' }, () => {
    assert.equal(verifyRequest({ headers: { cookie: 'other=value' } }), false);
  });
});

test('verifyRequest returns false with a garbage token value', () => {
  withEnv({ JWT_SECRET: 'test-secret' }, () => {
    assert.equal(verifyRequest({ headers: { cookie: 'token=not-a-real-jwt' } }), false);
  });
});

test('verifyRequest returns true for a cookie carrying a token from signToken()', () => {
  withEnv({ JWT_SECRET: 'test-secret' }, () => {
    const token = signToken();
    assert.equal(verifyRequest({ headers: { cookie: `token=${token}` } }), true);
  });
});

test('verifyRequest rejects a token forged with a different secret', () => {
  withEnv({ JWT_SECRET: 'the-real-secret' }, () => {
    const forged = jwt.sign({ role: 'admin' }, 'a-different-secret', { expiresIn: '7d' });
    assert.equal(verifyRequest({ headers: { cookie: `token=${forged}` } }), false);
  });
});

// --- parseCookies ---

test('parseCookies handles multiple cookies', () => {
  const out = parseCookies('a=1; b=2; token=abc');
  assert.deepEqual(out, { a: '1', b: '2', token: 'abc' });
});

test('parseCookies trims surrounding whitespace', () => {
  const out = parseCookies('  a=1 ;   b=2  ');
  assert.equal(out.a, '1');
  assert.equal(out.b, '2');
});

test('parseCookies preserves a value containing "="', () => {
  const out = parseCookies('token=abc.def=ghi');
  assert.equal(out.token, 'abc.def=ghi');
});

test('parseCookies handles an empty header', () => {
  assert.deepEqual(parseCookies(''), {});
});
