'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const identity = require('../lib/crm-identity.cjs');
const account = require('../lib/account-db.cjs');
const { createHandler } = require('../api/account.js');
let saved, key;
before(() => {
  saved = { code: process.env.ONE_ACCOUNT_CODE_SCRYPT, secret: process.env.ONE_ACCOUNT_SESSION_SECRET };
  const salt = crypto.randomBytes(16), code = crypto.randomBytes(32).toString('hex');
  process.env.ONE_ACCOUNT_CODE_SCRYPT = `scrypt:${salt.toString('hex')}:${crypto.scryptSync(code, salt, 32).toString('hex')}`;
  process.env.ONE_ACCOUNT_SESSION_SECRET = crypto.randomBytes(48).toString('hex'); key = auth.config().key;
});
after(() => { for (const [k, v] of [['ONE_ACCOUNT_CODE_SCRYPT', saved.code], ['ONE_ACCOUNT_SESSION_SECRET', saved.secret]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
const team = (status = 'ok') => ({ status, accountId: 'synthetic-a', accountRevision: 2, currentRevision: 5, team: { primaryRmId: 'synthetic-rm', backupRmId: '', sponsorRmId: '', updatedAtByRole: { primary: '2026-09-15T01:00:00Z' } }, candidates: [{ rmId: 'synthetic-rm', name: 'Synthetic', roles: ['primary'] }], history: [] });
const metadata = (status = 'ok', verified = false) => ({ status, account: { accountId: 'synthetic-a', name: 'Synthetic account', piscfh: 'C', notes: 'synthetic private note', profileRevision: 1, revision: 2, aliases: ['Old synthetic'], isExisting: true, isPlaceholder: false, accountKind: 'organization' }, history: [{ auditId: 1, revision: 2, entityType: 'account', entityId: 'synthetic-a', createdAt: '2026-09-15T01:00:00Z', actorEmail: 'reviewer@igisam.com', action: 'update', changedFields: ['name'], before_record: { secret: 'private-before-value' }, after_record: { secret: 'private-after-value' } }], privacy: { detailAccess: verified ? 'verified' : 'locked', identityVerified: verified, canEdit: verified } });
const save = () => ({ action: 'save-team', accountId: 'synthetic-a', expectedRevision: 2, patch: { backupRmId: '' }, requestId: crypto.randomUUID() });
const edit = () => ({ action: 'update-account', accountId: 'synthetic-a', expectedRevision: 2, patch: { name: 'Renamed' }, requestId: crypto.randomUUID() });
function verifiedHeaders() {
  const session = auth.makeSession('reviewer@igisam.com', true, key), token = crypto.randomBytes(32).toString('base64url');
  return { cookie: `${auth.COOKIE}=${session.token}; ${identity.COOKIE}=${token}` };
}
function proofState() { return { status: 'verified', email: 'reviewer@igisam.com', auth_method: 'email_otp', expires_at: new Date(Date.now() + 3600000).toISOString() }; }
async function invoke(options = {}, rpc = async () => team()) {
  const req = Readable.from([]); req.method = options.method || 'GET'; req.url = options.url || '/api/account?action=team&accountId=synthetic-a';
  req.headers = { host: 'account.example', origin: 'https://account.example', 'content-type': 'application/json', ...(options.authenticated === false ? {} : { cookie: `${auth.COOKIE}=${auth.makeSession('reviewer@igisam.com', false, key).token}` }), ...options.headers };
  if (options.body !== undefined) req.body = options.body;
  const res = { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, writeHead(s, h = {}) { this.statusCode = s; for (const [n, v] of Object.entries(h)) this.setHeader(n, v); }, end(v = '') { this.body = v; } };
  await createHandler({ rpc })(req, res); return res;
}
test('account endpoints require session and disable all caches', async () => {
  for (const method of ['GET', 'POST']) {
    const r = await invoke({ method, authenticated: false }, () => { throw new Error('must not call'); });
    assert.equal(r.statusCode, 401); assert.match(r.headers['cache-control'], /no-store/); assert.equal(r.headers['vercel-cdn-cache-control'], 'no-store');
  }
});
test('account read requires one known action and stable account id', () => {
  assert.equal(account.readQuery('/api/account?action=team&accountId=synthetic-a').p_dataset_id, 'rm-v1.7');
  for (const url of ['/api/account?action=team', '/api/account?action=people&accountId=a', '/api/account?action=team&accountId=a&actorEmail=forged', '/api/account?action=team&accountId=a&accountId=b']) assert.throws(() => account.readQuery(url), /BAD_BODY/);
});
test('team changes send only account patch and signed-session actor', async () => {
  const body = save(); let received;
  const r = await invoke({ method: 'POST', body }, async (name, args) => { assert.equal(name, 'oa_account_save_team'); received = args; return team('committed'); });
  assert.equal(r.statusCode, 200); assert.deepEqual(received.p_patch, { backupRmId: '' }); assert.equal(received.p_actor_email, 'reviewer@igisam.com'); assert.equal(received.p_expected_revision, 2); assert.equal(received.p_request_id, body.requestId);
  assert.equal(JSON.parse(r.body).currentRevision, 5);
});
test('team conflicts and retry result retain account revision and normalized empty roles', async () => {
  for (const status of ['conflict', 'noop', 'replayed']) {
    const raw = { ...team(status), ...(status === 'replayed' ? { originalStatus: 'committed' } : {}) };
    const r = await invoke({ method: 'POST', body: save() }, async () => raw);
    assert.equal(r.statusCode, status === 'conflict' ? 409 : 200); assert.equal(JSON.parse(r.body).accountRevision, 2); assert.equal(JSON.parse(r.body).team.backupRmId, '');
  }
});
test('all writes reject missing or foreign origin before contacting DB', async () => {
  for (const origin of [undefined, 'https://other.example']) {
    const r = await invoke({ method: 'POST', headers: { origin }, body: save() }, () => { throw new Error('must not call'); }); assert.equal(r.statusCode, 403);
  }
});
test('strict command inputs reject forged actors, unknown fields, timestamps and stale shape', () => {
  for (const b of [{ ...save(), actorEmail: 'forged@igisam.com' }, { ...save(), patch: { updatedAtByRole: {} } }, { ...save(), patch: { backupRmId: null } }, { ...save(), expectedRevision: 0 }, { ...edit(), patch: { aliases: [] } }, { ...edit(), patch: { is_existing: false } }, { ...edit(), patch: { piscfh: 'made-up' } }, { ...edit(), patch: { name: ' ' } }, { ...edit(), patch: { notes: 'x'.repeat(10001) } }]) assert.throws(() => account.commitBody(b), /BAD_BODY/);
  assert.doesNotThrow(() => account.commitBody({ ...edit(), patch: { notes: '검'.repeat(10000) } }));
});
test('shared-code login cannot edit metadata or create a person', async () => {
  for (const body of [edit(), { action: 'create-person', accountId: 'synthetic-a', patch: { name: 'Synthetic' }, requestId: crypto.randomUUID() }]) {
    const r = await invoke({ method: 'POST', body }, () => { throw new Error('must not call'); }); assert.equal(r.statusCode, 403); assert.equal(JSON.parse(r.body).code, 'CRM_IDENTITY_VERIFICATION_REQUIRED');
  }
});
test('unverified metadata notes and all before/after records remain private', async () => {
  const r = await invoke({ url: '/api/account?action=metadata&accountId=synthetic-a' }, async name => { assert.equal(name, 'oa_account_read'); return metadata(); });
  assert.equal(r.statusCode, 200); const value = JSON.parse(r.body); assert.equal(value.account.notes, ''); assert.equal(value.account.notesMasked, '*');
  assert.ok(!/private-before|private-after|synthetic private/.test(r.body)); assert.equal(value.account.profileRevision, 1);
});
test('verified metadata read revalidates proof inside audited DB RPC', async () => {
  const calls = [];
  const r = await invoke({ url: '/api/account?action=metadata&accountId=synthetic-a', headers: verifiedHeaders() }, async (name, args) => { calls.push({ name, args }); return name === 'oa_crm_identity' ? proofState() : metadata('ok', true); });
  assert.equal(r.statusCode, 200); assert.deepEqual(calls.map(c => c.name), ['oa_crm_identity', 'oa_account_verified_read']); assert.match(calls[1].args.p_proof_digest, /^[a-f0-9]{64}$/); assert.equal(JSON.parse(r.body).account.notes, 'synthetic private note'); assert.ok(!r.body.includes('private-before'));
});
test('verified updates derive actor from proof and return conflict safely', async () => {
  for (const status of ['committed', 'noop', 'replayed', 'conflict']) {
    let mutation;
    const r = await invoke({ method: 'POST', headers: verifiedHeaders(), body: edit() }, async (name, args) => { if (name === 'oa_crm_identity') return proofState(); assert.equal(name, 'oa_account_verified_commit'); mutation = args; return { ...metadata(status, true), ...(status === 'replayed' ? { originalStatus: 'committed' } : {}) }; });
    assert.equal(r.statusCode, status === 'conflict' ? 409 : 200); assert.ok(!Object.keys(mutation).some(k => /actor|email/.test(k))); assert.equal(mutation.p_action, 'update-account');
  }
});
test('person creation has one atomic RPC and server-owned identities', async () => {
  const requestId = crypto.randomUUID(), body = { action: 'create-person', accountId: 'synthetic-a', patch: { name: 'Synthetic' }, requestId };
  for (const invalid of [{ ...body, personId: 'fake' }, { ...body, expectedRevision: 0 }, { ...body, patch: { name: 'Synthetic', employment_status: 'current' } }]) assert.throws(() => account.commitBody(invalid), /BAD_BODY/);
  let writes = 0;
  const r = await invoke({ method: 'POST', headers: verifiedHeaders(), body }, async (name, args) => {
    if (name === 'oa_crm_identity') return proofState(); writes++; assert.equal(name, 'oa_account_verified_commit'); assert.equal(args.p_expected_revision, 0);
    return { status: 'committed', accountId: body.accountId, personId: `PERSON-${requestId}`, affiliationId: `AFF-${requestId}`, person: { person_id: `PERSON-${requestId}`, name: 'Synthetic' }, affiliation: { affiliation_id: `AFF-${requestId}`, person_id: `PERSON-${requestId}`, account_id: body.accountId } };
  });
  assert.equal(r.statusCode, 200); assert.equal(writes, 1); assert.equal(JSON.parse(r.body).personId, `PERSON-${requestId}`);
});
test('proof expiry/revocation and DB diagnostics never expose private result', async () => {
  const r = await invoke({ method: 'POST', body: edit(), headers: verifiedHeaders() }, async name => name === 'oa_crm_identity' ? { ...proofState(), expires_at: '2000-01-01T00:00:00Z' } : assert.fail('must not mutate'));
  assert.equal(r.statusCode, 403);
  for (const code of ['42501', 'XX000']) {
    const r2 = await invoke({ method: 'POST', body: edit(), headers: verifiedHeaders() }, async name => { if (name === 'oa_crm_identity') return proofState(); const error = new Error('private-value'); error.dbCode = code; throw error; });
    assert.equal(r2.statusCode, code === '42501' ? 403 : 503); assert.ok(!r2.body.includes('private-value'));
  }
});
