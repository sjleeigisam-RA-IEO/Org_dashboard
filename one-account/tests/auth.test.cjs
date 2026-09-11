'use strict';

// These tests generate isolated credentials and never load a deployment env file.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const authenticate = require('../api/auth.js');
const app = require('../api/app.js');
const dashboard = require('../api/dashboard.js');
const logout = require('../api/logout.js');

const HOST = 'auth-tests.example';
const EMAIL = 'reviewer@igisam.com';
const NOW = 1_800_000_000;
const CODE = crypto.randomBytes(24).toString('base64url');
const SALT = crypto.randomBytes(16);
const STORED = `scrypt:${SALT.toString('hex')}:${crypto.scryptSync(CODE, SALT, 32).toString('hex')}`;
const SECRET = crypto.randomBytes(48).toString('base64url');
const savedEnv = new Map();
let key;

before(() => {
  for (const name of ['ONE_ACCOUNT_CODE_SCRYPT', 'ONE_ACCOUNT_SESSION_SECRET', 'ONE_ACCOUNT_DATA_KEY']) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.ONE_ACCOUNT_CODE_SCRYPT = STORED;
  process.env.ONE_ACCOUNT_SESSION_SECRET = SECRET;
  key = auth.config().key;
});
after(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function response() {
  const headers = {};
  return {
    statusCode: 200,
    body: '',
    headersSent: false,
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(status, values = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      this.headersSent = true;
    },
    end(value = '') { this.body += value; this.ended = true; },
    destroy() { this.destroyed = true; },
  };
}

function request({ method = 'POST', body, headers = {}, chunks = [] } = {}) {
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = {
    host: HOST,
    origin: `https://${HOST}`,
    'content-type': 'application/json',
    ...headers,
  };
  if (body !== undefined) req.body = body;
  req.socket = { remoteAddress: '192.0.2.42' };
  return req;
}

async function login(body = {}, headers) {
  const res = response();
  await authenticate(request({ body: { email: EMAIL, code: CODE, ...body }, headers }), res);
  return res;
}

function signed(payload, signingKey = key) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', signingKey).update(encoded).digest('base64url')}`;
}

function claims(overrides = {}) {
  return { v: 1, email: EMAIL, remember: true, iat: NOW, exp: NOW + 30 * 86400, ...overrides };
}

function cookieToken(res) {
  const cookie = res.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  assert.ok(cookie.startsWith(`${auth.COOKIE}=`));
  return cookie.slice(auth.COOKIE.length + 1).split(';')[0];
}

function assertNoStore(res) {
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.headers['cdn-cache-control'], 'no-store');
  assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
}

test('remembered session has absolute 30-day expiry with exact server boundary', () => {
  const session = auth.makeSession(EMAIL, true, key, NOW);
  assert.equal(session.duration, 2_592_000);
  assert.equal(session.expiresAt, NOW + 2_592_000);
  assert.equal(auth.verifySession(session.token, key, session.expiresAt - 1).exp, session.expiresAt);
  assert.equal(auth.verifySession(session.token, key, session.expiresAt), null);
  assert.equal(auth.verifySession(session.token, key, session.expiresAt + 1), null);
  assert.equal(auth.verifySession(session.token, key, NOW + 86400).exp, session.expiresAt);
});

test('ordinary session expires at eight hours even if the cookie is retained', () => {
  const session = auth.makeSession(EMAIL, false, key, NOW);
  assert.equal(session.duration, 28_800);
  assert.ok(auth.verifySession(session.token, key, NOW + 28_799));
  assert.equal(auth.verifySession(session.token, key, NOW + 28_800), null);
});

test('tampered payloads, signatures, different keys and oversized tokens are rejected', () => {
  const token = auth.makeSession(EMAIL, true, key, NOW).token;
  const [payload, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify(claims({ email: 'attacker@igisam.com' }))).toString('base64url');
  assert.equal(auth.verifySession(`${changed}.${signature}`, key, NOW), null);
  assert.equal(auth.verifySession(`${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`, key, NOW), null);
  assert.equal(auth.verifySession(token, crypto.randomBytes(32), NOW), null);
  for (const malformed of [undefined, null, '', token + '.extra', 'A'.repeat(2049), `${payload}.!`]) {
    assert.equal(auth.verifySession(malformed, key, NOW), null);
  }
});

test('signed but invalid claims cannot extend duration or move issuance into the future', () => {
  const invalidClaims = [
    { iat: NOW + 61, exp: NOW + 2_592_000 },
    { exp: NOW + 2_592_001 },
    { remember: false, exp: NOW + 28_801 },
    { remember: 'true' },
    { v: 2 },
    { iat: NOW + 0.5 },
    { exp: NOW + 0.5 },
    { iat: Number.MIN_SAFE_INTEGER - 1 },
    { iat: NOW + 60, exp: NOW + 59 },
    { exp: NOW },
    { email: 'reviewer@igisam.com.attacker.example' },
  ];
  for (const overrides of invalidClaims) {
    assert.equal(auth.verifySession(signed(claims(overrides)), key, NOW), null, JSON.stringify(overrides));
  }
  assert.ok(auth.verifySession(signed(claims({ iat: NOW + 60 })), key, NOW));
});

test('company email validation allows normalized exact domain and rejects lookalikes', () => {
  assert.equal(auth.emailAddress(' Reviewer.Name+qa@IGISAM.COM '), 'reviewer.name+qa@igisam.com');
  assert.equal(auth.emailAddress('a@igisam.com'), 'a@igisam.com');
  for (const email of [
    'reviewer@gmail.com', 'reviewer@sub.igisam.com', 'reviewer@igisam.com.attacker.example',
    'reviewer@igisamXcom', 'reviewer@@igisam.com', 'a..b@igisam.com', '@igisam.com',
    '.reviewer@igisam.com', 'reviewer.@igisam.com', 'reviewer\n@igisam.com',
    'reviewer@igisam.com\nattacker@example.com', 'a'.repeat(65) + '@igisam.com', null, 12,
  ]) assert.equal(auth.emailAddress(email), null, String(email));
});

test('valid remembered login sets a secure persistent cookie for exactly 30 days', async () => {
  const res = await login({ email: ' REVIEWER@IGISAM.COM ', rememberMe: true });
  assert.equal(res.statusCode, 200);
  const cookie = res.headers['set-cookie'];
  for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=2592000', 'Expires=']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  const session = auth.verifySession(cookieToken(res), key);
  assert.equal(session.email, EMAIL);
  assert.equal(session.remember, true);
  assert.equal(session.exp - session.iat, 2_592_000);
  assert.equal(new Date(cookie.match(/Expires=([^;]+)/)[1]).getTime(), session.exp * 1000);
  assert.equal(JSON.parse(res.body).expiresAt, session.exp);
  assertNoStore(res);
});

test('ordinary login and string rememberMe values never produce persistent cookies', async () => {
  for (const rememberMe of [undefined, false, 'true', 'false', 1, null]) {
    const res = await login({ rememberMe });
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(res.headers['set-cookie'], /Max-Age|Expires|Domain=/);
    const session = auth.verifySession(cookieToken(res), key);
    assert.equal(session.remember, false);
    assert.equal(session.exp - session.iat, 28_800);
  }
});

test('wrong code or non-company domain cannot issue a session', async () => {
  for (const body of [{ code: CODE + '-wrong' }, { code: {} }, { code: 'x'.repeat(257) }, { email: 'reviewer@igisam.com.attacker.example' }]) {
    const res = await login(body);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['set-cookie'], undefined);
    assertNoStore(res);
  }
});

test('login rejects cross-origin, malformed, non-JSON and oversized requests', async () => {
  const crossOrigin = await login({}, { origin: 'https://attacker.example' });
  assert.equal(crossOrigin.statusCode, 403);
  assert.equal(crossOrigin.headers['set-cookie'], undefined);
  for (const req of [
    request({ body: '{' }),
    request({ body: null }),
    request({ body: [] }),
    request({ body: { email: EMAIL, code: CODE }, headers: { 'content-type': 'text/plain' } }),
    request({ body: { email: EMAIL, code: CODE }, headers: { 'content-length': '4097' } }),
    request({ body: { padding: 'x'.repeat(4097) } }),
    request({ chunks: [Buffer.from('{"padding":"'), Buffer.from('x'.repeat(4097))] }),
  ]) {
    const res = response();
    await authenticate(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['set-cookie'], undefined);
  }
});

test('missing or malformed authentication configuration fails closed at protected APIs', async () => {
  const savedCode = process.env.ONE_ACCOUNT_CODE_SCRYPT;
  const savedSecret = process.env.ONE_ACCOUNT_SESSION_SECRET;
  try {
    for (const [code, secret] of [[undefined, SECRET], [STORED, undefined], ['bad-config', SECRET], [STORED, 'short']]) {
      if (code === undefined) delete process.env.ONE_ACCOUNT_CODE_SCRYPT;
      else process.env.ONE_ACCOUNT_CODE_SCRYPT = code;
      if (secret === undefined) delete process.env.ONE_ACCOUNT_SESSION_SECRET;
      else process.env.ONE_ACCOUNT_SESSION_SECRET = secret;
      assert.throws(() => auth.config(), /AUTH_NOT_CONFIGURED/);
      for (const handler of [authenticate, app, dashboard]) {
        const res = response();
        await handler(request({ method: 'GET' }), res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.headers['set-cookie'], undefined);
        assertNoStore(res);
      }
    }
  } finally {
    process.env.ONE_ACCOUNT_CODE_SCRYPT = savedCode;
    process.env.ONE_ACCOUNT_SESSION_SECRET = savedSecret;
  }
});

test('expired or duplicate cookies cannot authenticate even if the browser sends them', async () => {
  const now = Math.floor(Date.now() / 1000);
  const expired = auth.makeSession(EMAIL, true, key, now - 2_592_000 - 1);
  const live = auth.makeSession(EMAIL, true, key);
  for (const cookie of [
    `${auth.COOKIE}=${expired.token}`,
    `${auth.COOKIE}=${live.token}; ${auth.COOKIE}=${live.token}`,
    `${auth.COOKIE}=${live.token}.tampered`,
    `other_cookie=${live.token}`,
  ]) {
    const req = request({ method: 'GET', headers: { cookie } });
    const statusRes = response();
    await authenticate(req, statusRes);
    assert.deepEqual(JSON.parse(statusRes.body), { authenticated: false });
    const appRes = response();
    app(req, appRes);
    assert.equal(appRes.statusCode, 302);
    assert.equal(appRes.headers.location, '/');
    const dataRes = response();
    await dashboard(req, dataRes);
    assert.equal(dataRes.statusCode, 401);
    assert.doesNotMatch(dataRes.body, /embedded-data|<!doctype/i);
  }
});

test('authenticated status and app reads do not renew the 30-day session', async () => {
  const issued = Math.floor(Date.now() / 1000) - 86400;
  const session = auth.makeSession(EMAIL, true, key, issued);
  const req = request({ method: 'GET', headers: { cookie: `other=1; ${auth.COOKIE}=${session.token}` } });
  const statusRes = response();
  await authenticate(req, statusRes);
  assert.deepEqual(JSON.parse(statusRes.body), { authenticated: true, email: EMAIL, expiresAt: session.expiresAt });
  assert.equal(statusRes.headers['set-cookie'], undefined);
  const appRes = response();
  app(req, appRes);
  assert.equal(appRes.statusCode, 200);
  assert.match(appRes.body, /iframe src="\/api\/dashboard"/);
  assert.equal(appRes.headers['set-cookie'], undefined);
  assertNoStore(appRes);
});

test('changing deployment-code config invalidates previously signed sessions', () => {
  const token = auth.makeSession(EMAIL, true, key, NOW).token;
  const original = process.env.ONE_ACCOUNT_CODE_SCRYPT;
  try {
    process.env.ONE_ACCOUNT_CODE_SCRYPT = `scrypt:${SALT.toString('hex')}:${crypto.randomBytes(32).toString('hex')}`;
    assert.equal(auth.verifySession(token, auth.config().key, NOW), null);
  } finally { process.env.ONE_ACCOUNT_CODE_SCRYPT = original; }
});

test('logout rejects GET, foreign and opaque origins without clearing a cookie', () => {
  for (const req of [
    request({ method: 'GET' }),
    request({ headers: { origin: 'https://attacker.example' } }),
    request({ headers: { origin: 'https://auth-tests.example.attacker.example' } }),
    request({ headers: { origin: 'http://' + HOST } }),
    request({ headers: { origin: 'null' } }),
  ]) {
    const res = response();
    logout(req, res);
    assert.equal(res.statusCode, req.method === 'GET' ? 405 : 403);
    assert.equal(res.headers['set-cookie'], undefined);
    assertNoStore(res);
  }
});

test('same-origin logout clears the host cookie using matching security attributes', () => {
  const res = response();
  logout(request({ headers: { 'content-type': 'application/x-www-form-urlencoded' } }), res);
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.location, '/');
  assert.equal(res.headers['set-cookie'], `${auth.COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  assertNoStore(res);
});

test('rotating email addresses cannot evade the 40-failure IP limit or reset its 15-minute window', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const headers = { 'x-forwarded-for': '198.51.100.71' };
  for (let attempt = 1; attempt <= 39; attempt++) {
    const res = await login({ email: `rotate${attempt}@igisam.com`, code: CODE + '-wrong' }, headers);
    assert.equal(res.statusCode, 401, `failure ${attempt}`);
  }
  // A coworker can still authenticate before the threshold; success does not reset the IP bucket.
  assert.equal((await login({ email: 'coworker@igisam.com' }, headers)).statusCode, 200);
  assert.equal((await login({ email: 'rotate40@igisam.com', code: CODE + '-wrong' }, headers)).statusCode, 401);
  const blocked = await login({ email: 'fresh-local-part@igisam.com' }, headers);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['retry-after'], '900');
  assert.equal(blocked.headers['set-cookie'], undefined);
  assertNoStore(blocked);
  // The same identifier on a different IP remains usable.
  assert.equal((await login({ email: 'fresh-local-part@igisam.com' }, { 'x-forwarded-for': '198.51.100.72' })).statusCode, 200);
  clock += 15 * 60 * 1000 - 1;
  assert.equal((await login({ email: 'after-window@igisam.com' }, headers)).statusCode, 429);
  clock += 1;
  assert.equal((await login({ email: 'after-window@igisam.com' }, headers)).statusCode, 200);
});

test('the eight-failure email-and-IP limit remains stricter than the shared IP limit', async () => {
  const headers = { 'x-forwarded-for': '203.0.113.81' };
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await login({ email: 'pair-limit@igisam.com', code: CODE + '-wrong' }, headers);
    assert.equal(res.statusCode, 401);
  }
  const blocked = await login({ email: 'pair-limit@igisam.com' }, headers);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['set-cookie'], undefined);
  assert.equal((await login({ email: 'other-coworker@igisam.com' }, headers)).statusCode, 200);
});
