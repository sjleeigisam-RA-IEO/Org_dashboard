'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const crm = require('../lib/crm-db.cjs');
const identity = require('../lib/crm-identity.cjs');
const { createHandler } = require('../api/crm.js');
let saved, key;
before(() => {
  saved = { code: process.env.ONE_ACCOUNT_CODE_SCRYPT, secret: process.env.ONE_ACCOUNT_SESSION_SECRET };
  const salt = crypto.randomBytes(16), code = crypto.randomBytes(32).toString('hex');
  process.env.ONE_ACCOUNT_CODE_SCRYPT = `scrypt:${salt.toString('hex')}:${crypto.scryptSync(code, salt, 32).toString('hex')}`;
  process.env.ONE_ACCOUNT_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  key = auth.config().key;
});
after(() => { for (const [name, value] of [['ONE_ACCOUNT_CODE_SCRYPT', saved.code], ['ONE_ACCOUNT_SESSION_SECRET', saved.secret]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
const valid = () => ({ action: 'update', entity: 'affiliation', id: 'synthetic-aff', expectedRevision: 1, patch: { title: 'Synthetic Manager' }, requestId: crypto.randomUUID() });
async function invoke(options = {}, rpc) {
  const req = Readable.from([]); req.method = options.method || 'GET'; req.url = options.url || '/api/crm?action=catalog';
  req.headers = { host: 'crm.example', origin: 'https://crm.example', 'content-type': 'application/json', ...(options.authenticated === false ? {} : { cookie: `${auth.COOKIE}=${auth.makeSession('reviewer@igisam.com', false, key).token}` }), ...options.headers };
  if (options.body !== undefined) req.body = options.body;
  const res = { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, writeHead(s, h = {}) { this.statusCode = s; for (const [n, v] of Object.entries(h)) this.setHeader(n, v); }, end(v = '') { this.body = v; } };
  await createHandler({ rpc })(req, res); return res;
}
test('every CRM request is session gated and non-cacheable', async () => {
  for (const method of ['GET', 'POST']) {
    const r = await invoke({ method, authenticated: false }, () => { throw new Error('must not call'); });
    assert.equal(r.statusCode, 401); assert.match(r.headers['cache-control'], /no-store/); assert.equal(r.headers['vercel-cdn-cache-control'], 'no-store');
  }
});
test('only same origin may edit and client cannot set actor or provenance', async () => {
  const r = await invoke({ method: 'POST', body: valid(), headers: { origin: 'https://other.example' } }, () => { throw new Error('must not call'); }); assert.equal(r.statusCode, 403);
  for (const patch of [{ ...valid(), actorEmail: 'other@igisam.com' }, { ...valid(), patch: { source_record_id: 'fake' } }, { ...valid(), patch: { person_id: 'fake' } }]) assert.throws(() => crm.commitBody(patch), /BAD_BODY/);
});
test('shared-code sessions cannot mutate CRM or receive private conflict/replay records', async () => {
  const r = await invoke({ method: 'POST', body: valid() }, () => { throw new Error('locked requests must not call RPC'); });
  assert.equal(r.statusCode, 403);
  assert.equal(JSON.parse(r.body).code, 'CRM_IDENTITY_VERIFICATION_REQUIRED');
  assert.deepEqual(JSON.parse(r.body).privacy, { detailAccess: 'locked', identityVerified: false, canEdit: false });
});
test('bad dates, zero revisions, unsupported states and oversized strings rejected', () => {
  for (const v of [{ ...valid(), expectedRevision: 0 }, { ...valid(), patch: { ended_on: '2026-02-30' } }, { ...valid(), patch: { employment_status: 'employed' } }, { ...valid(), patch: { notes: 'x'.repeat(10001) } }, { ...valid(), entity: 'gift_recipient', patch: { actual_amount: -1 } }]) assert.throws(() => crm.commitBody(v), /BAD_BODY/);
  assert.doesNotThrow(() => crm.commitBody({ ...valid(), entity: 'gift_recipient', patch: { actual_amount: null } }));
});
test('new event requires person identity and revision zero', () => {
  const create = { ...valid(), action: 'create', entity: 'life_event', expectedRevision: 0, patch: { person_id: 'synthetic-person', event_type: 'birthday', event_date: '2026-09-14', recurring: true, calendar: 'lunar' } };
  assert.doesNotThrow(() => crm.commitBody(create)); assert.throws(() => crm.commitBody({ ...create, expectedRevision: 1 }), /BAD_BODY/);
  assert.throws(() => crm.commitBody({ ...create, patch: { event_type: 'birthday' } }), /BAD_BODY/);
});
test('bounded literal search and invalid identities are validated', () => {
  assert.deepEqual(crm.readQuery('/api/crm?action=search&q=Synthetic&limit=20'), { p_action: 'search', p_id: null, p_query: 'Synthetic', p_limit: 20 });
  for (const url of ['/api/crm?action=import', '/api/crm?action=account', '/api/crm?action=search&q=x&limit=201', '/api/crm?action=search&q=']) assert.throws(() => crm.readQuery(url), /BAD_BODY/);
});
test('source values and DB error details are not echoed as diagnostics', async () => {
  const r = await invoke({}, async () => { const e = new Error('synthetic@example.invalid secret'); e.dbCode = 'XX000'; throw e; });
  assert.equal(r.statusCode, 503); assert.ok(!r.body.includes('synthetic@example.invalid')); assert.ok(!r.body.includes('secret'));
});

function verifiedHeaders() {
  const session = auth.makeSession('reviewer@igisam.com', true, key);
  const token = crypto.randomBytes(32).toString('base64url');
  return { headers: { cookie: `${auth.COOKIE}=${session.token}; ${identity.COOKIE}=${token}` }, token, expires: new Date(Date.now() + 3600000).toISOString() };
}
function proofState(h) { return { status: 'verified', email: 'reviewer@igisam.com', auth_method: 'email_otp', expires_at: h.expires }; }
const rawPerson = () => ({ status: 'ok', person: { person_id: 'synthetic-person', name: 'Synthetic', revision: 1 }, affiliations: [], contact_points: [{ value: 'synthetic-private-contact', kind: 'mobile' }], receiving_preferences: [], gift_recipients: [], life_events: [], field_claims: [], source_records: [], audit: [], campaigns: [], items: [] });
test('verified personal detail uses audited RPC; session and proof must agree', async () => {
  const h = verifiedHeaders(), calls = [];
  const r = await invoke({ url: '/api/crm?action=person&personId=synthetic-person', headers: h.headers }, async (name, args) => {
    calls.push({ name, args });
    return name === 'oa_crm_identity' ? proofState(h) : rawPerson();
  });
  assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).privacy.canEdit, true);
  assert.ok(r.body.includes('synthetic-private-contact'));
  assert.deepEqual(calls.map(x => x.name), ['oa_crm_identity', 'oa_crm_verified_read']);
  assert.equal(calls[1].args.p_proof_digest, identity.proofDigest(h.token));
  assert.match(calls[1].args.p_session_binding, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(calls).includes(h.token));
  const mismatch = await invoke({ url: '/api/crm?action=person&personId=synthetic-person', headers: h.headers }, async name => name === 'oa_crm_identity' ? { ...proofState(h), email: 'someone-else@igisam.com' } : rawPerson());
  assert.equal(JSON.parse(mismatch.body).privacy.identityVerified, false);
  assert.ok(!mismatch.body.includes('synthetic-private-contact'));
});
test('verified browsing never expands list or search disclosure', async () => {
  const h = verifiedHeaders();
  for (const url of ['/api/crm?action=account&accountId=synthetic-account', '/api/crm?action=search&q=synthetic']) {
    const r = await invoke({ url, headers: h.headers }, async name => {
      assert.equal(name, 'oa_crm_read');
      return { status: 'ok', account: { account_id: 'synthetic-account', name: 'Synthetic' }, people: [{ person_id: 'synthetic-person', contact_points: [{ value: 'synthetic-private-contact' }] }], truncated: false };
    });
    assert.equal(r.statusCode, 200); assert.ok(!r.body.includes('synthetic-private-contact'));
  }
});
test('verified writes derive actor in DB and preserve conflict, replay and safe retry IDs', async () => {
  const h = verifiedHeaders(), body = valid();
  for (const status of ['committed', 'noop', 'replayed', 'conflict']) {
    let mutation;
    const r = await invoke({ method: 'POST', headers: h.headers, body }, async (name, args) => {
      if (name === 'oa_crm_identity') return proofState(h);
      assert.equal(name, 'oa_crm_verified_commit'); mutation = args;
      return { status, record: { revision: 2, title: 'Synthetic Manager' }, revision: 2 };
    });
    assert.equal(r.statusCode, status === 'conflict' ? 409 : 200);
    assert.equal(mutation.p_request_id, body.requestId); assert.equal(mutation.p_expected_revision, 1);
    assert.ok(!Object.keys(mutation).some(k => /actor|email/.test(k)));
  }
});
test('expired, revoked or malformed proof cannot reach mutation or expose conflict data', async () => {
  for (const state of [{ status: 'unverified' }, { status: 'verified', email: 'reviewer@igisam.com', auth_method: 'email_otp', expires_at: new Date(Date.now() - 1000).toISOString() }]) {
    const h = verifiedHeaders();
    const r = await invoke({ method: 'POST', body: valid(), headers: h.headers }, async name => { assert.equal(name, 'oa_crm_identity'); return state; });
    assert.equal(r.statusCode, 403); assert.equal(JSON.parse(r.body).code, 'CRM_IDENTITY_VERIFICATION_REQUIRED');
  }
  const h = verifiedHeaders();
  const revoked = await invoke({ method: 'POST', body: valid(), headers: h.headers }, async name => {
    if (name === 'oa_crm_identity') return proofState(h);
    const e = new Error('private conflict data'); e.dbCode = '42501'; throw e;
  });
  assert.equal(revoked.statusCode, 403); assert.ok(!revoked.body.includes('private conflict data'));
});
test('authenticated edits still reject spoofed actors, unknown fields, CSRF and invalid revisions', async () => {
  const h = verifiedHeaders();
  for (const body of [{ ...valid(), actorEmail: 'forged@igisam.com' }, { ...valid(), expectedRevision: 0 }, { ...valid(), patch: { proof_digest: 'forged' } }]) {
    const r = await invoke({ method: 'POST', headers: h.headers, body }, async name => { assert.equal(name, 'oa_crm_identity'); return proofState(h); });
    assert.equal(r.statusCode, 400);
  }
  const csrf = await invoke({ method: 'POST', headers: { ...h.headers, origin: undefined }, body: valid() }, () => { throw new Error('No calls'); });
  assert.equal(csrf.statusCode, 403);
});
test('CRM notes accept the supported Korean text length while request bytes stay bounded', async () => {
  const h = verifiedHeaders(), body = { ...valid(), entity: 'person', patch: { notes: '검'.repeat(10000) } };
  const r = await invoke({ method: 'POST', headers: h.headers, body }, async (name, args) => name === 'oa_crm_identity' ? proofState(h) : { status: 'committed', record: { ...args.p_patch, revision: 2 }, revision: 2 });
  assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).record.notes.length, 10000);
  const oversized = await invoke({ method: 'POST', headers: { ...h.headers, 'content-length': '65537' }, body }, async name => { assert.equal(name, 'oa_crm_identity'); return proofState(h); });
  assert.equal(oversized.statusCode, 400);
});
