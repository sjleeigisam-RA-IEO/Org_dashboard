'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { groupPeople, preferenceText, sourceText, escape } = require('../public/crm.js');

test('people stay distinct across equal names and departments; search includes titles', () => {
  const people = [
    { person_id: '2', name: '김동명', department: '투자팀', title: '과장' },
    { person_id: '1', name: '김동명', department: '투자팀', title: '팀장' },
    { person_id: '3', name: '홍기관', department: '', title: '' }
  ];
  assert.equal(groupPeople(people).flatMap(group => group.people).length, 3);
  assert.equal(groupPeople(people, '팀장')[0].people[0].person_id, '1');
  assert.equal(groupPeople(people).at(-1).department, '부서 미확인');
  assert.equal(groupPeople(people, '검색없음').length, 0);
});
test('a seasonal refusal never reads as permanent and unknown scope stays explicit', () => {
  assert.equal(preferenceText({ availability: 'no', scope: 'campaign', campaign_name: '2026 추석' }), '수령 불가 · 해당 명절에 한함 · 2026 추석');
  assert.equal(preferenceText({ availability: 'no', scope: 'unknown' }), '수령 불가 · 적용 범위 미확인');
  assert.match(preferenceText({ availability: 'yes', scope: 'ongoing', effective_to: '2027-01-01' }), /지속 적용.*2027-01-01/);
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
  assert.match(h.dialog().textContent, /발송 미확인/);
  assert.match(h.dialog().textContent, /수령 미확인/);
  assert.match(h.dialog().textContent, /예정 금액미입력실제 금액미입력/);
  assert.equal(h.nodes.some(node => node.tag === 'script'), false);
  assert.doesNotMatch(h.dialog().textContent, /동일인·실명 확인 필요/);
});

test('editing contact and event preserves membership and sends accepted entity IDs with revision', async () => {
  const h = harness(async (url, options) => ({ body: options.method === 'POST' ? { status: 'committed', record: { revision: 2 }, revision: 2 } : url.includes('action=person') ? fixturePerson() : fixtureCatalog }));
  await tick();
  await h.crm.openPerson('PERSON', 'A');
  const contactEdit = h.nodes.find(node => node.tag === 'article' && node.textContent.includes('02-0000-0000')).children.find(node => node.tag === 'button');
  contactEdit.click();
  h.field('value').value = '02-1111-1111';
  await h.form().listeners.submit({ preventDefault() {} });
  const contactPayload = JSON.parse(h.requests.find(request => request.method === 'POST').body);
  assert.equal(contactPayload.id, 'CONTACT');
  assert.equal(contactPayload.expectedRevision, 1);
  assert.equal(contactPayload.patch.value, '02-1111-1111');
  assert.equal('affiliation_id' in contactPayload.patch, false);
  const eventEdit = h.nodes.findLast(node => node.tag === 'article' && node.textContent.includes('생일 ·')).children.find(node => node.tag === 'button');
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
