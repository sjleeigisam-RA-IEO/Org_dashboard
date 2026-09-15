'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { groupPeople, sortedPeople, titleParts, displayValue, peopleSummary, accountSearch, hierarchyGroups, accountPath, personCount, preferenceText, sourceText, escape } = require('../public/crm.js');

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
test('people rows use explicit send targets only and keep old affiliations and campaigns out of current summaries', () => {
  const campaigns = [{ campaign_id: 'OLD', year: 2026, name: '2026 설' }, { campaign_id: 'NEW', year: 2026, name: '2026 추석' }];
  const person = { account_id: 'A', affiliation_id: 'AFF', contact_points: [{ kind: 'phone', value: '02-1000-0000' }], receiving_preferences: [
    { availability: 'yes', scope: 'campaign', campaign_id: 'OLD' }, { availability: 'no', scope: 'campaign', campaign_id: 'NEW' }
  ], gift_recipients: [
    { campaign_id: 'OLD', affiliation_id: 'AFF', send_target: 'yes', item_name: '지난 설' },
    { campaign_id: 'NEW', affiliation_id: 'OTHER', gift_account_id: 'B', send_target: 'yes', item_name: '다른 소속' },
    { campaign_id: 'NEW', affiliation_id: 'AFF', send_target: null, plan_status: 'planned', delivery_status: 'sent', item_name: '한우' }
  ] };
  const summary = peopleSummary(person, campaigns);
  assert.equal(summary.sendTarget, ''); assert.equal(summary.item, '한우'); assert.equal(summary.receiving, 'X'); assert.equal(summary.contact, '02-1000-0000');
  person.gift_recipients[2].send_target = 'no'; assert.equal(peopleSummary(person, campaigns).sendTarget, 'X');
  person.gift_recipients[2].send_target = 'yes'; assert.equal(peopleSummary(person, campaigns).sendTarget, 'O');
  assert.equal(peopleSummary({}).receiving, ''); assert.equal(peopleSummary({}).item, '');
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
  const nodes = [];
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
    location: { protocol: 'https:' }, crypto, URLSearchParams, setTimeout, clearTimeout,
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
  return { context, nodes, requests, crm: sandbox.OneAccountCRM, button: text => nodes.findLast(node => node.tag === 'button' && node.textContent === text), form: () => nodes.findLast(node => node.tag === 'form'), field: name => nodes.findLast(node => node.name === name), dialog: () => nodes.find(node => node.attributes['aria-labelledby'] === 'oa-crm-title') };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('initial catalog is reused; source PII is fetched only for opened authenticated details and not put in HTML', async () => {
  const h = harness(async url => ({ body: url.includes('action=person') ? fixturePerson() : fixtureCatalog }));
  await tick();
  assert.equal(h.requests.length, 0);
  await h.crm.openPerson('PERSON', 'A');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].credentials, 'same-origin');
  assert.equal(h.requests[0].cache, 'no-store');
  assert.match(h.dialog().textContent, /<script>테스트<\/script>/);
  assert.doesNotMatch(h.dialog().textContent, /미확인|미입력|값 없음/);
  const giftRow = h.nodes.find(node => node.tag === 'tr' && node.children.some(cell => cell.textContent === '테스트 선물'));
  assert.equal(giftRow.children[4].textContent, '');
  assert.equal(giftRow.children[5].textContent, '');
  assert.equal(giftRow.children[6].textContent, '');
  assert.equal(giftRow.children[7].textContent, '');
  assert.ok(h.nodes.filter(node => node.tag === 'table').length >= 8);
  assert.equal(h.nodes.filter(node => node.tag === 'th').every(node => node.attributes.scope === 'col'), true);
  assert.equal(h.nodes.some(node => node.tag === 'article'), false);
  assert.equal(h.nodes.some(node => node.tag === 'script'), false);
  assert.doesNotMatch(h.dialog().textContent, /동일인·실명 확인 필요/);
});

test('editing contact and event preserves membership and sends accepted entity IDs with revision', async () => {
  const h = harness(async (url, options) => ({ body: options.method === 'POST' ? { status: 'committed', record: { revision: 2 }, revision: 2 } : url.includes('action=person') ? fixturePerson() : fixtureCatalog }));
  await tick();
  await h.crm.openPerson('PERSON', 'A');
  const contactEdit = h.nodes.findLast(node => node.tag === 'button' && node.attributes['aria-label'] === '일반전화 수정');
  contactEdit.click();
  h.field('value').value = '02-1111-1111';
  await h.form().listeners.submit({ preventDefault() {} });
  const contactPayload = JSON.parse(h.requests.find(request => request.method === 'POST').body);
  assert.equal(contactPayload.id, 'CONTACT');
  assert.equal(contactPayload.expectedRevision, 1);
  assert.equal(contactPayload.patch.value, '02-1111-1111');
  assert.equal('affiliation_id' in contactPayload.patch, false);
  const eventEdit = h.nodes.findLast(node => node.tag === 'button' && node.attributes['aria-label'] === '생일 수정');
  eventEdit.click();
  await h.form().listeners.submit({ preventDefault() {} });
  const eventPayload = JSON.parse(h.requests.findLast(request => request.method === 'POST').body);
  assert.equal(eventPayload.id, 'EVENT');
  assert.equal(eventPayload.entity, 'life_event');
  assert.equal('affiliation_id' in eventPayload.patch, false);
  assert.equal(eventPayload.patch.recurring, false);
});

test('uncertain save retries exactly the same request and conflict requires a fresh read', async () => {
  let attempt = 0;
  const h = harness(async (url, options) => {
    if (options.method === 'POST') return ++attempt === 1 ? { status: 503, body: {} } : { status: 409, body: {} };
    return { body: url.includes('action=person') ? fixturePerson() : fixtureCatalog };
  });
  await tick(); await h.crm.openPerson('PERSON', 'A');
  h.button('소속·재직 수정').click();
  h.field('title').value = '팀장';
  const form = h.form();
  await form.listeners.submit({ preventDefault() {} });
  assert.equal(h.field('title').disabled, true);
  await form.listeners.submit({ preventDefault() {} });
  const mutations = h.requests.filter(request => request.method === 'POST');
  assert.equal(mutations[0].body, mutations[1].body);
  assert.ok(h.button('최신 정보 불러오기'));
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

test('account table preserves absent cells, explicit former status, refusal and target marks; names still drill down', async () => {
  const account = fixtureCatalog.accounts[0];
  const people = [
    { person_id: 'JUNIOR', affiliation_id: 'JUNIOR-AFF', account_id: 'A', name: '나부장', title: '부장', department: '', employment_status: 'unknown' },
    { person_id: 'SENIOR', affiliation_id: 'SENIOR-AFF', account_id: 'A', name: '가본부장', title: '부장/본부장', department: '투자부', employment_status: 'former', receiving_preferences: [{ availability: 'no', scope: 'campaign', campaign_id: 'CAMPAIGN' }], gift_recipients: [{ campaign_id: 'CAMPAIGN', campaign_name: '2026 추석', send_target: 'yes', item_name: '한우', delivery_status: 'unknown' }] }
  ];
  const h = harness(async url => ({ body: url.includes('action=person') ? fixturePerson() : { account, people } }));
  await tick(); await h.crm.openAccount('A');
  const table = h.nodes.findLast(node => node.tag === 'table' && node.className.includes('oa-crm-people-table'));
  const rows = table.children.find(node => node.tag === 'tbody').children;
  assert.equal(rows.length, 2);
  assert.match(rows[0].children[0].textContent, /가본부장.*퇴사·이직/);
  assert.equal(rows[0].children[2].textContent, '본부장');
  assert.equal(rows[0].children[3].textContent, '부장');
  assert.equal(rows[0].children[5].textContent, 'X');
  assert.equal(rows[0].children[6].textContent, 'O');
  assert.equal(rows[0].children[7].textContent, '한우');
  assert.equal(rows[1].children[1].textContent, '');
  assert.equal(rows[1].children[5].textContent, '');
  assert.equal(rows[1].children[6].textContent, '');
  assert.doesNotMatch(h.dialog().textContent, /재직 미확인|부서 미확인|직책 미확인|미입력/);
  h.button('가본부장').click(); await tick();
  assert.ok(h.requests.some(request => request.url.includes('personId=SENIOR')));
});

test('person history retains confirmed delivery and actual zero amount independently of target status', async () => {
  const detail = fixturePerson();
  Object.assign(detail.gift_recipients[0], { send_target: 'no', delivery_status: 'sent', received_status: 'not_received', actual_amount: 0 });
  const h = harness(async () => ({ body: detail }));
  await tick(); await h.crm.openPerson('PERSON', 'A');
  const giftRow = h.nodes.find(node => node.tag === 'tr' && node.children.some(cell => cell.textContent === '테스트 선물'));
  assert.equal(giftRow.children[3].textContent, 'X');
  assert.equal(giftRow.children[4].textContent, '발송 O');
  assert.equal(giftRow.children[5].textContent, '수령 X');
  assert.equal(giftRow.children[7].textContent, '0원');
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
  h.button('다른 소속 추가').click();
  const affiliationChoices = h.field('account_id').options;
  assert.equal(affiliationChoices.some(option => option.value === group.account_id), false);
  assert.equal(affiliationChoices.find(option => option.value === 'LOCAL').textContent, '신협 / 중앙신협');
});
