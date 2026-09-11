'use strict';

// Generated test credentials and injected RPC/fetch only. Never loads a deployment env or reaches a DB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const db = require('../lib/shared-db.cjs');
const teams = require('../api/teams.js');
const history = require('../api/history.js');

const HOST = 'shared-tests.example';
const EMAIL = 'reviewer@igisam.com';
const CODE = crypto.randomBytes(24).toString('base64url');
const SALT = crypto.randomBytes(16);
const STORED = `scrypt:${SALT.toString('hex')}:${crypto.scryptSync(CODE, SALT, 32).toString('hex')}`;
const SECRET = crypto.randomBytes(48).toString('base64url');
const DB_KEY = `sb_secret_${crypto.randomBytes(32).toString('base64url')}`;
const ENV = {
  ONE_ACCOUNT_CODE_SCRYPT: STORED,
  ONE_ACCOUNT_SESSION_SECRET: SECRET,
  ONE_ACCOUNT_SHARED_ENABLED: 'true',
  ONE_ACCOUNT_SUPABASE_URL: 'https://sharedtests123.supabase.co',
  ONE_ACCOUNT_SUPABASE_SECRET_KEY: DB_KEY,
};
const savedEnv = new Map();
let signingKey;
before(() => {
  for (const [name, value] of Object.entries(ENV)) {
    savedEnv.set(name, process.env[name]);
    process.env[name] = value;
  }
  signingKey = auth.config().key;
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
function request({ method = 'GET', url = '/api/teams', body, headers = {}, chunks = [], authenticated = true } = {}) {
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = {
    host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json',
    ...(authenticated ? { cookie: `${auth.COOKIE}=${auth.makeSession(EMAIL, false, signingKey).token}` } : {}),
    ...headers,
  };
  if (body !== undefined) req.body = body;
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
  for (const value of [CODE, STORED, SECRET, DB_KEY]) assert.ok(!res.body.includes(value));
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
function rawState(extra = {}) {
  return {
    dataset_id: db.DATASET_ID, status: 'ok', revision: 7, current_revision: 7,
    assignments: { account1: { primaryRmId: 'rm1', backupRmId: '', sponsorRmId: 'rm3' } },
    updated_at: '2026-09-11T09:00:00Z', actor_email: 'editor@igisam.com',
    snapshot_id: 'snapshot-7', baseline_sha256: 'a'.repeat(64), ...extra,
  };
}
function commit(extra = {}) {
  return { expectedRevision: 7, assignments: rawState().assignments, requestId: crypto.randomUUID(), note: ' 배정 수정 ', ...extra };
}
function rawVersion(extra = {}) {
  return {
    revision: 7, parent_revision: 6, created_at: '2026-09-11T09:00:00.123456+00:00',
    actor_email: EMAIL, action: 'save', note: '', restored_from_revision: null,
    changes: [{ account_id: 'account1', account_name: 'Example account', role: 'primary', before_rm_id: null, after_rm_id: 'rm1', before_rm_name: null, after_rm_name: 'Example RM' }],
    ...extra,
  };
}
function rawHistory(extra = {}) { return { dataset_id: db.DATASET_ID, versions: [], next_before_revision: null, ...extra }; }

test('shared DB config requires explicit enablement, fixed Supabase host and secret key format', async () => {
  assert.deepEqual(db.settings(), { url: ENV.ONE_ACCOUNT_SUPABASE_URL, key: DB_KEY, dataset: db.DATASET_ID });
  await withEnv({ ONE_ACCOUNT_SUPABASE_URL: `${ENV.ONE_ACCOUNT_SUPABASE_URL}/` }, () => {
    assert.equal(db.settings().url, ENV.ONE_ACCOUNT_SUPABASE_URL);
  });
  for (const changes of [
    { ONE_ACCOUNT_SHARED_ENABLED: undefined }, { ONE_ACCOUNT_SHARED_ENABLED: 'TRUE' },
    { ONE_ACCOUNT_SUPABASE_URL: 'http://sharedtests123.supabase.co' },
    { ONE_ACCOUNT_SUPABASE_URL: 'https://sharedtests123.supabase.co.attacker.example' },
    { ONE_ACCOUNT_SUPABASE_URL: 'https://sharedtests123.supabase.co/rest/v1' },
    { ONE_ACCOUNT_SUPABASE_URL: 'https://user:password@sharedtests123.supabase.co' },
    { ONE_ACCOUNT_SUPABASE_SECRET_KEY: undefined }, { ONE_ACCOUNT_SUPABASE_SECRET_KEY: 'sb_publishable_test' },
  ]) await withEnv(changes, () => {
    assert.throws(() => db.settings(), error => error.message === 'DB_NOT_CONFIGURED');
  });
});

test('RPC uses the server secret as apikey without a JWT Bearer header and bounds network wait', async t => {
  const expected = rawState();
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    sent = { url, options };
    return { ok: true, async json() { return expected; } };
  });
  const args = { p_dataset_id: db.DATASET_ID, p_revision: null };
  assert.deepEqual(await db.rpc('oa_get_state', args), expected);
  assert.equal(sent.url, `${ENV.ONE_ACCOUNT_SUPABASE_URL}/rest/v1/rpc/oa_get_state`);
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.headers.apikey, DB_KEY);
  assert.equal(sent.options.headers['Content-Type'], 'application/json');
  assert.ok(!Object.keys(sent.options.headers).some(name => name.toLowerCase() === 'authorization'));
  assert.deepEqual(JSON.parse(sent.options.body), args);
  assert.ok(sent.options.signal instanceof AbortSignal);
  assert.equal(sent.options.signal.aborted, false);
});

test('RPC reduces database failures to a code and never exposes provider diagnostics', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    async json() { return { code: '22023', message: `private SQL ${DB_KEY}`, details: SECRET, hint: STORED }; },
  }));
  await assert.rejects(db.rpc('oa_get_state', {}), error => {
    assert.equal(error.message, 'DB_REQUEST_FAILED');
    assert.equal(error.dbCode, '22023');
    assert.equal(error.details, undefined);
    for (const secret of [DB_KEY, SECRET, STORED]) assert.ok(!String(error.stack).includes(secret));
    return true;
  });
});

test('RPC rejects unreadable, scalar and array success bodies', async t => {
  let result;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, async json() { if (result === 'throw') throw new SyntaxError('bad JSON'); return result; } }));
  for (result of ['throw', null, 'unexpected', 9, false, []]) {
    await assert.rejects(db.rpc('oa_get_state', {}), /DB_RESPONSE_INVALID/);
  }
});

test('all shared reads and writes require a valid unexpired signed session before RPC', async () => {
  let calls = 0;
  const rpc = async () => { calls++; return rawState(); };
  const expired = auth.makeSession(EMAIL, false, signingKey, Math.floor(Date.now() / 1000) - auth.NORMAL_SECONDS - 1).token;
  for (const [handler, options] of [
    [teams.createHandler({ rpc }), {}],
    [teams.createHandler({ rpc }), { method: 'POST', body: commit() }],
    [history.createHandler({ rpc }), { url: '/api/history' }],
  ]) for (const headers of [{}, { cookie: `${auth.COOKIE}=forged.payload` }, { cookie: `${auth.COOKIE}=${expired}` }]) {
    const res = await invoke(handler, { ...options, authenticated: false, headers });
    assert.equal(res.statusCode, 401);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('unsupported methods are rejected and advertise permitted methods', async () => {
  let calls = 0;
  const rpc = async () => { calls++; };
  for (const [handler, method, allow] of [
    [teams.createHandler({ rpc }), 'DELETE', 'GET, POST'],
    [history.createHandler({ rpc }), 'POST', 'GET'],
  ]) {
    const res = await invoke(handler, { method });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, allow);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('save and restore require an explicit same-origin HTTPS request', async () => {
  let calls = 0;
  const handler = teams.createHandler({ rpc: async () => { calls++; return rawState(); } });
  for (const origin of [undefined, '', 'null', 'https://attacker.example', `https://${HOST}.attacker.example`, `http://${HOST}`, `https://${HOST}:444`, 'invalid']) {
    const res = await invoke(handler, { method: 'POST', body: commit(), headers: { origin } });
    assert.equal(res.statusCode, 403, String(origin));
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('current and historical reads use the fixed dataset and preserve current revision separately', async () => {
  const calls = [];
  const handler = teams.createHandler({ rpc: async (name, args) => {
    calls.push({ name, args });
    return rawState({ revision: args.p_revision ?? 7, private_key: DB_KEY, session_secret: SECRET });
  } });
  const current = await invoke(handler, { url: '/api/teams?datasetId=attacker&actorEmail=forged%40igisam.com' });
  const older = await invoke(handler, { url: '/api/teams?revision=3' });
  assert.equal(current.statusCode, 200);
  assert.equal(older.statusCode, 200);
  assert.deepEqual(calls, [
    { name: 'oa_get_state', args: { p_dataset_id: db.DATASET_ID, p_revision: null } },
    { name: 'oa_get_state', args: { p_dataset_id: db.DATASET_ID, p_revision: 3 } },
  ]);
  const view = JSON.parse(older.body);
  assert.equal(view.revision, 3);
  assert.equal(view.currentRevision, 7);
  assert.equal(view.actorEmail, EMAIL);
  assert.equal(view.updatedBy, 'editor@igisam.com');
  assert.equal(view.updatedAt, '2026-09-11T09:00:00Z');
  assert.equal(view.snapshotId, 'snapshot-7');
  assert.equal(view.baselineSha256, 'a'.repeat(64));
  assert.deepEqual(view.assignments, rawState().assignments);
  assertPrivate(current); assertPrivate(older);
});

test('historical read rejects malformed, fractional, negative and unsafe revision numbers before RPC', async () => {
  let calls = 0;
  const handler = teams.createHandler({ rpc: async () => { calls++; } });
  for (const revision of ['', '0', '-1', '1.5', '1e2', '01', 'Infinity', '9007199254740992', 'garbage']) {
    const res = await invoke(handler, { url: `/api/teams?revision=${encodeURIComponent(revision)}` });
    assert.equal(res.statusCode, 400, revision);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('full 575-account save passes its revision and request ID while actor and dataset come only from server', async () => {
  const assignments = Object.fromEntries(Array.from({ length: 575 }, (_, i) => [`account${i}`, {
    primaryRmId: `rm${i % 75}`, backupRmId: '', sponsorRmId: 'rm74',
    updatedAtByRole: { primary: '2026-09-11T09:00:00Z' },
  }]));
  const body = commit({ assignments });
  let sent;
  const handler = teams.createHandler({ rpc: async (name, args) => { sent = { name, args }; return rawState({ revision: 8, current_revision: 8, status: 'committed' }); } });
  const res = await invoke(handler, { method: 'POST', body, url: '/api/teams?actorEmail=forged%40igisam.com&datasetId=forged', headers: { 'x-user-email': 'forged@igisam.com' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, { name: 'oa_commit_state', args: {
    p_dataset_id: db.DATASET_ID, p_expected_revision: 7, p_assignments: assignments,
    p_actor_email: EMAIL, p_request_id: body.requestId, p_note: '배정 수정', p_restore_revision: null,
  } });
  assert.equal(JSON.parse(res.body).revision, 8);
  assertPrivate(res);
});

test('client actor/dataset overrides and unknown fields in the body are rejected before any write', async () => {
  let calls = 0;
  const handler = teams.createHandler({ rpc: async () => { calls++; return rawState(); } });
  for (const forged of [{ actorEmail: 'forged@igisam.com' }, { p_actor_email: EMAIL }, { datasetId: 'other' }, { p_dataset_id: 'other' }, { revision: 1 }, { unexpected: true }]) {
    const res = await invoke(handler, { method: 'POST', body: commit(forged) });
    assert.equal(res.statusCode, 400);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('commit validates request UUID, base revision, assignment shape, role fields and note length', async () => {
  let calls = 0;
  const handler = teams.createHandler({ rpc: async () => { calls++; return rawState(); } });
  const invalid = [null, [], 'text', {},
    ...[0, -1, 1.1, '7', Number.MAX_SAFE_INTEGER + 1].map(expectedRevision => commit({ expectedRevision })),
    ...['', 'idempotent-key', '00000000-0000-0000-0000-000000000000', 4].map(requestId => commit({ requestId })),
    ...[null, [], 4, 'text'].map(assignments => commit({ assignments })),
    commit({ assignments: Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`a${i}`, {}])) }),
    commit({ assignments: { ['a'.repeat(121)]: {} } }),
    ...[null, [], 'text', { actorEmail: EMAIL }, { primaryRmId: 2 }, { backupRmId: null }, { sponsorRmId: 'a'.repeat(121) }]
      .map(record => commit({ assignments: { account1: record } })),
    commit({ note: 7 }), commit({ note: 'a'.repeat(501) }),
  ];
  for (const body of invalid) {
    const res = await invoke(handler, { method: 'POST', body });
    assert.equal(res.statusCode, 400);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('restore carries a base revision and historical revision without accepting simultaneous assignments', async () => {
  let sent;
  const handler = teams.createHandler({ rpc: async (name, args) => { sent = { name, args }; return rawState({ revision: 8, current_revision: 8, status: 'committed' }); } });
  const body = { expectedRevision: 7, restoreRevision: 3, requestId: crypto.randomUUID(), note: '이전 배정 복원' };
  const res = await invoke(handler, { method: 'POST', body });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, { name: 'oa_commit_state', args: {
    p_dataset_id: db.DATASET_ID, p_expected_revision: 7, p_assignments: null, p_actor_email: EMAIL,
    p_request_id: body.requestId, p_note: body.note, p_restore_revision: 3,
  } });
  assertPrivate(res);
  for (const invalid of [0, -1, '3', 1.5, null]) {
    assert.equal((await invoke(handler, { method: 'POST', body: { ...body, restoreRevision: invalid } })).statusCode, 400);
  }
  assert.equal((await invoke(handler, { method: 'POST', body: { ...body, assignments: {} } })).statusCode, 400);
});

test('conflict becomes HTTP 409 with latest state for reconciliation and never silently retries', async () => {
  let calls = 0;
  const latest = rawState({ revision: 9, current_revision: 9, status: 'conflict' });
  const handler = teams.createHandler({ rpc: async () => { calls++; return latest; } });
  const res = await invoke(handler, { method: 'POST', body: commit() });
  assert.equal(res.statusCode, 409);
  assert.equal(calls, 1);
  const view = JSON.parse(res.body);
  assert.equal(view.status, 'conflict');
  assert.equal(view.revision, 9);
  assert.deepEqual(view.assignments, latest.assignments);
  assert.equal(view.actorEmail, EMAIL);
  assertPrivate(res);
});

test('JSON reader handles parsed, string, Buffer and streamed full payloads and counts UTF-8 bytes', async () => {
  const body = commit();
  const raw = JSON.stringify(body);
  for (const options of [{ body }, { body: raw }, { body: Buffer.from(raw) }, { chunks: [raw.slice(0, 17), raw.slice(17)] }]) {
    assert.deepEqual(await db.readJson(request(options)), body);
  }
  const max = 512 * 1024;
  const boundary = '"' + 'a'.repeat(max - 2) + '"';
  assert.equal(Buffer.byteLength(boundary), max);
  assert.equal((await db.readJson(request({ body: boundary }))).length, max - 2);
  await assert.rejects(db.readJson(request({ body: boundary + ' ' })), /BAD_BODY/);
  await assert.rejects(db.readJson(request({ body: '"' + '한'.repeat(Math.ceil(max / 3)) + '"' })), /BAD_BODY/);
  await assert.rejects(db.readJson(request({ chunks: ['a'.repeat(max), 'b'] })), /BAD_BODY/);
});

test('save rejects oversized, malformed, declared-too-large and wrong-content-type bodies without RPC', async () => {
  let calls = 0;
  const handler = teams.createHandler({ rpc: async () => { calls++; return rawState(); } });
  for (const options of [
    { body: '{bad JSON' }, { body: '' },
    { body: commit(), headers: { 'content-type': 'text/plain' } },
    { body: commit(), headers: { 'content-length': String(512 * 1024 + 1) } },
    { body: commit({ note: 'a'.repeat(512 * 1024) }) },
    { chunks: ['a'.repeat(512 * 1024), 'b'] },
  ]) {
    const res = await invoke(handler, { method: 'POST', ...options });
    assert.equal(res.statusCode, 400);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
});

test('teams maps expected database codes and sanitizes every other database/network failure', async () => {
  for (const [code, status] of [['22023', 400], ['P0002', 404], ['42501', 503], [undefined, 503]]) {
    const handler = teams.createHandler({ rpc: async () => {
      throw Object.assign(new Error(`SQL contains ${DB_KEY} and ${SECRET}`), { dbCode: code, details: STORED });
    } });
    for (const options of [{}, { method: 'POST', body: commit() }]) {
      const res = await invoke(handler, options);
      assert.equal(res.statusCode, status);
      assertPrivate(res);
      assert.doesNotMatch(res.body, /SQL contains|dbCode|details|42501|P0002/);
    }
  }
});

test('history maps immutable versions and changed fields and preserves the pagination cursor', async () => {
  let sent;
  const handler = history.createHandler({ rpc: async (name, args) => {
    sent = { name, args };
    return rawHistory({ versions: [{
      revision: 9, parent_revision: 8, created_at: '2026-09-11T10:00:00Z', actor_email: EMAIL,
      action: 'restore', note: '복원', restored_from_revision: 3,
      changes: [{ account_id: 'account1', account_name: 'Historical Account', role: 'primary', before_rm_id: 'rm2', after_rm_id: 'rm1', before_rm_name: 'Previous RM', after_rm_name: 'Next RM', secret: DB_KEY }],
      private: SECRET,
    }], next_before_revision: 9, private: STORED });
  } });
  const res = await invoke(handler, { url: '/api/history?before=10&limit=1&datasetId=forged' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, { name: 'oa_get_history', args: { p_dataset_id: db.DATASET_ID, p_limit: 1, p_before_revision: 10 } });
  assert.deepEqual(JSON.parse(res.body), { versions: [{
    revision: 9, parentRevision: 8, createdAt: '2026-09-11T10:00:00Z', actorEmail: EMAIL,
    action: 'restore', note: '복원', restoredFromRevision: 3,
    changes: [{ accountId: 'account1', role: 'primary', beforeRmId: 'rm2', afterRmId: 'rm1' }],
  }], nextBeforeRevision: 9 });
  assertPrivate(res);
});

test('history defaults to 20 versions and distinguishes exhausted pagination with null', async () => {
  let sent;
  const handler = history.createHandler({ rpc: async (name, args) => { sent = { name, args }; return rawHistory(); } });
  const res = await invoke(handler, { url: '/api/history' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, { name: 'oa_get_history', args: { p_dataset_id: db.DATASET_ID, p_limit: 20, p_before_revision: null } });
  assert.deepEqual(JSON.parse(res.body), { versions: [], nextBeforeRevision: null });
  assertPrivate(res);
});

test('history bounds page size and validates historical cursor before RPC', async () => {
  let calls = 0;
  const handler = history.createHandler({ rpc: async () => { calls++; return rawHistory(); } });
  for (const query of ['limit=0', 'limit=51', 'limit=-1', 'limit=1.1', 'limit=Infinity', 'limit=garbage', 'before=', 'before=0', 'before=-1', 'before=01', 'before=1e2', 'before=9007199254740992']) {
    const res = await invoke(handler, { url: `/api/history?${query}` });
    assert.equal(res.statusCode, 400, query);
    assertPrivate(res);
  }
  assert.equal(calls, 0);
  assert.equal((await invoke(handler, { url: '/api/history?limit=50' })).statusCode, 200);
  assert.equal(calls, 1);
});

test('history and disabled shared DB responses fail closed without revealing settings or provider errors', async () => {
  const handler = history.createHandler({ rpc: async () => { throw new Error(`${DB_KEY} ${SECRET} ${STORED}`); } });
  const failed = await invoke(handler, { url: '/api/history' });
  assert.equal(failed.statusCode, 503);
  assertPrivate(failed);
  await withEnv({ ONE_ACCOUNT_SHARED_ENABLED: 'false' }, async () => {
    for (const handler of [teams, history]) {
      const res = await invoke(handler);
      assert.equal(res.statusCode, 503);
      assertPrivate(res);
      assert.doesNotMatch(res.body, /DB_NOT_CONFIGURED|supabase\.co|ONE_ACCOUNT_/);
    }
  });
});

test('state validation accepts all actual SQL statuses, baseline timestamps and historical replay results', () => {
  for (const status of ['ok', 'committed', 'noop', 'conflict', 'replayed']) {
    const raw = rawState({ status, original_status: status === 'replayed' ? 'committed' : undefined });
    assert.equal(db.stateView(raw, EMAIL).status, status);
  }
  const baseline = rawState({
    revision: 1, assignments: { account1: {
      primaryRmId: 'rm1', backupRmId: '', sponsorRmId: '', updatedAtByRole: { primary: '2026-09-10' },
    } },
  });
  const view = db.stateView(baseline, EMAIL);
  assert.deepEqual(view.assignments, baseline.assignments);
  assert.notEqual(view.assignments, baseline.assignments);
  assert.notEqual(view.assignments.account1.updatedAtByRole, baseline.assignments.account1.updatedAtByRole);
  const replay = db.stateView(rawState({ status: 'replayed', original_status: 'noop', revision: 3, current_revision: 10 }), EMAIL);
  assert.equal(replay.revision, 3);
  assert.equal(replay.currentRevision, 10);
  assert.equal(replay.actorEmail, EMAIL);
  assert.deepEqual(db.stateView(rawState({ assignments: {} }), EMAIL).assignments, {});
});

test('malformed state responses fail closed at GET and POST without leaking DB payload fields', async () => {
  const invalid = [null, [], {},
    ...[undefined, 'saved', null, { secret: DB_KEY }].map(status => rawState({ status })),
    rawState({ status: 'replayed' }), rawState({ status: 'replayed', original_status: 'conflict' }),
    rawState({ dataset_id: 'another-dataset' }), rawState({ dataset_id: undefined }),
    ...[undefined, 0, -1, 2.5, '7', Number.MAX_SAFE_INTEGER + 1].map(revision => rawState({ revision })),
    rawState({ current_revision: 6 }), rawState({ current_revision: undefined }), rawState({ current_revision: '7' }),
    rawState({ updated_at: 'yesterday' }), rawState({ actor_email: 'foreign@example.com' }),
    rawState({ snapshot_id: '' }), rawState({ baseline_sha256: 'not-a-hash' }),
    ...[undefined, null, [], 'private=' + DB_KEY].map(assignments => rawState({ assignments })),
    ...[null, [], {}, { primaryRmId: 'rm1', backupRmId: 4, sponsorRmId: '' },
      { primaryRmId: 'rm1', backupRmId: 'rm1', sponsorRmId: '' },
      { primaryRmId: 'rm1', backupRmId: '', sponsorRmId: '', private_key: DB_KEY },
      { primaryRmId: 'rm1', backupRmId: '', sponsorRmId: '', updatedAtByRole: [] },
      { primaryRmId: 'rm1', backupRmId: '', sponsorRmId: '', updatedAtByRole: { unknown: 'date' } },
      { primaryRmId: 'rm1', backupRmId: '', sponsorRmId: '', updatedAtByRole: { primary: 3 } },
    ].map(record => rawState({ assignments: { account1: record } })),
  ];
  for (const raw of invalid) {
    const handler = teams.createHandler({ rpc: async () => raw });
    for (const options of [{}, { method: 'POST', body: commit() }]) {
      const res = await invoke(handler, options);
      assert.equal(res.statusCode, 503);
      assertPrivate(res);
      assert.doesNotMatch(res.body, /DB_RESPONSE_INVALID|private_key|assignments|status/);
    }
  }
});

test('history validation accepts baseline, save, restore, removal and SQL audit-name fields', () => {
  const versions = [
    rawVersion({ revision: 3, parent_revision: 2, action: 'restore', restored_from_revision: 1,
      changes: [{ account_id: 'account1', role: 'backup', before_rm_id: 'rm2', after_rm_id: null, before_rm_name: 'Historic RM', after_rm_name: null }] }),
    rawVersion({ revision: 2, parent_revision: 1, note: '🙂'.repeat(500) }),
    rawVersion({ revision: 1, parent_revision: null, action: 'baseline', changes: [] }),
  ];
  const view = db.historyView(rawHistory({ versions }));
  assert.equal(view.versions.length, 3);
  assert.equal(view.versions[0].restoredFromRevision, 1);
  assert.equal(view.versions[0].changes[0].afterRmId, null);
  assert.equal(view.versions[2].parentRevision, null);
  assert.equal(view.versions[2].action, 'baseline');
  assert.deepEqual(view.versions[2].changes, []);
  assert.equal(view.nextBeforeRevision, null);
});

test('malformed history versions, ordering, changes and cursor fail closed with sanitized responses', async () => {
  const change = rawVersion().changes[0];
  const invalid = [null, [], {},
    rawHistory({ dataset_id: 'another-dataset' }), rawHistory({ dataset_id: undefined }),
    ...[undefined, null, {}, 'private=' + DB_KEY].map(versions => rawHistory({ versions })),
    rawHistory({ next_before_revision: 7 }), rawHistory({ next_before_revision: undefined }),
    rawHistory({ versions: [rawVersion()], next_before_revision: 6 }),
    rawHistory({ versions: [rawVersion(), rawVersion()] }),
    rawHistory({ versions: [rawVersion({ revision: 6, parent_revision: 5 }), rawVersion()] }),
    ...[null, [], {},
      rawVersion({ revision: 0 }), rawVersion({ revision: '7' }), rawVersion({ parent_revision: 5 }),
      rawVersion({ action: 'delete' }), rawVersion({ action: 'baseline' }),
      rawVersion({ revision: 1, parent_revision: null }),
      rawVersion({ action: 'restore', restored_from_revision: null }),
      rawVersion({ action: 'restore', restored_from_revision: 7 }),
      rawVersion({ restored_from_revision: 3 }), rawVersion({ actor_email: 'foreign@example.com' }),
      rawVersion({ created_at: 'invalid-date' }), rawVersion({ note: SECRET.repeat(20) }),
      rawVersion({ changes: undefined }), rawVersion({ changes: {} }),
      ...[null, [], {}, { ...change, role: 'primaryRmId' }, { ...change, account_id: '' },
        { ...change, after_rm_id: '' }, { ...change, before_rm_id: 'rm1' }, { ...change, after_rm_id: { secret: DB_KEY } },
      ].map(c => rawVersion({ changes: [c] })),
      rawVersion({ changes: [change, change] }),
    ].map(v => rawHistory({ versions: [v] })),
  ];
  for (const raw of invalid) {
    const res = await invoke(history.createHandler({ rpc: async () => raw }), { url: '/api/history' });
    assert.equal(res.statusCode, 503);
    assertPrivate(res);
    assert.doesNotMatch(res.body, /DB_RESPONSE_INVALID|restored_from_revision|private_key|changes/);
  }
});

test('public assets contain neither DB secret settings nor a Supabase privileged key', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  for (const filename of fs.readdirSync(publicDir, { recursive: true })) {
    const absolute = path.join(publicDir, filename);
    if (!fs.statSync(absolute).isFile()) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    assert.doesNotMatch(text, /ONE_ACCOUNT_SUPABASE_SECRET_KEY|sb_secret_/, filename);
  }
});
