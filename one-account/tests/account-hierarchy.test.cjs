'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hierarchyIndex,visibleAccounts,sourceAccounts}=require('../public/account-hierarchy.js');
const fixture=()=>[
 {account_id:'G',account_kind:'group',piscfh:'I'},
 {account_id:'A',account_kind:'organization',parent_account_id:'G',piscfh:'P',assigned:true},
 {account_id:'B',account_kind:'organization',parent_account_id:'G',piscfh:'I'},
 {account_id:'C',account_kind:'organization',piscfh:'C'},
];
const ids=rows=>rows.map(r=>r.account_id),assigned=a=>Boolean(a.assigned);
test('one parent replaces its children in the Account index without changing source classification',()=>{
 const rows=fixture(),before=structuredClone(rows);
 assert.deepEqual(ids(visibleAccounts(rows,assigned)),['G','C']);
 assert.deepEqual(ids(hierarchyIndex(rows).children.get('G')),['A','B']);
 assert.deepEqual(rows,before);
});
test('RM scope finds a parent through its assigned child while source exposures remain at the child',()=>{
 const rows=fixture();assert.deepEqual(ids(visibleAccounts(rows,assigned,'rm')),['G']);
 assert.deepEqual(ids(sourceAccounts(rows,assigned,'rm')),['A']);
 assert.deepEqual(ids(visibleAccounts(rows,assigned,'rm','rm')),['A']);
 assert.deepEqual(ids(visibleAccounts(rows,assigned,'all','rm')),['A','B','C']);
 rows[0].assigned=true;
 assert.deepEqual(ids(sourceAccounts(rows,assigned,'rm')),['A','B']);
});
test('unresolved parent metadata never makes an organization disappear',()=>{
 const rows=fixture();rows.push({account_id:'X',parent_account_id:'MISSING',account_kind:'organization'});
 assert.deepEqual(ids(visibleAccounts(rows,assigned)),['G','C','X']);
 assert.deepEqual(ids(sourceAccounts(rows,assigned)),['A','B','C','X']);
});
