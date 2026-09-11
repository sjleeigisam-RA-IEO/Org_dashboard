'use strict';

// Isolated generated credentials and mocked SMTP only: no deployment env or mail send.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const mail = require('../lib/mail.cjs');
const { createLimiter } = require('../lib/mail-limit.cjs');
const { createHandler } = require('../api/send-code.js');
const nodemailer = require('nodemailer');

const HOST = 'mail-tests.example';
const EMAIL = 'reviewer@igisam.com';
const NOW = 1_800_000_000_000;
const CODE = crypto.randomBytes(24).toString('base64url');
const SALT = crypto.randomBytes(16);
const STORED = `scrypt:${SALT.toString('hex')}:${crypto.scryptSync(CODE, SALT, 32).toString('hex')}`;
const SECRET = crypto.randomBytes(48).toString('base64url');
const PASSWORD = Array.from({ length: 16 }, () => String.fromCharCode(97 + crypto.randomInt(26))).join('');
const ENV = {
  ONE_ACCOUNT_CODE_SCRYPT: STORED,
  ONE_ACCOUNT_SESSION_SECRET: SECRET,
  ONE_ACCOUNT_MAIL_ENABLED: 'true',
  ONE_ACCOUNT_GMAIL_APP_PASSWORD: PASSWORD,
  ONE_ACCOUNT_DELIVERY_CODE: CODE,
};
const savedEnv = new Map();
before(() => {
  for (const [name, value] of Object.entries(ENV)) {
    savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  }
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
    statusCode: 200, body: '', headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(status, values = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
    },
    end(value = '') { this.body += value; },
  };
}
function request({ method = 'POST', body = { email: EMAIL }, headers = {}, chunks = [], streamed = false } = {}) {
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json', ...headers };
  if (!streamed) req.body = body;
  req.socket = { remoteAddress: '192.0.2.42' };
  return req;
}
async function invoke(handler, options) {
  const res = response();
  await handler(request(options), res);
  return res;
}
function assertPrivate(res) {
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.headers['cdn-cache-control'], 'no-store');
  assert.equal(res.headers['vercel-cdn-cache-control'], 'no-store');
  assert.equal(res.headers['set-cookie'], undefined);
  for (const value of [CODE, PASSWORD, SECRET, STORED]) assert.ok(!res.body.includes(value));
}
async function withEnv(changes, run) {
  const previous = new Map();
  try {
    for (const [name, value] of Object.entries(changes)) {
      previous.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('mail config requires explicit enablement, valid app password and matching shared code', async () => {
  assert.deepEqual(mail.settings(), { password: PASSWORD, code: CODE });
  assert.equal(mail.enabled(), true);
  await withEnv({ ONE_ACCOUNT_GMAIL_APP_PASSWORD: PASSWORD.match(/.{4}/g).join(' ') }, () => {
    assert.equal(mail.settings().password, PASSWORD);
  });
  const invalid = [
    { ONE_ACCOUNT_MAIL_ENABLED: undefined },
    { ONE_ACCOUNT_MAIL_ENABLED: 'false' },
    { ONE_ACCOUNT_MAIL_ENABLED: 'TRUE' },
    { ONE_ACCOUNT_GMAIL_APP_PASSWORD: undefined },
    { ONE_ACCOUNT_GMAIL_APP_PASSWORD: PASSWORD.slice(1) },
    { ONE_ACCOUNT_GMAIL_APP_PASSWORD: PASSWORD + 'a' },
    { ONE_ACCOUNT_DELIVERY_CODE: undefined },
    { ONE_ACCOUNT_DELIVERY_CODE: CODE + '-wrong' },
    { ONE_ACCOUNT_CODE_SCRYPT: undefined },
    { ONE_ACCOUNT_CODE_SCRYPT: 'invalid' },
    { ONE_ACCOUNT_SESSION_SECRET: undefined },
  ];
  for (const changes of invalid) await withEnv(changes, () => {
    assert.equal(mail.enabled(), false);
    assert.throws(() => mail.settings());
  });
});

test('mail template fixes sender and exactly one normalized company recipient', () => {
  const result = mail.message(' Reviewer.Name+qa@IGISAM.COM ', CODE);
  assert.deepEqual(result.from, { name: '기획추진센터', address: 'sjlee.igisam@gmail.com' });
  assert.deepEqual(result.to, [{ address: 'reviewer.name+qa@igisam.com' }]);
  for (const field of ['cc', 'bcc', 'replyTo', 'attachments', 'envelope']) assert.equal(result[field], undefined);
  assert.equal(result.disableFileAccess, true);
  assert.equal(result.disableUrlAccess, true);
  assert.ok(result.text.includes(CODE));
  assert.ok(result.html.includes(CODE));
  assert.match(result.text, /https:\/\/one-account-nine\.vercel\.app\//);
});

test('recipient validation rejects external, lookalike, multiple and header-injection addresses', () => {
  for (const email of [
    'reviewer@gmail.com', 'reviewer@sub.igisam.com', 'reviewer@igisam.com.evil.example',
    'a@igisam.com,b@igisam.com', 'a@igisam.com;b@igisam.com',
    'a@igisam.com\r\nBcc: other@example.com', 'Name <reviewer@igisam.com>',
    ['a@igisam.com', 'b@igisam.com'], null, { address: EMAIL },
  ]) assert.throws(() => mail.message(email, CODE), /INVALID_RECIPIENT/);
});

test('HTML mail escapes code markup without changing the text version', () => {
  const code = '<img src="x" onerror=\'boom\'> & <script>alert(1)</script>';
  const result = mail.message(EMAIL, code);
  assert.ok(result.text.includes(code));
  assert.ok(result.html.includes('&lt;img src=&quot;x&quot; onerror=&#39;boom&#39;&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.doesNotMatch(result.html, /<img|<script|onerror='/);
});

test('SMTP uses TLS, fixed Gmail credentials, disabled logging and closes after acceptance', async t => {
  let options, message, closed = 0;
  t.mock.method(nodemailer, 'createTransport', config => {
    options = config;
    return { async sendMail(value) { message = value; return { accepted: [EMAIL], rejected: [] }; }, close() { closed++; } };
  });
  await mail.send(EMAIL);
  assert.equal(options.host, 'smtp.gmail.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.deepEqual(options.auth, { user: mail.SENDER, pass: PASSWORD });
  assert.equal(options.tls.minVersion, 'TLSv1.2');
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout', 'dnsTimeout']) assert.ok(options[key] > 0 && options[key] <= 12000);
  assert.deepEqual(message.to, [{ address: EMAIL }]);
  assert.equal(closed, 1);
});

test('SMTP closes on provider errors or missing/rejected acceptance and never sends invalid recipients', async t => {
  let sendCount = 0, closed = 0, outcome;
  t.mock.method(nodemailer, 'createTransport', () => ({
    async sendMail() { sendCount++; if (outcome instanceof Error) throw outcome; return outcome; },
    close() { closed++; },
  }));
  for (const result of [new Error('simulated SMTP failure'), {}, { accepted: [] }, { accepted: [EMAIL], rejected: ['bad@example.com'] }]) {
    outcome = result;
    await assert.rejects(mail.send(EMAIL));
  }
  assert.equal(sendCount, 4);
  assert.equal(closed, 4);
  await assert.rejects(mail.send('a@igisam.com,b@igisam.com'), /INVALID_RECIPIENT/);
  assert.equal(sendCount, 4);
  assert.equal(closed, 5);
});

test('disabled or mismatched config prevents any SMTP transport creation', async t => {
  let calls = 0;
  t.mock.method(nodemailer, 'createTransport', () => { calls++; throw new Error('unexpected transport'); });
  for (const change of [{ ONE_ACCOUNT_MAIL_ENABLED: 'false' }, { ONE_ACCOUNT_DELIVERY_CODE: CODE + '-wrong' }]) {
    await withEnv(change, async () => { await assert.rejects(mail.send(EMAIL)); });
  }
  assert.equal(calls, 0);
});

test('availability GET exposes only enabled boolean and does not send or reserve', async () => {
  let enabled = true, sends = 0, reservations = 0;
  const handler = createHandler({ enabled: () => enabled, send: () => { sends++; }, reserve: () => { reservations++; return 0; } });
  for (const state of [true, false]) {
    enabled = state;
    const res = await invoke(handler, { method: 'GET' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { enabled: state });
    assertPrivate(res);
  }
  assert.equal(sends, 0);
  assert.equal(reservations, 0);
});

test('send API normalizes recipient and ignores client attempts to alter sender, recipients or code', async () => {
  const recipients = [];
  const handler = createHandler({ enabled: () => true, send: async email => recipients.push(email), now: () => NOW });
  const res = await invoke(handler, { body: {
    email: ' REVIEWER@IGISAM.COM ', code: 'client-injected-code', to: 'attacker@example.com',
    from: 'attacker@example.com', cc: ['attacker@example.com'], bcc: ['attacker@example.com'],
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(recipients, [EMAIL]);
  assert.deepEqual(Object.keys(JSON.parse(res.body)).sort(), ['message', 'retryAfter']);
  assert.equal(JSON.parse(res.body).retryAfter, 60);
  assert.ok(!res.body.includes('client-injected-code'));
  assertPrivate(res);
});

test('send API rejects unsupported methods, absent/foreign/opaque origins and non-HTTPS origin', async () => {
  let calls = 0;
  const handler = createHandler({ enabled: () => true, send: async () => { calls++; } });
  for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
    const res = await invoke(handler, { method });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET, POST');
    assertPrivate(res);
  }
  for (const origin of [undefined, '', 'null', 'https://attacker.example', `https://${HOST}.attacker.example`, `http://${HOST}`]) {
    const res = await invoke(handler, { headers: { origin } });
    assert.equal(res.statusCode, 403);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('send API rejects non-company recipients, malformed JSON, arrays and oversized/non-JSON bodies', async () => {
  let calls = 0;
  const handler = createHandler({ enabled: () => true, send: async () => { calls++; } });
  const invalid = [
    { body: { email: 'reviewer@gmail.com' } },
    { body: { email: 'reviewer@igisam.com.attacker.example' } },
    { body: { email: 'a@igisam.com,b@igisam.com' } },
    { body: { email: ['a@igisam.com', 'b@igisam.com'] } },
    { body: { email: 'a@igisam.com\r\nBcc: external@example.com' } },
    { body: '{' }, { body: null }, { body: [] }, { body: 42 }, { body: '{}' },
    { body: { padding: 'x'.repeat(4097), email: EMAIL } },
    { headers: { 'content-type': 'text/plain' } },
    { headers: { 'content-length': '4097' } },
    { streamed: true, chunks: [Buffer.from('{"email":"' + EMAIL + '","padding":"'), Buffer.from('x'.repeat(4097))] },
  ];
  for (const options of invalid) {
    const res = await invoke(handler, options);
    assert.equal(res.statusCode, 400);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('disabled or mismatched mail configuration returns fail-closed availability and POST response', async () => {
  let calls = 0;
  const handler = createHandler({ send: async () => { calls++; } });
  for (const change of [{ ONE_ACCOUNT_MAIL_ENABLED: 'false' }, { ONE_ACCOUNT_DELIVERY_CODE: CODE + '-wrong' }]) {
    await withEnv(change, async () => {
      const get = await invoke(handler, { method: 'GET' });
      assert.deepEqual(JSON.parse(get.body), { enabled: false });
      assertPrivate(get);
      const post = await invoke(handler);
      assert.equal(post.statusCode, 503);
      assertPrivate(post);
    });
  }
  assert.equal(calls, 0);
});

test('provider errors expose no credentials, code, recipient or SMTP logs and preserve cooldown', async t => {
  const logs = [];
  for (const method of ['log', 'error', 'warn', 'info', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  let sends = 0;
  const handler = createHandler({ enabled: () => true, now: () => NOW, send: async () => {
    sends++;
    throw new Error(`SMTP failure ${CODE} ${PASSWORD} ${SECRET} ${STORED} ${EMAIL}`);
  } });
  const failed = await invoke(handler);
  assert.equal(failed.statusCode, 502);
  assert.equal(JSON.parse(failed.body).retryAfter, 60);
  assert.ok(!failed.body.includes(EMAIL));
  assertPrivate(failed);
  const blocked = await invoke(handler);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['retry-after'], '60');
  assertPrivate(blocked);
  assert.equal(sends, 1);
  assert.deepEqual(logs, []);
});

test('limiter cooldown is shared by recipient across IPs and resets exactly at 60 seconds', () => {
  const reserve = createLimiter();
  const req = request();
  assert.equal(reserve(req, EMAIL, NOW), 0);
  assert.equal(reserve(req, EMAIL, NOW), 60);
  assert.equal(reserve(request({ headers: { 'x-forwarded-for': '198.51.100.20' } }), EMAIL, NOW + 1000), 59);
  assert.equal(reserve(req, EMAIL, NOW + 59999), 1);
  assert.equal(reserve(req, EMAIL, NOW + 60000), 0);
});

test('limiter caps each address at five sends per hour and blocked calls do not extend expiry', () => {
  const reserve = createLimiter();
  const req = request();
  for (let i = 0; i < 5; i++) assert.equal(reserve(req, EMAIL, NOW + i * 60000), 0);
  assert.equal(reserve(req, EMAIL, NOW + 5 * 60000), 3300);
  assert.equal(reserve(req, EMAIL, NOW + 3599999), 1);
  assert.equal(reserve(req, EMAIL, NOW + 3600000), 0);
});

test('limiter caps rotated recipients at 25 per IP per hour, preserving other IP capacity', () => {
  const reserve = createLimiter();
  const req = request({ headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' } });
  for (let i = 0; i < 25; i++) assert.equal(reserve(req, `recipient${i}@igisam.com`, NOW), 0);
  assert.equal(reserve(req, 'recipient25@igisam.com', NOW), 3600);
  assert.equal(reserve(request({ headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.2' } }), 'recipient26@igisam.com', NOW), 3600);
  assert.equal(reserve(request({ headers: { 'x-forwarded-for': '198.51.100.43' } }), 'other-ip@igisam.com', NOW), 0);
  assert.equal(reserve(req, 'after-hour@igisam.com', NOW + 3600000), 0);
});

test('limiter enforces per-instance daily cap despite recipient and IP rotation', () => {
  const reserve = createLimiter();
  for (let i = 0; i < 100; i++) {
    const req = request({ headers: { 'x-forwarded-for': `198.51.100.${i}` } });
    assert.equal(reserve(req, `daily${i}@igisam.com`, NOW), 0);
  }
  const fresh = request({ headers: { 'x-forwarded-for': '203.0.113.200' } });
  assert.equal(reserve(fresh, 'daily100@igisam.com', NOW), 86400);
  assert.equal(reserve(fresh, 'daily100@igisam.com', NOW + 86399999), 1);
  assert.equal(reserve(fresh, 'daily100@igisam.com', NOW + 86400000), 0);
});

test('concurrent send requests reserve before SMTP await so only one mail is attempted', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let sends = 0;
  const handler = createHandler({ enabled: () => true, now: () => NOW, send: async () => {
    sends++;
    entered();
    await gate;
  } });
  const first = invoke(handler);
  await started;
  const second = await invoke(handler, { body: { email: ' REVIEWER@IGISAM.COM ' } });
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers['retry-after'], '60');
  assertPrivate(second);
  release();
  const accepted = await first;
  assert.equal(accepted.statusCode, 200);
  assertPrivate(accepted);
  assert.equal(sends, 1);
});

test('API propagates limiter Retry-After accurately without SMTP invocation', async () => {
  let sends = 0;
  const handler = createHandler({ enabled: () => true, reserve: () => 321, send: async () => { sends++; } });
  const res = await invoke(handler);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['retry-after'], '321');
  assert.equal(JSON.parse(res.body).retryAfter, 321);
  assertPrivate(res);
  assert.equal(sends, 0);
});
