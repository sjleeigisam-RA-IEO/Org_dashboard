'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const auth = require('../lib/auth.cjs');
const privacy = require('../lib/crm-privacy.cjs');
const { createHandler } = require('../api/crm.js');
const { normalizedAccount } = require('../public/crm-bootstrap.js');
const SECRET = 'PRIVATE_SENTINEL_DO_NOT_DISCLOSE';
const LOCKED = { detailAccess: 'locked', identityVerified: false, canEdit: false };
const sensitive = () => ({
  notes: SECRET, raw_values: { sensitive: SECRET }, private_future_field: SECRET,
  contact_points: [{ contact_point_id: 'contact-a', kind: 'email', value: SECRET, notes: SECRET }],
  receiving_preferences: [{ availability: 'no', notes: SECRET }],
  gift_recipients: [{ item_id: SECRET, item_name: SECRET, send_target: 'yes', actual_amount: 100000, notes: SECRET }],
  life_events: [{ description: SECRET, event_date: '2026-01-01' }],
  field_claims: [{ value: SECRET }], source_records: [{ raw_values: { value: SECRET } }],
  audit: [{ actor_email: SECRET, before_record: { notes: SECRET }, after_record: { notes: SECRET } }],
});
const org = () => ({
  account_id: 'ACCOUNT-A', name: 'Synthetic Institution', piscfh: 'I', account_kind: 'organization',
  parent_account_id: 'GROUP-A', contact_account_id: null, people_count: 1, children_count: 0, revision: 2,
  aliases: ['Synthetic Alias', { name: 'Second Alias', notes: SECRET, raw_values: { secret: SECRET } }],
  classification_review: { rule_version: 'synthetic-review', review_required: false, reason: SECRET, source_urls: [SECRET], actor_email: SECRET },
  hierarchy_note: SECRET, ...sensitive(),
});
const personRow = () => ({
  person_id: 'person-a', name: 'Synthetic Person', affiliation_id: 'aff-a', account_id: 'ACCOUNT-A',
  account_name: 'Synthetic Institution', department: 'Synthetic Team', title: 'Manager', rank: 'Senior', revision: 3,
  started_on: '2025-01-01', ended_on: '2026-01-01', ...sensitive(),
});
const raw = action => {
  const base = { status: 'ok', ...sensitive(), privacy: { detailAccess: 'open', identityVerified: true, canEdit: true } };
  if (action === 'catalog') return { ...base, accounts: [org()], totals: { accounts: 1, persons: 1, notes: SECRET }, campaigns: [{ name: SECRET }], items: [{ name: SECRET, unit_price: 100000 }] };
  if (action === 'account') return { ...base, account: org(), people: [personRow()], children: [org()], parent_account: org() };
  if (action === 'search') return { ...base, people: [personRow()], truncated: true };
  return { ...base, person: { person_id: 'person-a', name: 'Synthetic Person', revision: 1, ...sensitive() }, affiliations: [personRow()] };
};

test('all read actions use fresh field allowlists and erase sensitive nested data', () => {
  for (const action of ['catalog', 'account', 'search', 'person']) {
    const input = raw(action), original = structuredClone(input), output = privacy.projectRead(input, action);
    assert.deepEqual(input, original, 'projection must preserve source data');
    assert.deepEqual(output.privacy, LOCKED);
    assert.ok(!JSON.stringify(output).includes(SECRET));
    assert.ok(!Object.hasOwn(output, 'notes'));
    if (action === 'catalog') {
      assert.deepEqual(output.campaigns, []); assert.deepEqual(output.items, []);
      assert.equal(output.accounts[0].parent_account_id, 'GROUP-A');
      const normalized = normalizedAccount(output.accounts[0]);
      assert.deepEqual(normalized.piscfh.active_default_codes, ['I']);
      assert.equal(normalized.crm_classification_review.rule_version, 'synthetic-review');
    } else if (action === 'person') {
      assert.equal(output.contact_count, 1);
      assert.equal(output.person.name, 'Synthetic Person');
      assert.equal(output.affiliations[0].account_id, 'ACCOUNT-A');
      assert.ok(!Object.hasOwn(output.affiliations[0], 'started_on'));
    } else {
      assert.equal(output.people[0].contact_count, 1);
      assert.equal(output.people[0].rank, 'Senior');
      assert.deepEqual(output.people[0].contact_points, []);
      assert.deepEqual(output.people[0].gift_recipients, []);
      if (action === 'search') assert.equal(output.truncated, true);
    }
  }
});

test('nested payloads under permitted scalar fields and unexpected actions fail closed', () => {
  const input = raw('person');
  input.person.name = { secret: SECRET };
  input.affiliations[0].title = { secret: SECRET };
  input.person.revision = { secret: SECRET };
  const output = privacy.projectRead(input, 'person');
  assert.ok(!JSON.stringify(output).includes(SECRET));
  assert.ok(!Object.hasOwn(output.person, 'name'));
  assert.throws(() => privacy.projectRead(input, 'raw'), /CRM_PRIVACY_ACTION_INVALID/);
});

let saved, key;
before(() => {
  saved = { code: process.env.ONE_ACCOUNT_CODE_SCRYPT, secret: process.env.ONE_ACCOUNT_SESSION_SECRET };
  const salt = crypto.randomBytes(16), code = crypto.randomBytes(32).toString('hex');
  process.env.ONE_ACCOUNT_CODE_SCRYPT = `scrypt:${salt.toString('hex')}:${crypto.scryptSync(code, salt, 32).toString('hex')}`;
  process.env.ONE_ACCOUNT_SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  key = auth.config().key;
});
after(() => {
  for (const [name, value] of [['ONE_ACCOUNT_CODE_SCRYPT', saved.code], ['ONE_ACCOUNT_SESSION_SECRET', saved.secret]]) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
async function invoke({ action = 'person', query = '', method = 'GET', body, email = 'reviewer@igisam.com', headers = {} } = {}, rpc) {
  const req = Readable.from([]);
  req.method = method; req.url = `/api/crm?action=${action}&personId=person-a&accountId=ACCOUNT-A&q=Synthetic${query}`;
  req.headers = { host: 'crm.example', origin: 'https://crm.example', 'content-type': 'application/json',
    cookie: `${auth.COOKIE}=${auth.makeSession(email, false, key).token}`, ...headers };
  if (body !== undefined) req.body = body;
  const res = { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n.toLowerCase()] = v; },
    writeHead(status, h = {}) { this.statusCode = status; for (const [n, v] of Object.entries(h)) this.setHeader(n, v); }, end(v = '') { this.body = v; } };
  await createHandler({ rpc })(req, res);
  return res;
}

test('actual GET handler cannot unlock any read action through flags, headers, or an owner email', async () => {
  for (const action of ['catalog', 'account', 'search', 'person']) {
    for (const email of ['reviewer@igisam.com', 'sjlee@igisam.com']) {
      const response = await invoke({ action, email,
        query: '&detailAccess=all&identityVerified=true&admin=true&include=contact_points,notes,source_records&privacy=off',
        headers: { 'x-crm-admin': 'true', 'x-identity-verified': 'true', 'x-user-email': 'sjlee@igisam.com' } },
      async (name, args) => { assert.equal(name, 'oa_crm_read'); assert.equal(args.p_action, action); return raw(action); });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body).privacy, LOCKED);
      assert.ok(!response.body.includes(SECRET));
      assert.match(response.headers['cache-control'], /no-store/);
      assert.equal(response.headers['vercel-cdn-cache-control'], 'no-store');
    }
  }
});

test('all CRM entities and create/update/replay attempts are denied before any RPC or private record readback', async () => {
  for (const entity of ['person', 'affiliation', 'contact_point', 'preference', 'gift_recipient', 'life_event']) {
    for (const action of ['create', 'update']) {
      const response = await invoke({ method: 'POST', email: 'sjlee@igisam.com',
        body: { action, entity, id: 'synthetic-id', expectedRevision: action === 'create' ? 0 : 1,
          patch: { identity_status: 'verified', notes: SECRET }, requestId: crypto.randomUUID(), identityVerified: true } },
      () => { assert.fail('locked mutations must not call RPC'); });
      assert.equal(response.statusCode, 403);
      assert.equal(JSON.parse(response.body).code, 'CRM_IDENTITY_VERIFICATION_REQUIRED');
      assert.deepEqual(JSON.parse(response.body).privacy, LOCKED);
      assert.ok(!response.body.includes(SECRET));
      assert.ok(!Object.hasOwn(JSON.parse(response.body), 'record'));
    }
  }
});
