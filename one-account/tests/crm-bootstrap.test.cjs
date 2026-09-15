'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizedAccount, mergeCatalog, mergeExposureClassifications } = require('../public/crm-bootstrap.js');
const classificationLabels = require('../lib/classification-labels.cjs');
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

test('reviewed classification replaces both display code sets without changing identity or relationships', () => {
  const existing = { account_id:'A', display_name:'Original', piscfh:{ default_candidate_codes:['C'], active_default_codes:['C'], case_roles:['LP'], team_draft:{keep:true} }, exposures:[1], team:{primary:'RM'} };
  const accounts=[existing], map=new Map([['A',existing]]);
  const row={ account_id:'A', name:'Alias', piscfh:'I', classification_review:{rule_version:'20260914',review_required:false}, people_count:3 };
  mergeCatalog({accounts:[row]},accounts,map);
  assert.deepEqual(existing.piscfh.default_candidate_codes,['I']);
  assert.deepEqual(existing.piscfh.active_default_codes,['I']);
  assert.deepEqual(existing.piscfh.case_roles,['LP']);
  assert.deepEqual(existing.piscfh.team_draft,{keep:true});
  assert.deepEqual(existing.team,{primary:'RM'});
  assert.equal(existing.display_name,'Original');
  assert.deepEqual(existing.exposures,[1]);
  mergeCatalog({accounts:[{...row,piscfh:'미Account',classification_review:{rule_version:'20260914',review_required:true}}]},accounts,map);
  assert.deepEqual(existing.piscfh.default_candidate_codes,[]);
  assert.equal(existing.piscfh.classification.code,null);
  assert.equal(existing.piscfh.link_status,'CLASSIFICATION_REVIEW_REQUIRED');
});

test('rename touches classification labels only, leaving asset sectors and embedded source facts intact', () => {
  const html=`<script id="embedded-data">{"source":"미분류"}</script><option data-scope-base="미분류">미분류 (3)</option> PISCFH 미분류</span> code==='unclassified'?'미분류' r.piscfh_code||'미분류' e.sector||'미분류'`;
  const result=classificationLabels(html);
  assert.ok(result.includes('data-scope-base="미Account">미Account'));
  assert.ok(result.includes("code==='unclassified'?'미Account'"));
  assert.ok(result.includes("r.piscfh_code||'미Account'"));
  assert.ok(result.includes("e.sector||'미분류'"));
  assert.ok(result.includes('{"source":"미분류"}'));
});

test('exposure filters use current classification and preserve source code, financial values and lineage', () => {
  const row={account_id:'A',piscfh_code:'C',allocated_commitment:42,lineage_paths:['source-row']};
  const untouched={account_id:'B',piscfh_code:'P'};
  const account=normalizedAccount({account_id:'A',name:'A',piscfh:'I',classification_review:{rule_version:'qa',review_required:false}});
  const map=new Map([['A',account]]);
  mergeExposureClassifications([row,untouched],map);
  assert.deepEqual(row,{account_id:'A',piscfh_code:'I',source_piscfh_code:'C',allocated_commitment:42,lineage_paths:['source-row']});
  account.piscfh.classification.code=null;
  mergeExposureClassifications([row,untouched],map);
  assert.equal(row.piscfh_code,null); assert.equal(row.source_piscfh_code,'C');
  assert.deepEqual(untouched,{account_id:'B',piscfh_code:'P'});
});


test('manual account metadata updates the display name without changing source relations or IDs', () => {
 const existing={account_id:'A',display_name:'Source',aliases:[],piscfh:{},exposures:[{id:'E'}],team:{primary:'RM'}};
 const accounts=[existing],map=new Map([['A',existing]]);
 mergeCatalog({accounts:[{account_id:'A',name:'Edited',aliases:['Source'],profile_revision:1,piscfh:'P',classification_review:{rule_version:'account-workspace-v1',review_required:true}}]},accounts,map);
 assert.equal(existing.display_name,'Edited');assert.equal(existing.account_id,'A');
 assert.deepEqual(existing.exposures,[{id:'E'}]);assert.deepEqual(existing.team,{primary:'RM'});
 assert.equal(existing.crm_profile_revision,1);
});
