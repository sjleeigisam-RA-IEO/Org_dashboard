'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedAccount, mergeCatalog } = require('../public/crm-bootstrap.js');
test('registers contact-only institutions without inventing business exposures', () => {
  const account = normalizedAccount({ account_id: 'ACCT-NEW-1', name: 'Example institution', piscfh: '비Account', people_count: 2 });
  assert.deepEqual(account.piscfh.default_candidate_codes, []);
  assert.equal(account.investor_amount, null);
  assert.equal(account.lender_amount, null);
  assert.equal(account.metrics.role_count, 0);
  assert.equal(account.crm_people_count, 2);
});
test('keeps existing IDs, RM metadata and financial graph intact on refresh', () => {
  const existing = { account_id: 'ACCT-OLD', display_name: 'Original', piscfh: { active_default_codes: ['I'] }, lender_amount: 123, team: { primary: 'RM-A' } };
  const accounts = [existing], map = new Map([['ACCT-OLD',existing]]);
  const catalog = { accounts: [{ account_id: 'ACCT-OLD', name: 'Alias', piscfh: 'C', people_count: 4 }, { account_id: 'ACCT-NEW', name: 'New', piscfh: 'S', people_count: 1 }] };
  assert.equal(mergeCatalog(catalog,accounts,map),1);
  assert.equal(mergeCatalog(catalog,accounts,map),0);
  assert.equal(accounts.length,2);
  assert.equal(map.get('ACCT-OLD'),existing);
  assert.equal(existing.display_name,'Original');
  assert.equal(existing.lender_amount,123);
  assert.deepEqual(existing.team,{ primary:'RM-A' });
  assert.deepEqual(existing.piscfh,{ active_default_codes:['I'] });
  assert.equal(existing.crm_people_count,4);
});
test('rejects invalid or duplicate identifiers before mutating the dashboard', () => {
  const accounts=[], map=new Map();
  assert.throws(() => mergeCatalog({accounts:[{account_id:'A',name:'Good'},{account_id:'x\" onclick=',name:'Bad'}]},accounts,map));
  assert.equal(accounts.length,0);
  assert.throws(() => mergeCatalog({accounts:[{account_id:'A',name:'One'},{account_id:'A',name:'Two'}]},accounts,map));
  assert.equal(accounts.length,0);
});
