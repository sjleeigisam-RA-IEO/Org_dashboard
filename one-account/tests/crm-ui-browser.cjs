'use strict';
// Optional browser QA: NODE_PATH must point at the bundled Playwright runtime.
// Uses synthetic data only and does not connect to the production API.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { readView } = require('../lib/crm-db.cjs');
const { projectRead } = require('../lib/crm-privacy.cjs');
const publicView = (raw, action) => projectRead(readView(raw, action), action);
const lockHelp = '본인 인증 후 개인정보를 조회·수정할 수 있습니다.';
const account = { account_id: 'QA-A', name: '검증용 공제회', piscfh: 'P', aliases: ['검증공제회'], people_count: 2 };
const catalog = { status: 'ok', accounts: [account], campaigns: [{ campaign_id: 'QA-CAMPAIGN', name: '2026 추석' }], totals: { accounts: 1, persons: 2, affiliations: 2, needs_review: 0 } };
const people = [
  { person_id: 'QA-1', affiliation_id: 'QA-AFF-1', account_id: account.account_id, name: '김검증', department: '대체투자실 · 부동산팀', title: '팀장 / 차장', employment_status: 'unknown', identity_status: 'unverified', contact_points: [{ kind: 'email', value: 'sample@example.invalid' }], receiving_preferences: [{ availability: 'no', notes: '검증용 수령 메모' }], gift_recipients: [{ send_target: 'yes', item_name: '검증용 선물' }] },
  { person_id: 'QA-2', affiliation_id: 'QA-AFF-2', account_id: account.account_id, name: '이검증', department: '', title: '', employment_status: 'unknown', identity_status: 'needs_review' }
];
const detail = {
  status: 'ok', person: { person_id: 'QA-1', name: '김검증', identity_status: 'unverified' },
  affiliations: [{ ...people[0], account_name: account.name, revision: 1 }],
  contact_points: [{ contact_point_id: 'QA-CONTACT', person_id: 'QA-1', affiliation_id: 'QA-AFF-1', kind: 'email', value: 'sample@example.invalid', verification_status: 'source_reported', revision: 1 }, { kind: 'phone', value: ' ' }],
  receiving_preferences: [{ preference_id: 'QA-PREF', person_id: 'QA-1', affiliation_id: 'QA-AFF-1', campaign_id: 'QA-CAMPAIGN', availability: 'no', scope: 'campaign', notes: '해당 명절에만 수령하지 않음', revision: 1 }, { availability: 'unknown', scope: 'unknown', effective_from: null, effective_to: null }],
  gift_recipients: [{ recipient_id: 'QA-GIFT', campaign_id: 'QA-CAMPAIGN', campaign_name: '2026 추석', send_target: 'yes', item_name: '검증용 선물', delivery_status: 'unknown', received_status: 'unknown', planned_amount: 0, actual_amount: null }, { campaign_id: 'QA-CAMPAIGN', send_target: 'no', item_id: null, planned_amount: null, actual_amount: 0, delivery_status: 'not_sent', received_status: 'unknown', sent_on: null, received_on: null }],
  life_events: [{ event_type: 'birthday', event_date: '2026-01-02', description: '검증용 경조사 메모' }, { event_type: 'other', event_date: null, description: '' }], field_claims: [{ field_name: '직급', value: '팀장', source_record_id: 'QA-SRC' }],
  source_records: [{ source_record_id: 'QA-SRC', file_name: '검증용.xlsx', sheet_name: 'P', row_number: 2 }], audit: []
};
let mutationAttempts = 0;
const protectedValues = ['sample@example.invalid', '검증용 선물', '검증용 수령 메모', '해당 명절에만 수령하지 않음', '검증용.xlsx', '검증용 경조사 메모', '2026-01-02'];
const responseBodies = [];
const errors = [];
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/crm.css"><style>body{margin:0;background:#eef3f7;font:14px Arial}.topbar{padding:24px;background:#17324e;color:white}.mock{padding:25px;display:grid;grid-template-columns:300px 1fr;gap:20px}.account-row{border:1px solid #bdcedd;padding:15px;background:#fff;border-radius:8px;width:100%}#inspector{padding:24px;background:#fff}.row-title{display:flex;justify-content:space-between}.row-meta{font-size:11px;color:#6e7c8a}</style><body><header class="topbar">ONE ACCOUNT · UI 검증</header><main class="mock"><div id="accountList"></div><aside id="inspector"><div class="inspector-body"></div></aside></main><script>window.ONE_ACCOUNT_CRM_INITIAL_CATALOG=${JSON.stringify(publicView(catalog, 'catalog'))};let state={selected:'QA-A'};function accountRow(a){return '<button class="account-row" data-id="'+a.account_id+'"><div class="row-title">'+a.name+'<span class="faces">0개 얼굴</span></div><div class="row-meta">사업관계</div></button>'}function renderInspector(){}document.querySelector('#accountList').innerHTML=accountRow(window.ONE_ACCOUNT_CRM_INITIAL_CATALOG.accounts[0]);</script><script src="/crm.js"></script></body></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/crm.js' || url.pathname === '/crm.css') {
    res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', url.pathname.slice(1))));
  }
  if (url.pathname === '/api/crm') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (req.method === 'POST') {
      mutationAttempts++;
      res.statusCode = 403;
      return res.end(JSON.stringify({ message: lockHelp }));
    }
    const action = url.searchParams.get('action');
    const body = action === 'catalog' ? catalog : action === 'account' ? { status: 'ok', account, people } : action === 'search' ? { status: 'ok', people: people.map(p => ({ ...p, account_name: account.name })), truncated: false } : detail;
    const response = JSON.stringify(publicView(body, action));
    responseBodies.push(response);
    return res.end(response);
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
    const exportButton = page.getByRole('button', { name: '전체 명단 엑셀', exact: true });
    assert.equal(await exportButton.isDisabled(), true);
    assert.equal(await page.locator('.oa-crm-locked-control').getAttribute('title'), '전체 명단 엑셀 다운로드는 아직 열려 있지 않습니다.');
    await page.getByRole('button', { name: '소속인물 보기', exact: true }).click();
    await page.getByRole('button', { name: /김검증/ }).waitFor();
    assert.deepEqual(await page.locator('.oa-crm-people-table th').allTextContents(), ['성명', '부서', '직책', '직급', '연락처', '사내 컨택포인트']);
    const rows = page.locator('.oa-crm-people-table tbody tr');
    assert.deepEqual((await rows.first().locator('td').allTextContents()).slice(2), ['팀장', '차장', '*', '']);
    assert.deepEqual((await rows.nth(1).locator('td').allTextContents()).slice(1), ['', '', '', '', '']);
    assert.equal(await page.locator('.oa-crm-contact-lock').getAttribute('title'), lockHelp);
    assert.equal(await page.locator('.oa-crm-drawer').getByRole('button', { name: /수정|추가|저장/ }).count(), 0);
    await page.screenshot({ path: path.join(output, 'account-desktop.png') });
    await page.getByRole('button', { name: /김검증/ }).click();
    await page.getByRole('heading', { name: '기본 소속 정보', exact: true }).waitFor();
    for (const name of ['연락처', '수령가능 여부', '선물 이력', '경조사']) {
      await page.getByRole('table', { name, exact: true }).waitFor();
    }
    assert.equal(await page.locator('.oa-crm-detail-lock').count(), 0);
    assert.equal(await page.locator('.oa-crm-section-lock').count(), 4);
    assert.deepEqual(await page.locator('.oa-crm-section-lock').evaluateAll(nodes => nodes.map(node => node.title)), Array(4).fill(lockHelp));
    assert.ok(await page.locator('.oa-crm-masked-value').count() > 0);
    assert.ok((await page.locator('.oa-crm-masked-value').allTextContents()).every(value => value === '*'));
    assert.deepEqual(await page.getByRole('table', { name: '연락처', exact: true }).locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent))), [['휴대전화', ''], ['전화', ''], ['이메일', '*'], ['주소', ''], ['우편번호', '']]);
    // Explicit zero amounts and no are present values; unknown/null cells remain empty.
    const expectedDetail = publicView(detail, 'person').masked_details;
    assert.equal(expectedDetail.gifts[0].planned_amount, '*');
    assert.equal(expectedDetail.gifts[0].actual_amount, '');
    assert.equal(expectedDetail.gifts[0].delivery_status, '');
    assert.equal(expectedDetail.gifts[1].actual_amount, '*');
    assert.equal(expectedDetail.gifts[1].send_target, '*');
    assert.equal(expectedDetail.preferences[1].availability, '');
    assert.equal(expectedDetail.life_events[1].description, '');
    const tableRows = name => page.getByRole('table', { name, exact: true }).locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
    assert.deepEqual(await tableRows('선물 이력'), [['*', '*', '*', '*', '', '', '', '', ''], ['*', '*', '', '', '*', '*', '', '', '']]);
    assert.deepEqual(await tableRows('수령가능 여부'), [['*', '*', '*', '', ''], ['', '', '', '', '']]);
    assert.deepEqual(await tableRows('경조사'), [['*', '*', '*'], ['*', '', '']]);
    assert.equal(await page.locator('.oa-crm-editor').count(), 0);
    assert.equal(await page.locator('.oa-crm-drawer').getByRole('button', { name: /수정|추가|저장/ }).count(), 0);
    const detailText = await page.locator('.oa-crm-drawer').textContent();
    assert.equal(protectedValues.some(value => detailText.includes(value)), false);
    await page.screenshot({ path: path.join(output, 'person-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'person-mobile.png') });
    const overflow = await page.locator('.oa-crm-drawer').evaluate(node => node.scrollWidth > node.clientWidth);
    assert.equal(overflow, false); assert.equal(mutationAttempts, 0); assert.deepEqual(errors, []);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '인물·기관 전체보기' }).click();
    await page.getByLabel('기관·인물 검색').fill('김검증');
    await page.getByRole('button', { name: /김검증/ }).waitFor();
    const searchText = await page.locator('.oa-crm-drawer').textContent();
    assert.equal(protectedValues.some(value => searchText.includes(value)), false);
    assert.equal(protectedValues.some(value => responseBodies.some(body => body.includes(value))), false);
    assert.equal(mutationAttempts, 0);
    await page.screenshot({ path: path.join(output, 'search-mobile.png') });
    console.log(JSON.stringify({ ok: true, mutationAttempts, lockedExport: true, contactValuesInResponses: 0, browserErrors: errors.length, horizontalOverflow: overflow, screenshotDirectory: output }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; server.close(); });
