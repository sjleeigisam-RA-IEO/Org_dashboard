'use strict';
// Read-only integration QA against the original dashboard and private import bundle.
// No production calls or writes. Output contains only aggregate counts and temp paths.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const classificationLabels = require('../lib/classification-labels.cjs');
const workspace = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(workspace, '10. One Account/ONE_ACCOUNT_MAP_v1_7_RM_XLSX_260910.html'), 'utf8');
const payload = JSON.parse(fs.readFileSync(path.join(workspace, '10. One Account/data/private_untracked/crm_import_20260914/payload.json'), 'utf8'));
if (process.env.CRM_QA_CLASSIFICATION) {
  const decisions = new Map(JSON.parse(fs.readFileSync(process.env.CRM_QA_CLASSIFICATION,'utf8')).map(row=>[row.account_id,row]));
  for (const account of payload.accounts) {
    const decision=decisions.get(account.account_id);
    if (decision) { account.piscfh=decision.to_code; account.classification_review={...decision,rule_version:'qa-classification'}; }
  }
}
const original = JSON.parse(source.match(/<script id="embedded-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const assignments = JSON.parse(source.match(/<script id="sharedTeamState" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const map = (rows, key) => new Map(rows.map(row => [row[key], row]));
const accountMap = map(payload.accounts, 'account_id');
const personMap = map(payload.persons, 'person_id');
const sourceMap = map(payload.sources, 'source_id');
const campaignMap = map(payload.gift_campaigns, 'campaign_id');
const itemMap = map(payload.gift_items, 'item_id');
const rev = row => ({ ...row, revision: 1 });
const catalog = { status: 'ok', accounts: payload.accounts.map(row => ({ ...row, revision: 1, people_count: payload.affiliations.filter(a => a.account_id === (row.contact_account_id || row.account_id)).length })), campaigns: payload.gift_campaigns, items: payload.gift_items, totals: { accounts: payload.accounts.length, persons: payload.persons.length, affiliations: payload.affiliations.length, needs_review: payload.persons.filter(p => p.identity_status === 'needs_review').length } };
const gift = row => ({ ...rev(row), campaign_name: campaignMap.get(row.campaign_id)?.name, item_name: itemMap.get(row.item_id)?.name });
function peopleFor(accountId) {
  const account = accountMap.get(accountId);
  return payload.affiliations.filter(a => a.account_id === (account.contact_account_id || accountId)).map(a => ({ ...rev(a), ...personMap.get(a.person_id), account_name: account.name, contact_points: payload.contact_points.filter(c => c.person_id === a.person_id && (!c.affiliation_id || c.affiliation_id === a.affiliation_id)), receiving_preferences: payload.receiving_preferences.filter(p => p.person_id === a.person_id && (!p.affiliation_id || p.affiliation_id === a.affiliation_id)), gift_recipients: payload.gift_recipients.filter(g => g.affiliation_id === a.affiliation_id).map(gift) }));
}
function personDetail(personId) {
  const affiliations = payload.affiliations.filter(a => a.person_id === personId).map(a => ({ ...rev(a), account_name: accountMap.get(a.account_id)?.name }));
  const contact_points = payload.contact_points.filter(c => c.person_id === personId).map(rev);
  const receiving_preferences = payload.receiving_preferences.filter(p => p.person_id === personId).map(rev);
  const gift_recipients = payload.gift_recipients.filter(g => g.person_id === personId).map(gift);
  const ids = new Set([personId, ...affiliations.map(a => a.affiliation_id), ...contact_points.map(c => c.contact_point_id), ...receiving_preferences.map(p => p.preference_id), ...gift_recipients.map(g => g.recipient_id)]);
  const field_claims = payload.field_claims.filter(c => ids.has(c.entity_id));
  const srcIds = new Set([...field_claims, ...contact_points, ...receiving_preferences, ...gift_recipients].map(r => r.source_record_id));
  const source_records = payload.source_records.filter(r => srcIds.has(r.source_record_id)).map(({ raw_values, ...r }) => ({ ...r, file_name: sourceMap.get(r.source_id)?.file_name }));
  return { status: 'ok', person: rev(personMap.get(personId)), affiliations, contact_points, receiving_preferences, gift_recipients, field_claims, source_records, life_events: [], audit: [] };
}
const injected = classificationLabels(source).replace('</body>', '<link data-one-account-shared rel="stylesheet" href="/shared-teams.css"><link data-one-account-crm rel="stylesheet" href="/crm.css"><script data-one-account-crm src="/crm-bootstrap.js"></script></body>');
let offlineHtml = '';
let apiRequests = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/offline') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(offlineHtml); }
  if (url.pathname.startsWith('/api/')) apiRequests++;
  if (url.pathname === '/api/teams') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ revision: 1, snapshotId: 'QA-REAL-SOURCE', actorEmail: 'qa@example.invalid', assignments, updatedBy: '원본 검증', updatedAt: null })); }
  if (url.pathname === '/api/crm') {
    assert.equal(req.method, 'GET');
    const action = url.searchParams.get('action');
    let body = catalog;
    if (action === 'account') { const id = url.searchParams.get('accountId'); body = { status: 'ok', account: accountMap.get(id), people: peopleFor(id) }; }
    if (action === 'person') body = personDetail(url.searchParams.get('personId'));
    if (action === 'search') { const q = url.searchParams.get('q'); body = { status: 'ok', people: catalog.accounts.flatMap(a => peopleFor(a.account_id)).filter(p => [p.name, p.department, p.title, p.account_name].join(' ').includes(q)).slice(0, 100), truncated: false }; }
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(body));
  }
  if (/^\/(?:crm(?:-bootstrap)?|shared-teams)\.(?:js|css)$/.test(url.pathname)) { res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(fs.readFileSync(path.join(__dirname, '../public', url.pathname.slice(1)))); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(injected);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CRM_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'one-account-crm-integration-'));
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.ONE_ACCOUNT_CRM_BOOTSTRAP_PROMISE);
    await page.waitForFunction(() => document.querySelector('.oa-shared-state')?.textContent.includes('모든 변경이 저장'));
    const counts = await page.evaluate(() => ({ accounts: D.accounts.length, mapped: accountsById.size, rmAssignedAccounts: Object.keys(teamAssignments).length, crmOnly: D.accounts.filter(a => a.crm_only).length, rmCount: D.accounts.filter(accountHasRm).length, bar: !!document.querySelector('.oa-crm-bar') }));
    assert.equal(counts.accounts, payload.accounts.length); assert.equal(counts.mapped, counts.accounts); assert.equal(counts.rmAssignedAccounts, Object.keys(assignments).length); assert.equal(counts.bar, true);
    await page.locator('[data-account-scope="all"]').click();
    if (process.env.CRM_QA_CLASSIFICATION) {
      const classification = await page.evaluate(() => ({
        counts: Object.fromEntries(['P','I','S','C','F','H','미Account'].map(code=>[code,D.accounts.filter(a=>code==='미Account'?!a.piscfh.default_candidate_codes.length:a.piscfh.default_candidate_codes.includes(code)).length])),
        option: document.querySelector('#piscfhFilter option[value="unclassified"]').textContent
      }));
      const expected=Object.fromEntries(['P','I','S','C','F','H','미Account'].map(code=>[code,payload.accounts.filter(a=>a.piscfh===code).length]));
      assert.deepEqual(classification.counts,expected);
      assert.match(classification.option,/미Account/);
      const graph = await page.evaluate(() => D.account_asset_exposures.map(({piscfh_code,source_piscfh_code,...row})=>row));
      assert.deepEqual(graph,original.account_asset_exposures.map(({piscfh_code,...row})=>row));
    }
    const newAccount = catalog.accounts.find(a => !a.is_existing && a.people_count > 0 && !a.is_placeholder);
    const results = await page.evaluate(accountId => {
      state.accountScope = 'all'; state.query = ''; state.piscfh = ''; state.role = ''; state.status = ''; state.viewMode = 'account';
      state.selected = accountId; renderKpis(); renderList(); renderSelection(); renderLookthrough(); renderReviews(); renderQuality();
      const modes = {};
      for (const mode of ['piscfh', 'rm', 'account']) { state.viewMode = mode; renderList(); modes[mode] = document.querySelectorAll('.account-row').length; }
      state.piscfh = 'unclassified'; renderList(); const unclassified = document.querySelectorAll('.account-row').length;
      state.piscfh = ''; state.accountScope = 'rm'; renderList(); const rmScope = document.querySelectorAll('.account-row').length;
      state.accountScope = 'all'; state.selected = accountId; renderList(); renderSelection();
      return { modes, unclassified, rmScope, newInspectorReady: !!document.querySelector('.oa-crm-account-section'), newAccountSelected: state.selected === accountId };
    }, newAccount.account_id);
    assert.equal(results.modes.account, payload.accounts.length); assert.equal(results.newInspectorReady, true); assert.equal(results.newAccountSelected, true); assert.equal(results.rmScope, counts.rmCount);
    await page.screenshot({ path: path.join(output, 'expanded-main-desktop.png') });
    await page.getByRole('button', { name: '소속인물 보기', exact: true }).click();
    await page.locator('.oa-crm-person').first().waitFor();
    await page.locator('.oa-crm-person').first().click();
    await page.getByRole('heading', { name: '연락·배송 정보', exact: true }).waitFor();
    const personId = peopleFor(newAccount.account_id)[0].person_id;
    const contacts = personDetail(personId).contact_points.map(c => c.value).filter(Boolean);
    // Capture export while PII is visibly mounted, then inspect only inside browser memory.
    const exported = await page.evaluate(contactValues => {
      const html = buildSharedHtml('QA-OFFLINE-EXPANDED');
      const document = new DOMParser().parseFromString(html, 'text/html');
      const data = JSON.parse(document.querySelector('#embedded-data').textContent);
      const dynamic = document.querySelectorAll('[data-one-account-crm],.oa-crm-drawer,.oa-crm-editor,.oa-crm-account-section').length;
      return { accounts: data.accounts.length, dynamicNodes: dynamic, privateContactLeaks: contactValues.filter(value => html.includes(value)).length, crmScripts: [...document.scripts].filter(script => /\/crm(?:-bootstrap)?\.js/.test(script.src)).length, rmAssignments: Object.keys(JSON.parse(document.querySelector('#sharedTeamState').textContent)).length };
    }, contacts);
    assert.equal(exported.accounts, payload.accounts.length); assert.equal(exported.dynamicNodes, 0); assert.equal(exported.privateContactLeaks, 0); assert.equal(exported.crmScripts, 0); assert.equal(exported.rmAssignments, Object.keys(assignments).length);
    await page.screenshot({ path: path.join(output, 'person-real-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'person-real-mobile.png') });
    const overflow = await page.locator('.oa-crm-drawer').evaluate(node => node.scrollWidth > node.clientWidth);
    assert.equal(overflow, false); assert.deepEqual(errors, []);
    offlineHtml = await page.evaluate(() => buildSharedHtml('QA-OFFLINE-RELOAD'));
    const beforeOfflineRequests = apiRequests;
    const offlinePage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    offlinePage.on('pageerror', error => errors.push(error.message));
    await offlinePage.goto(`http://127.0.0.1:${server.address().port}/offline`, { waitUntil: 'networkidle' });
    const offline = await offlinePage.evaluate(() => ({ accounts: D.accounts.length, map: accountsById.size, rm: Object.keys(teamAssignments).length, crm: !!document.querySelector('.oa-crm-bar') }));
    assert.equal(offline.accounts, payload.accounts.length); assert.equal(offline.map, payload.accounts.length); assert.equal(offline.rm, Object.keys(assignments).length); assert.equal(offline.crm, false); assert.equal(apiRequests, beforeOfflineRequests); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, sourceAccounts: original.accounts.length, sourceRmAssignments: Object.keys(assignments).length, counts, views: results, export: exported, offlineReload: offline, offlineApiCalls: apiRequests - beforeOfflineRequests, browserErrors: errors.length, mobileHorizontalOverflow: overflow, screenshotDirectory: output }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; server.close(); });
