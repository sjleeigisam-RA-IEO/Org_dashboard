'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readView, readQuery, commitBody } = require('../lib/crm-db.cjs');

test('group and individual account responses preserve membership and original affiliations', () => {
  const group = { status: 'ok', account: { account_id: 'GROUP-SYNTHETIC', account_kind: 'group', parent_account_id: null, people_count: 1 },
    children: [{ account_id: 'union-a', account_kind: 'organization', parent_account_id: 'GROUP-SYNTHETIC' }, { account_id: 'union-b', parent_account_id: 'GROUP-SYNTHETIC' }],
    parent_account: null, people: [{ affiliation_id: 'aff-a', person_id: 'person-a', account_id: 'union-a', account_name: 'Union A' }, { affiliation_id: 'aff-b', person_id: 'person-a', account_id: 'union-b', account_name: 'Union B' }] };
  assert.equal(readView(group, 'account'), group);
  assert.equal(readView({ status: 'ok', account: group.children[0], people: group.people.slice(0, 1), children: [], parent_account: group.account }, 'account').parent_account.account_id, 'GROUP-SYNTHETIC');
  assert.deepEqual(readQuery('/api/crm?action=account&accountId=GROUP-SYNTHETIC'), { p_action: 'account', p_id: 'GROUP-SYNTHETIC', p_query: null, p_limit: 100 });
});

test('physical and top-level counts are distinct without exposing a client hierarchy mutation', () => {
  const catalog = { status: 'ok', accounts: [], totals: { accounts: 1071, top_level_accounts: 992, grouped_accounts: 79, groups: 1 } };
  assert.equal(readView(catalog, 'catalog'), catalog);
  for (const value of [-1, '992', 1.5, null]) assert.throws(() => readView({ ...catalog, totals: { ...catalog.totals, top_level_accounts: value } }, 'catalog'), /DB_RESPONSE_INVALID/);
  assert.throws(() => commitBody({ action: 'update', entity: 'account', id: 'union-a', expectedRevision: 1, patch: { parent_account_id: 'GROUP-SYNTHETIC' }, requestId: '75cc5d10-bc40-4507-bc3e-6279e7fc5a25' }), /BAD_BODY/);
  assert.throws(() => readQuery('/api/crm?action=hierarchy'), /BAD_BODY/);
});

test('hierarchy fields are validated while pre-migration account responses remain readable', () => {
  const legacy = { status: 'ok', account: { account_id: 'a' }, people: [] };
  assert.equal(readView(legacy, 'account'), legacy);
  assert.throws(() => readView({ ...legacy, children: {} }, 'account'), /DB_RESPONSE_INVALID/);
  assert.throws(() => readView({ ...legacy, parent_account: [] }, 'account'), /DB_RESPONSE_INVALID/);
});
