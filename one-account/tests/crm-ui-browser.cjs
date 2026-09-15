'use strict';
// Optional browser QA: NODE_PATH must point at the bundled Playwright runtime.
// Uses synthetic data only and does not connect to the production API.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { commitBody } = require('../lib/crm-db.cjs');
const account = { account_id: 'QA-A', name: '검증용 공제회', piscfh: 'P', aliases: ['검증공제회'], people_count: 2 };
const catalog = { status: 'ok', accounts: [account], campaigns: [{ campaign_id: 'QA-CAMPAIGN', name: '2026 추석' }], totals: { accounts: 1, persons: 2, affiliations: 2, needs_review: 0 } };
const people = [
  { person_id: 'QA-1', affiliation_id: 'QA-AFF-1', account_id: account.account_id, name: '김검증', department: '대체투자실 · 부동산팀', title: '팀장', employment_status: 'unknown', identity_status: 'unverified' },
  { person_id: 'QA-2', affiliation_id: 'QA-AFF-2', account_id: account.account_id, name: '이검증', department: '', title: '', employment_status: 'unknown', identity_status: 'needs_review' }
];
const detail = {
  status: 'ok', person: { person_id: 'QA-1', name: '김검증', identity_status: 'unverified' },
  affiliations: [{ ...people[0], account_name: account.name, revision: 1 }],
  contact_points: [{ contact_point_id: 'QA-CONTACT', person_id: 'QA-1', affiliation_id: 'QA-AFF-1', kind: 'email', value: 'sample@example.invalid', verification_status: 'source_reported', revision: 1 }],
  receiving_preferences: [{ preference_id: 'QA-PREF', person_id: 'QA-1', affiliation_id: 'QA-AFF-1', campaign_id: 'QA-CAMPAIGN', availability: 'no', scope: 'campaign', notes: '해당 명절에만 수령하지 않음', revision: 1 }],
  gift_recipients: [{ recipient_id: 'QA-GIFT', campaign_id: 'QA-CAMPAIGN', campaign_name: '2026 추석', item_name: '검증용 선물', delivery_status: 'unknown', received_status: 'unknown', planned_amount: null, actual_amount: null }],
  life_events: [], field_claims: [{ field_name: '직급', value: '팀장', source_record_id: 'QA-SRC' }],
  source_records: [{ source_record_id: 'QA-SRC', file_name: '검증용.xlsx', sheet_name: 'P', row_number: 2 }], audit: []
};
let mutations = 0;
const errors = [];
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/crm.css"><style>body{margin:0;background:#eef3f7;font:14px Arial}.topbar{padding:24px;background:#17324e;color:white}.mock{padding:25px;display:grid;grid-template-columns:300px 1fr;gap:20px}.account-row{border:1px solid #bdcedd;padding:15px;background:#fff;border-radius:8px;width:100%}#inspector{padding:24px;background:#fff}.row-title{display:flex;justify-content:space-between}.row-meta{font-size:11px;color:#6e7c8a}</style><body><header class="topbar">ONE ACCOUNT · UI 검증</header><main class="mock"><div id="accountList"></div><aside id="inspector"><div class="inspector-body"></div></aside></main><script>window.ONE_ACCOUNT_CRM_INITIAL_CATALOG=${JSON.stringify(catalog)};let state={selected:'QA-A'};function accountRow(a){return '<button class="account-row" data-id="'+a.account_id+'"><div class="row-title">'+a.name+'<span class="faces">0개 얼굴</span></div><div class="row-meta">사업관계</div></button>'}function renderInspector(){}document.querySelector('#accountList').innerHTML=accountRow(window.ONE_ACCOUNT_CRM_INITIAL_CATALOG.accounts[0]);</script><script src="/crm.js"></script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/crm.js' || url.pathname === '/crm.css') {
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', url.pathname.slice(1))));
  }
  if (url.pathname === '/api/crm') {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = commitBody(JSON.parse(Buffer.concat(chunks).toString()));
      mutations++;
      const rows = payload.entity === 'contact_point' ? detail.contact_points : payload.entity === 'affiliation' ? detail.affiliations : detail.receiving_preferences;
      const row = rows.find(row => Object.values(row).includes(payload.id));
      Object.assign(row, payload.patch, { revision: row.revision + 1 });
      return res.end(JSON.stringify({ status: 'committed', record: row, revision: row.revision }));
    }
    const action = url.searchParams.get('action');
    const body = action === 'catalog' ? catalog : action === 'account' ? { status: 'ok', account, people } : action === 'search' ? { status: 'ok', people: people.map(p => ({ ...p, account_name: account.name })), truncated: false } : detail;
    return res.end(JSON.stringify(body));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CRM_QA_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'one-account-crm-ui-'));
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('button', { name: '소속인물 보기', exact: true }).click();
    await page.getByRole('button', { name: /김검증/ }).waitFor();
    await page.screenshot({ path: path.join(output, 'account-desktop.png') });
    await page.getByRole('button', { name: /김검증/ }).click();
    await page.getByText('sample@example.invalid', { exact: true }).waitFor();
    await page.getByRole('button', { name: '이메일 수정', exact: true }).click();
    await page.getByLabel('내용', { exact: true }).fill('changed@example.invalid');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByText('changed@example.invalid', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'person-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'person-mobile.png') });
    const overflow = await page.locator('.oa-crm-drawer').evaluate(node => node.scrollWidth > node.clientWidth);
    assert.equal(overflow, false); assert.equal(mutations, 1); assert.deepEqual(errors, []);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '인물·기관 전체보기' }).click();
    await page.getByLabel('기관·인물 검색').fill('김검증');
    await page.getByRole('button', { name: /김검증/ }).waitFor();
    await page.screenshot({ path: path.join(output, 'search-mobile.png') });
    console.log(JSON.stringify({ ok: true, mutations, browserErrors: errors.length, horizontalOverflow: overflow, screenshotDirectory: output }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; server.close(); });
