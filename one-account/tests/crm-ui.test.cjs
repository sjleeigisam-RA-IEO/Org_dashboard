'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { groupPeople, sortedPeople, titleParts, displayValue, departmentText, peopleSummary, accountSearch, hierarchyGroups, accountPath, personCount, preferenceText, sourceText, escape, identityActive, mayReveal } = require('../public/crm.js');

test('department display removes repeated exact source labels without changing source or inventing organization aliases', () => {
  const person = { account_name: '검증공제회', department: '기업투자팀 / 검증공제회;기업투자팀 / 기업투자팀 / 리스크팀' };
  const before = { ...person };
  assert.equal(departmentText(person), '기업투자팀 / 리스크팀');
  assert.deepEqual(person, before);
  assert.equal(departmentText({ account_name: '검증공제회', department: '다른공제회;기업투자팀' }), '다른공제회;기업투자팀');
  assert.equal(departmentText({ account_name: '검증공제회', department: '검증공제회' }), '');
  assert.equal(departmentText({ department: '승인별칭;투자팀' }, { aliases: ['승인별칭'] }), '투자팀');
});

test('people stay distinct across equal names and departments; search includes titles', () => {
  const people = [
    { person_id: '2', name: '김동명', department: '투자팀', title: '과장' },
    { person_id: '1', name: '김동명', department: '투자팀', title: '팀장' },
    { person_id: '3', name: '홍기관', department: '', title: '' }
  ];
  assert.equal(groupPeople(people).flatMap(group => group.people).length, 3);
  assert.equal(groupPeople(people, '팀장')[0].people[0].person_id, '1');
  assert.equal(groupPeople(people).at(-1).department, '');
  assert.equal(groupPeople(people, '검색없음').length, 0);
});
test('a seasonal refusal never reads as permanent and missing values display blank', () => {
  assert.equal(preferenceText({ availability: 'no', scope: 'campaign', campaign_name: '2026 추석' }), '수령 불가 · 해당 명절에 한함 · 2026 추석');
  assert.equal(preferenceText({ availability: 'no', scope: 'unknown' }), '수령 불가');
  assert.equal(preferenceText({ availability: 'unknown', scope: 'campaign', campaign_name: '2026 추석' }), '');
  assert.match(preferenceText({ availability: 'yes', scope: 'ongoing', effective_to: '2027-01-01' }), /지속 적용.*2027-01-01/);
});
test('seniority places executives above team leaders and separates explicit mixed titles without rewriting source', () => {
  const titles = ['과장', '팀장/부장', '부장', '상무', '대표이사', '본부장/상무', '회장', '부사장', '전무', '특수전문위원', ''];
  const people = titles.map((title, i) => ({ person_id: String(i), name: '동명', title, department: '' }));
  assert.deepEqual(sortedPeople(people).map(p => p.title), ['회장', '대표이사', '부사장', '전무', '본부장/상무', '상무', '팀장/부장', '부장', '과장', '특수전문위원', '']);
  assert.equal(titleParts({ title: '부장/본부장' }).position, '본부장');
  assert.equal(titleParts({ title: '부장/본부장' }).rank, '부장');
  assert.equal(titleParts({ title: '부사장' }).position, '');
  assert.equal(titleParts({ title: '부사장' }).rank, '부사장');
  assert.equal(titleParts({ title: '건설 부이사장(CIO) / 건축시공기술사' }).raw, '건설 부이사장(CIO) / 건축시공기술사');
  assert.equal(people[1].title, '팀장/부장');
  const tied = [{ person_id: '2', name: '나', department: 'B', title: '팀장' }, { person_id: '1', name: '나', department: 'A', title: '팀장' }, { person_id: '3', name: '가', department: 'A', title: '팀장' }];
  assert.deepEqual(sortedPeople(tied).map(p => p.person_id), ['3', '1', '2']);
  assert.equal(displayValue(0), '0');
  for (const value of [null, undefined, '', '-', '미확인', '미입력', '없음']) assert.equal(displayValue(value), '');
});
test('people summaries use safe contact counts only and never infer an internal contact from RM', () => {
  const person = { contact_count: 3, rm: 'RM 담당자', internal_contact: '기존 임의값', teamAssignments: ['RM 담당자'] };
  for (const key of ['contact_points', 'receiving_preferences', 'gift_recipients']) Object.defineProperty(person, key, { get() { throw new Error('Protected field must not be read'); } });
  assert.deepEqual(peopleSummary(person), { contact: '*', internalContact: '' });
  for (const count of [undefined, null, 0, -1, 0.5, '2', NaN]) assert.deepEqual(peopleSummary({ contact_count: count }), { contact: '', internalContact: '' });
});
test('source references retain exact workbook sheet and row; unsafe labels are escaped', () => {
  assert.equal(sourceText({ file_name: '원본.xlsx', sheet_name: '유선확인필요', row_number: 8 }), '원본.xlsx · 유선확인필요 · 8행');
  assert.equal(escape('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

const fixtureCatalog = { status: 'ok', accounts: [{ account_id: 'A', name: '테스트 공제회', piscfh: 'P', aliases: [], people_count: 1 }], campaigns: [{ campaign_id: 'CAMPAIGN', name: '2026 추석' }], totals: { accounts: 1, persons: 1, affiliations: 1, needs_review: 0 } };
const fixturePerson = () => ({
  status: 'ok', person: { person_id: 'PERSON', name: '<script>테스트</script>', identity_status: 'unverified' },
  affiliations: [{ affiliation_id: 'AFF', person_id: 'PERSON', account_id: 'A', account_name: '테스트 공제회', department: '투자팀', title: '', employment_status: 'unknown', started_on: null, ended_on: null, notes: '', revision: 1 }],
  contact_points: [{ contact_point_id: 'CONTACT', person_id: 'PERSON', affiliation_id: 'AFF', kind: 'phone', value: '02-0000-0000', verification_status: 'source_reported', revision: 1 }],
  receiving_preferences: [{ preference_id: 'PREF', person_id: 'PERSON', affiliation_id: 'AFF', campaign_id: 'CAMPAIGN', availability: 'no', scope: 'campaign', campaign_name: '2026 추석', revision: 1 }],
  life_events: [{ event_id: 'EVENT', person_id: 'PERSON', affiliation_id: 'AFF', event_type: 'birthday', event_date: null, calendar: 'unknown', recurring: false, revision: 1 }],
  gift_recipients: [{ recipient_id: 'GIFT', campaign_name: '2026 추석', item_name: '테스트 선물', delivery_status: 'unknown', received_status: 'unknown', planned_amount: null, actual_amount: null }],
  field_claims: [{ field_name: '직책', value: '', source_record_id: 'SOURCE' }], source_records: [{ source_record_id: 'SOURCE', file_name: '테스트.xlsx', sheet_name: 'P', row_number: 2 }], audit: []
});
const hierarchyCatalog = {
  accounts: [
    { account_id: 'GROUP-CREDIT-UNIONS', name: '신협', piscfh: 'I', account_kind: 'group', children_count: 3, people_count: 2 },
    { account_id: 'CENTRAL', name: '신용협동조합중앙회', piscfh: 'P', parent_account_id: 'GROUP-CREDIT-UNIONS', hierarchy_label: '중앙회', people_count: 0 },
    { account_id: 'LOCAL', name: '중앙신협', aliases: ['중앙신용협동조합'], piscfh: 'I', parent_account_id: 'GROUP-CREDIT-UNIONS', hierarchy_label: '지역 조합', people_count: 2 },
    { account_id: 'REVIEW', name: '신협 <확인필요>', piscfh: '미Account', parent_account_id: 'GROUP-CREDIT-UNIONS', hierarchy_label: '확인 필요', people_count: 0 },
    { account_id: 'OTHER', name: '다른 기관', piscfh: 'C', people_count: 0 }
  ], totals: { accounts: 5, top_level_accounts: 2, grouped_accounts: 3, persons: 2 }
};
test('account search returns one group for child names and retains individual child identities', () => {
  assert.deepEqual(accountSearch(hierarchyCatalog.accounts).map(item => item.account.account_id).sort(), ['GROUP-CREDIT-UNIONS', 'OTHER']);
  const matches = accountSearch(hierarchyCatalog.accounts, '중앙신용협동조합');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].account.account_id, 'GROUP-CREDIT-UNIONS');
  assert.deepEqual(matches[0].matchingChildren.map(child => child.account_id), ['LOCAL']);
  assert.equal(matches[0].children.length, 3);
  assert.deepEqual(hierarchyGroups(hierarchyCatalog.accounts.filter(account => account.parent_account_id)).map(group => group.label), ['중앙회', '지역 조합', '확인 필요']);
  assert.deepEqual(accountPath('LOCAL', hierarchyCatalog.accounts).map(account => account.account_id), ['GROUP-CREDIT-UNIONS', 'LOCAL']);
  assert.equal(personCount([{ person_id: 'P', affiliation_id: '1' }, { person_id: 'P', affiliation_id: '2' }]), 1);
});
function harness(responder, initial = fixtureCatalog) {
  const nodes = [], longTimers = [];
  const schedule = (fn, ms) => { if (ms > 10000) { const timer = { fn, ms, active: true, qaTimer: true, unref() {} }; longTimers.push(timer); return timer; } return setTimeout(fn, ms); };
  const cancelTimer = timer => { if (timer?.qaTimer) timer.active = false; else clearTimeout(timer); };
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this._text = ''; this._value = ''; this.open = false; this.disabled = false; this.classList = { contains() { return false; }, toggle() {} }; nodes.push(this); }
    get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get childElementCount() { return this.children.length; }
    get value() { return this._value; } set value(value) { this._value = String(value); }
    get options() { return this.children; }
    append(...items) { this.children.push(...items); }
    prepend(...items) { this.children.unshift(...items); }
    replaceChildren(...items) { this.children = items; this._text = ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    insertAdjacentElement(_, item) { this.append(item); }
    querySelector() { return null; } querySelectorAll() { return []; }
    remove() {} focus() { this.focused = true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    click() { if (!this.disabled) this.listeners.click?.({ target: this }); }
  }
  const topbar = new Node('header');
  const docBody = new Node('body');
  const requests = [];
  const sandbox = {
    location: { protocol: 'https:' }, crypto, URLSearchParams, setTimeout: schedule, clearTimeout: cancelTimer,
    document: { body: docBody, activeElement: new Node('button'), createElement: tag => new Node(tag), querySelector: selector => selector === '.topbar' ? topbar : null, querySelectorAll: () => [] },
    CustomEvent: class { constructor(name, options) { this.type = name; this.detail = options.detail; } },
    dispatchEvent() {}, ONE_ACCOUNT_CRM_INITIAL_CATALOG: initial,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const response = await responder(url, options, requests);
      return { ok: (response.status || 200) < 400, status: response.status || 200, json: async () => response.body };
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../public/crm.js'), 'utf8'), context);
  return { context, nodes, longTimers, requests, crm: sandbox.OneAccountCRM, button: text => nodes.findLast(node => node.tag === 'button' && node.textContent === text), form: () => nodes.findLast(node => node.tag === 'form'), field: name => nodes.findLast(node => node.name === name), dialog: () => nodes.find(node => node.attributes['aria-labelledby'] === 'oa-crm-title') };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('basic person view stays locked even if a legacy response includes sensitive data or claims identity verification', async () => {
  const response = fixturePerson();
  response.privacy = { detailAccess: 'unlocked', identityVerified: true, canEdit: true };
  response.affiliations[0].notes = 'SENSITIVE_AFFILIATION_NOTE';
  response.affiliations[0].started_on = '1999-01-01';
  const h = harness(async url => ({ body: url.includes('action=person') ? response : fixtureCatalog }));
  await tick();
  assert.equal(h.requests.length, 0);
  await h.crm.openPerson('PERSON', 'A');
  assert.equal(h.requests.filter(request => request.url.startsWith('/api/crm?')).length, 1);
  assert.equal(h.requests[0].credentials, 'same-origin');
  assert.equal(h.requests[0].cache, 'no-store');
  assert.equal(h.requests[0].method, 'GET');
  assert.match(h.dialog().textContent, /<script>테스트<\/script>/);
  assert.match(h.dialog().textContent, /기본 소속 정보/);
  assert.equal(h.nodes.filter(node => node.tag === 'table' && node.className.includes('oa-crm-masked-detail-table')).length, 4);
  const everyNode = h.nodes.map(node => node.textContent + JSON.stringify(node.attributes) + (node.title || '')).join(' ');
  assert.doesNotMatch(everyNode, /02-0000-0000|테스트 선물|테스트.xlsx|SENSITIVE_AFFILIATION_NOTE|1999-01-01/);
  assert.equal(h.nodes.some(node => node.tag === 'script' || node.tag === 'form' || node.className === 'oa-crm-editor'), false);
  assert.equal(h.button('소속·재직 수정'), undefined);
  assert.equal(h.button('다른 소속 추가'), undefined);
  const locked = h.nodes.find(node => node.className === 'oa-crm-section-lock');
  assert.equal(locked.title, '본인 인증 후 개인정보를 조회·수정할 수 있습니다.');
  assert.equal(locked.tabIndex, 0);
  assert.match(locked.attributes['aria-label'], /본인 인증 후 개인정보/);
  assert.equal(h.nodes.filter(node => node.tag === 'th').every(node => node.attributes.scope === 'col'), true);
});

test('person details do not read protected arrays, create an editor or request an unlock', async () => {
  const response = { person: { person_id: 'PERSON', name: '기본 이름' }, affiliations: [{ account_id: 'A', account_name: '테스트 공제회', department: '투자팀', title: '팀장' }], privacy: { detailAccess: 'locked', identityVerified: false } };
  for (const key of ['contact_points', 'receiving_preferences', 'gift_recipients', 'life_events', 'field_claims', 'source_records', 'audit']) Object.defineProperty(response, key, { get() { throw new Error('Protected field must not be read'); } });
  const h = harness(async () => ({ body: response }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  assert.match(h.dialog().textContent, /기본 이름/);
  assert.equal(h.nodes.filter(node => node.tag === 'table' && node.className.includes('oa-crm-masked-detail-table')).length, 4);
  assert.equal(h.requests.filter(request => request.url.startsWith('/api/crm?')).length, 1);
  assert.equal(h.nodes.some(node => node.tag === 'form'), false);
  const exportButton = h.button('전체 명단 엑셀');
  assert.equal(exportButton.disabled, true);
  exportButton.click();
  assert.equal(h.requests.filter(request => request.url.startsWith('/api/crm?')).length, 1);
  const exportLock = h.nodes.find(node => node.className === 'oa-crm-locked-control');
  assert.equal(exportLock.tabIndex, 0);
  assert.equal(exportLock.title, '전체 명단 엑셀 다운로드는 아직 열려 있지 않습니다.');
});

test('person detail tables show actual field headers with masked presence and blank absence', async () => {
  const response = fixturePerson();
  response.masked_details = {
    contacts: [{ kind: 'mobile', value: '*' }, { kind: 'mobile', value: '*' }, { kind: 'phone', value: '' }, { kind: 'phone', value: '*' }, { kind: 'email', value: '' }],
    preferences: [{ campaign: '*', availability: '*', scope: '*', effective_from: '', effective_to: '' }],
    gifts: [{ campaign: '*', send_target: '*', item: '*', planned_amount: '*', actual_amount: '', delivery_status: '', received_status: '', sent_on: '', received_on: '' }],
    life_events: [{ event_type: '*', event_date: '', description: '*' }]
  };
  const h = harness(async () => ({ body: response }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  const table = name => h.nodes.find(node => node.tag === 'table' && node.children[0].textContent === name);
  const headers = name => table(name).children.find(node => node.tag === 'thead').children[0].children.map(node => node.textContent);
  const values = name => table(name).children.find(node => node.tag === 'tbody').children.map(row => row.children.map(cell => cell.textContent));
  assert.deepEqual(headers('연락처'), ['종류', '내용']);
  assert.deepEqual(values('연락처'), [['휴대전화', '*'], ['전화', '*'], ['이메일', ''], ['주소', ''], ['우편번호', '']]);
  assert.deepEqual(headers('수령가능 여부'), ['명절', '수령가능 여부', '적용 범위', '시작일', '종료일']);
  assert.deepEqual(values('수령가능 여부'), [['*', '*', '*', '', '']]);
  assert.deepEqual(headers('선물 이력'), ['명절', '발송대상', '품목', '예정 금액', '실제 금액', '실제 발송', '실제 수령', '발송일', '수령일']);
  assert.deepEqual(values('선물 이력'), [['*', '*', '*', '*', '', '', '', '', '']]);
  assert.deepEqual(headers('경조사'), ['종류', '일자', '내용']);
  assert.deepEqual(values('경조사'), [['*', '', '*']]);
  const masks = h.nodes.filter(node => node.className === 'oa-crm-masked-value');
  assert.ok(masks.length > 0);
  assert.equal(masks.every(node => node.title === '본인 인증 후 개인정보를 조회·수정할 수 있습니다.' && node.tabIndex === 0), true);
  assert.equal(h.nodes.some(node => node.className?.includes('oa-crm-detail-lock')), false);
  assert.doesNotMatch(h.nodes.map(node => node.textContent).join(' '), /02-0000-0000|테스트 선물|테스트.xlsx/);
});

test('unexpected real values in masked details never render even when a response claims authentication', async () => {
  const response = fixturePerson();
  response.privacy = { identityVerified: true, detailAccess: 'unlocked' };
  response.masked_details = {
    contacts: [{ kind: 'unsafe-contact-kind', value: '010-8888-7777' }, { kind: '__proto__', value: '*' }],
    preferences: [{ campaign: '비공개 명절', availability: 'yes', scope: 'ongoing', effective_from: '2026-01-01' }],
    gifts: [{ campaign: '비공개 명절', item: '비공개 품목', actual_amount: 90000, send_target: 'yes' }],
    life_events: [{ event_type: '비공개 경조사', event_date: '2026-09-15', description: '<img src=x>' }]
  };
  const h = harness(async () => ({ body: response }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  const allDom = h.nodes.map(node => node.textContent + JSON.stringify(node.attributes) + (node.title || '')).join(' ');
  assert.doesNotMatch(allDom, /unsafe-contact-kind|010-8888-7777|비공개|90000|2026-09-15|2026-01-01|__proto__|<img src=x>/);
  assert.equal(h.nodes.some(node => node.tag === 'img' || node.tag === 'form'), false);
  assert.equal(h.requests.every(request => request.method === 'GET'), true);
});

test('late account responses cannot overwrite the account currently open', async () => {
  let resolveA;
  const h = harness(async url => {
    if (url.includes('accountId=A')) return new Promise(resolve => { resolveA = resolve; });
    return { body: { status: 'ok', account: { account_id: 'B', name: '다른 기관', piscfh: 'C' }, people: [] } };
  });
  await tick();
  const first = h.crm.openAccount('A');
  await h.crm.openAccount('B');
  resolveA({ body: { status: 'ok', account: { account_id: 'A', name: '오래된 응답' }, people: [] } });
  await first;
  assert.match(h.dialog().textContent, /다른 기관/);
  assert.doesNotMatch(h.dialog().textContent, /오래된 응답/);
});

test('account table masks contacts, removes gift columns and leaves internal contacts blank while keeping rank order', async () => {
  const account = { ...fixtureCatalog.accounts[0], rm: 'ASSIGNED_RM_NAME' };
  const people = [
    { person_id: 'JUNIOR', affiliation_id: 'JUNIOR-AFF', account_id: 'A', name: '나부장', title: '부장', department: '', contact_count: 0 },
    { person_id: 'SENIOR', affiliation_id: 'SENIOR-AFF', account_id: 'A', name: '가본부장', title: '부장/본부장', department: '투자부', employment_status: 'former', contact_count: 2, rm: 'ASSIGNED_RM_NAME', contact_points: [{ value: '010-1234-5678' }], receiving_preferences: [{ availability: 'no' }], gift_recipients: [{ item_name: 'SENSITIVE_ITEM', send_target: 'yes' }] }
  ];
  const h = harness(async url => ({ body: url.includes('action=person') ? fixturePerson() : { account, people, privacy: { detailAccess: 'locked', identityVerified: false } } }));
  await tick(); await h.crm.openAccount('A');
  const table = h.nodes.findLast(node => node.tag === 'table' && node.className.includes('oa-crm-people-table'));
  const headers = table.children.find(node => node.tag === 'thead').children[0].children.map(node => node.textContent);
  assert.deepEqual(headers, ['성명', '부서', '직책', '직급', '연락처', '사내 컨택포인트']);
  const rows = table.children.find(node => node.tag === 'tbody').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, '가본부장퇴사·이직');
  assert.equal(rows[0].children[2].textContent, '본부장');
  assert.equal(rows[0].children[3].textContent, '부장');
  assert.equal(rows[0].children[4].textContent, '*');
  assert.equal(rows[0].children[5].textContent, '');
  assert.equal(rows[1].children[1].textContent, '');
  assert.equal(rows[1].children[4].textContent, '');
  assert.equal(rows[1].children[5].textContent, '');
  const mask = rows[0].children[4].children[0];
  assert.equal(mask.title, '본인 인증 후 개인정보를 조회·수정할 수 있습니다.');
  assert.equal(mask.tabIndex, 0);
  assert.doesNotMatch(h.dialog().textContent, /010-1234-5678|SENSITIVE_ITEM|ASSIGNED_RM_NAME|수령가능|발송대상|품목|미입력/);
  h.button('가본부장').click(); await tick();
  assert.ok(h.requests.some(request => request.url.includes('personId=SENIOR')));
  assert.equal(h.requests.some(request => request.method !== 'GET'), false);
});

test('global search uses the same masked table without exposing protected values in hidden nodes', async () => {
  const h = harness(async () => ({ body: { people: [{ person_id: 'SEARCH', account_id: 'A', name: '검색인물', account_name: '테스트 공제회', title: '상무', contact_count: 1, contact_points: [{ value: 'search-secret@example.invalid' }], gift_recipients: [{ item_name: '검색 비공개 품목' }] }] } }));
  await tick(); await h.crm.openAll();
  const search = h.nodes.findLast(node => node.tag === 'input' && node.placeholder === '기관명, 이름, 부서, 직책');
  search.value = '검색인물'; search.listeners.input();
  await new Promise(resolve => setTimeout(resolve, 250));
  const table = h.nodes.findLast(node => node.tag === 'table' && node.className.includes('oa-crm-search-people-table'));
  const headers = table.children.find(node => node.tag === 'thead').children[0].children.map(node => node.textContent);
  assert.deepEqual(headers, ['기관', '성명', '부서', '직책', '직급', '연락처', '사내 컨택포인트']);
  const row = table.children.find(node => node.tag === 'tbody').children[0];
  assert.equal(row.children[5].textContent, '*');
  assert.equal(row.children[6].textContent, '');
  assert.doesNotMatch(h.nodes.map(node => node.textContent).join(' '), /search-secret@example.invalid|검색 비공개 품목/);
  assert.equal(h.requests.filter(request => request.url.includes('action=search')).length, 1);
  assert.equal(h.requests.some(request => request.url.includes('action=person')), false);
});

test('group drawer prioritizes child organizations, preserves classifications, and navigates the complete person path', async () => {
  const group = hierarchyCatalog.accounts[0];
  const children = hierarchyCatalog.accounts.filter(account => account.parent_account_id);
  const local = hierarchyCatalog.accounts.find(account => account.account_id === 'LOCAL');
  const people = [{ person_id: 'PERSON', affiliation_id: 'AFF', account_id: 'LOCAL', account_name: local.name, name: '<img src=x>', department: '업무팀', title: '팀장' }];
  const h = harness(async url => {
    if (url.includes('action=person')) return { body: fixturePerson() };
    if (url.includes('accountId=LOCAL')) return { body: { account: local, parent_account: group, children: [], people } };
    if (url.includes('action=account')) return { body: { account: group, children, people, parent_account: null } };
    return { body: { people: [] } };
  }, hierarchyCatalog);
  await tick();
  assert.ok(h.nodes.some(node => node.textContent.includes('2개 Account · 하위 조직 3개 · 2명')));
  await h.crm.openAll();
  let cards = h.nodes.filter(node => node.className === 'oa-crm-account');
  assert.equal(cards.length, 2);
  const globalSearch = h.nodes.findLast(node => node.tag === 'input' && node.placeholder === '기관명, 이름, 부서, 직책');
  globalSearch.value = '중앙신용협동조합'; globalSearch.listeners.input();
  assert.match(h.dialog().textContent, /일치하는 하위 조직: 중앙신협/);
  await h.crm.openAccount(group.account_id);
  assert.match(h.dialog().textContent, /중앙회 · 1개/);
  assert.match(h.dialog().textContent, /지역 조합 · 1개/);
  assert.match(h.dialog().textContent, /확인 필요 · 1개/);
  assert.match(h.dialog().textContent, /신용협동조합중앙회P0/);
  assert.doesNotMatch(h.dialog().textContent, /<img src=x>/);
  assert.equal(h.nodes.some(node => node.tag === 'img'), false);
  const peopleDetails = h.nodes.findLast(node => node.className === 'oa-crm-group-people');
  peopleDetails.open = true; peopleDetails.listeners.toggle();
  assert.match(h.dialog().textContent, /<img src=x>/);
  assert.match(h.dialog().textContent, /중앙신협 · 1명/);
  const childSearch = h.nodes.findLast(node => node.tag === 'input' && node.placeholder === '조합명 또는 기관명');
  childSearch.value = '중앙신협'; childSearch.listeners.input();
  assert.doesNotMatch(h.dialog().textContent, /신용협동조합중앙회P/);
  const localCard = h.nodes.findLast(node => node.className === 'oa-crm-account oa-crm-child-account' && node.textContent.startsWith('중앙신협'));
  localCard.click(); await tick();
  assert.match(h.dialog().textContent, /전체 기관·인물›신협›중앙신협/);
  const personCard = h.nodes.findLast(node => node.className === 'oa-crm-person');
  personCard.click(); await tick();
  assert.match(h.dialog().textContent, /전체 기관·인물›신협›중앙신협› 인물 상세/);
  assert.equal(h.nodes.filter(node => node.tag === 'table' && node.className.includes('oa-crm-masked-detail-table')).length, 4);
  assert.equal(h.button('다른 소속 추가'), undefined);
  assert.equal(h.requests.some(request => request.method !== 'GET'), false);
});

const verifiedIdentity = () => ({ email: 'operator@igisam.com', identityVerified: true, canEdit: true, verifiedUntil: new Date(Date.now() + 3600000).toISOString() });
const verifiedPerson = () => {
  const result = fixturePerson(); result.person.revision = 1;
  result.gift_recipients.forEach(row => { row.revision = 1; });
  result.privacy = { ...verifiedIdentity(), detailAccess: 'verified' };
  result.campaigns = [{ campaign_id: 'CAMPAIGN', name: '2026 추석' }];
  result.items = [{ item_id: 'ITEM', name: '등록 품목', unit_price: 100000 }];
  return result;
};
test('raw detail access needs both fresh server identity and verified person permission', () => {
  const identity = verifiedIdentity(), privacy = { ...identity, detailAccess: 'verified' };
  assert.equal(identityActive(identity), true); assert.equal(mayReveal(identity, privacy), true);
  assert.equal(mayReveal(null, privacy), false);
  assert.equal(mayReveal({ ...identity, identityVerified: false }, privacy), false);
  assert.equal(mayReveal(identity, { ...privacy, canEdit: false }), false);
  assert.equal(mayReveal(identity, { ...privacy, detailAccess: 'locked' }), false);
  assert.equal(mayReveal({ ...identity, verifiedUntil: '2000-01-01' }, privacy), false);
});

test('email OTP uses only the fixed session email and explicit send/verify actions then opens verified details', async () => {
  let verified = false;
  const h = harness(async (url, options) => {
    if (url === '/api/crm-identity') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        if (body.action === 'request-code') return { body: { email: 'operator@igisam.com', retryAfterSeconds: 60, codeExpiresAt: new Date(Date.now() + 600000).toISOString() } };
        if (body.action === 'verify') { assert.equal(body.code, '123456'); verified = true; }
        if (body.action === 'lock') verified = false;
      }
      return { body: verified ? verifiedIdentity() : { email: 'operator@igisam.com', identityVerified: false, canEdit: false, verifiedUntil: null } };
    }
    return { body: url.includes('action=person') ? verified ? verifiedPerson() : fixturePerson() : fixtureCatalog };
  });
  await tick(); await h.crm.openPerson('PERSON', 'A');
  assert.doesNotMatch(h.dialog().textContent, /02-0000-0000/);
  h.button('본인 인증').click(); await tick();
  assert.equal(h.field('email'), undefined);
  assert.equal(h.requests.filter(request => request.method === 'POST').length, 0);
  h.button('인증코드 받기').click(); await tick();
  assert.deepEqual(JSON.parse(h.requests.find(request => request.method === 'POST').body), { action: 'request-code' });
  h.field('code').value = '123456'; const codeInput = h.field('code');
  await h.form().listeners.submit({ preventDefault() {} });
  assert.equal(codeInput.value, '');
  assert.match(h.dialog().textContent, /operator@igisam.com · 본인 인증됨/);
  assert.match(h.dialog().textContent, /02-0000-0000/);
  assert.ok(h.button('연락처 추가')); assert.ok(h.button('선물 이력 수정'));
  assert.equal(h.button('전체 명단 엑셀').disabled, true);
  h.button('다시 잠그기').click(); await tick();
  assert.doesNotMatch(h.dialog().textContent, /02-0000-0000|테스트 선물|테스트.xlsx/);
});

test('verified edits preserve immutable membership, revision and idempotency while uncertain retries and conflicts require fresh reads', async () => {
  let attempts = 0;
  const h = harness(async (url, options) => {
    if (url === '/api/crm-identity') return { body: verifiedIdentity() };
    if (options.method === 'POST') return ++attempts === 1 ? { status: 503, body: {} } : { status: 409, body: {} };
    return { body: url.includes('action=person') ? verifiedPerson() : fixtureCatalog };
  });
  await tick(); await h.crm.openPerson('PERSON', 'A');
  const contactEdit = h.nodes.findLast(node => node.attributes['aria-label'] === '일반전화 수정'); contactEdit.click();
  h.field('value').value = '02-1111-2222'; const form = h.form();
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.field('value').disabled, true);
  await form.listeners.submit({ preventDefault() {} });
  const requests = h.requests.filter(request => request.method === 'POST');
  assert.equal(requests.length, 2); assert.equal(requests[0].body, requests[1].body);
  const payload = JSON.parse(requests[0].body);
  assert.equal(payload.entity, 'contact_point'); assert.equal(payload.id, 'CONTACT'); assert.equal(payload.expectedRevision, 1);
  assert.equal('affiliation_id' in payload.patch, false); assert.equal('person_id' in payload.patch, false);
  assert.ok(h.button('최신 정보 불러오기')); assert.equal(h.button('저장 결과 재확인').disabled, true);
  assert.doesNotThrow(() => require('../lib/crm-db.cjs').commitBody(payload));
});

test('verified additions and gift edits send null/zero/boolean values accurately and validate dates without inferring delivery', async () => {
  const h = harness(async (url, options) => ({ body: url === '/api/crm-identity' ? verifiedIdentity() : options.method === 'POST' ? { status: 'committed', revision: 2, record: { revision: 2 } } : url.includes('action=person') ? verifiedPerson() : fixtureCatalog }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  h.button('연락처 추가').click();
  await h.form().listeners.submit({ preventDefault() {} });
  assert.equal(h.requests.filter(r => r.method === 'POST').length, 0);
  h.field('value').value = 'new@example.invalid'; h.field('kind').value = 'email';
  await h.form().listeners.submit({ preventDefault() {} });
  let payload = JSON.parse(h.requests.findLast(r => r.method === 'POST').body);
  assert.equal(payload.action, 'create'); assert.equal(payload.expectedRevision, 0); assert.equal(payload.patch.person_id, 'PERSON'); assert.equal(payload.patch.affiliation_id, 'AFF');
  assert.doesNotThrow(() => require('../lib/crm-db.cjs').commitBody(payload));
  h.button('선물 이력 수정').click();
  h.field('item_id').value = 'ITEM'; h.field('send_target').value = 'no'; h.field('actual_amount').value = '0';
  h.field('sent_on').value = '2026-09-15';
  const before = h.requests.filter(r => r.method === 'POST').length;
  await h.form().listeners.submit({ preventDefault() {} });
  assert.equal(h.requests.filter(r => r.method === 'POST').length, before);
  h.field('sent_on').value = '';
  await h.form().listeners.submit({ preventDefault() {} });
  payload = JSON.parse(h.requests.findLast(r => r.method === 'POST').body);
  assert.equal(payload.entity, 'gift_recipient'); assert.equal(payload.patch.actual_amount, 0); assert.equal(payload.patch.planned_amount, null); assert.equal(payload.patch.send_target, 'no'); assert.equal(payload.patch.delivery_status, 'unknown');
  assert.equal('campaign_id' in payload.patch, false); assert.equal('affiliation_id' in payload.patch, false);
  assert.equal(payload.expectedRevision, 1);
  assert.doesNotThrow(() => require('../lib/crm-db.cjs').commitBody(payload));
});

test('verified history shows only changed user fields and actual before/after values with actor and time', async () => {
  const result = verifiedPerson();
  result.audit = [
    { entity_type: 'contact_point', action: 'update', actor_email: 'operator@igisam.com', created_at: '2026-09-15T01:00:00Z', before_record: { value: 'BEFORE_PHONE', revision: 1 }, after_record: { value: 'AFTER_PHONE', revision: 2 }, request_id: 'INTERNAL_REQUEST_ID', verification: { actor_email: 'operator@igisam.com', auth_method: 'email_otp', verified_at: '2026-09-15T00:00:00Z' } },
    { entity_type: 'person', action: 'create', actor_email: 'import-source', created_at: '2026-09-15T01:00:00Z', before_record: {}, after_record: { name: '원본 등록', notes: '' }, verification: null },
    { entity_type: 'contact_point', action: 'create', actor_email: 'import-source', before_record: {}, after_record: { notes: '', verification_status: 'unverified' }, verification: null }
  ];
  const h = harness(async url => ({ body: url === '/api/crm-identity' ? verifiedIdentity() : result }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  assert.match(h.dialog().textContent, /변경 전변경 후/); assert.match(h.dialog().textContent, /BEFORE_PHONEAFTER_PHONE/);
  assert.doesNotMatch(h.dialog().textContent, /INTERNAL_REQUEST_ID|revision/);
  const history = h.nodes.find(node => node.tag === 'table' && node.children[0].textContent === '변경 이력');
  const rows = history.children.find(node => node.tag === 'tbody').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[2].textContent, '수정'); assert.equal(rows[1].children[2].textContent, '입력');
  assert.notEqual(rows[0].children[6].textContent, '');
  assert.equal(rows[1].children[6].textContent, '');
});

test('identity expiry and a rejected write clear private data and editors immediately', async () => {
  let verified = true;
  const h = harness(async (url, options) => {
    if (url === '/api/crm-identity') return { body: verified ? verifiedIdentity() : { email: 'operator@igisam.com', identityVerified: false, canEdit: false, verifiedUntil: null } };
    if (options.method === 'POST') { verified = false; return { status: 403, body: {} }; }
    return { body: url.includes('action=person') ? verified ? verifiedPerson() : fixturePerson() : fixtureCatalog };
  });
  await tick(); await h.crm.openPerson('PERSON', 'A');
  h.button('성명·메모 수정').click();
  await h.form().listeners.submit({ preventDefault() {} });
  assert.doesNotMatch(h.dialog().textContent, /02-0000-0000|테스트 선물|테스트.xlsx/);
  const editor = h.nodes.find(node => node.className === 'oa-crm-editor'); assert.equal(editor.open, false); assert.equal(editor.children.length, 0);
  verified = true; await h.crm.openPerson('PERSON', 'A');
  verified = false; const timer = h.longTimers.findLast(timer => timer.active); assert.ok(timer.ms <= 8 * 3600000); timer.fn(); await tick();
  assert.doesNotMatch(h.dialog().textContent, /02-0000-0000|테스트 선물|테스트.xlsx/);
});


test('remaining verified forms keep person identity separate and obey affiliation/preference/event contracts', async () => {
  const h = harness(async (url, options) => ({ body: url === '/api/crm-identity' ? verifiedIdentity() : options.method === 'POST' ? { status: 'committed', revision: 2, record: { revision: 2 } } : url.includes('action=person') ? verifiedPerson() : fixtureCatalog }));
  const mutations = () => h.requests.filter(r => r.method === 'POST' && r.url.startsWith('/api/crm'));
  const lastPayload = () => JSON.parse(mutations().at(-1).body);
  const save = async () => h.form().listeners.submit({ preventDefault() {} });
  await tick(); await h.crm.openPerson('PERSON', 'A');
  h.button('성명·메모 수정').click(); h.field('name').value = '수정한 성명'; await save();
  assert.equal(lastPayload().entity, 'person'); assert.equal(lastPayload().id, 'PERSON');
  assert.equal(lastPayload().patch.name, '수정한 성명'); assert.equal('identity_status' in lastPayload().patch, false);
  h.button('다른 소속 추가').click();
  h.field('employment_status').value = 'current'; h.field('ended_on').value = '2026-09-15';
  const before = mutations().length; await save(); assert.equal(mutations().length, before);
  h.field('ended_on').value = ''; await save();
  assert.equal(lastPayload().entity, 'affiliation'); assert.equal(lastPayload().patch.person_id, 'PERSON'); assert.equal(lastPayload().patch.account_id, 'A');
  h.button('수령가능 여부 추가').click();
  h.field('scope').value = 'ongoing'; h.field('campaign_id').value = 'CAMPAIGN'; await save();
  assert.equal(lastPayload().entity, 'preference'); assert.equal(lastPayload().patch.campaign_id, null); assert.equal(lastPayload().patch.scope, 'ongoing');
  h.button('경조사 추가').click(); await save();
  assert.equal(lastPayload().entity, 'life_event'); assert.equal(lastPayload().patch.recurring, false); assert.equal(lastPayload().patch.event_date, null);
  h.button('선물 이력 추가').click(); const beforeGift = mutations().length; await save(); assert.equal(mutations().length, beforeGift);
  h.field('campaign_id').value = 'CAMPAIGN'; h.field('item_id').value = 'ITEM'; await save();
  assert.equal(lastPayload().entity, 'gift_recipient'); assert.equal(lastPayload().patch.campaign_id, 'CAMPAIGN');
  assert.equal(lastPayload().patch.delivery_status, 'unknown'); assert.equal(lastPayload().patch.send_target, null);
  for (const request of mutations()) assert.doesNotThrow(() => require('../lib/crm-db.cjs').commitBody(JSON.parse(request.body)));
});
