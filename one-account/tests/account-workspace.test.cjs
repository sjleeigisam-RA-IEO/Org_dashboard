'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { matchesAccount, accountTree, scopeCounts, readRoute, routeUrl, changedTeam, mergeMetadata } = require('../public/account-workspace.js');
const sampleAccounts = () => [
  { account_id: 'A', display_name: '가 기관', aliases: [{ name: '가 별칭' }], piscfh: { default_candidate_codes: ['P'] }, crm_people_count: 1, account_kind: 'organization' },
  { account_id: 'B', display_name: '나 기관', aliases: [], piscfh: { default_candidate_codes: [] }, crm_people_count: 0, account_kind: 'organization' },
  { account_id: 'G', display_name: '신협', account_kind: 'group', aliases: [], piscfh: { default_candidate_codes: ['I'] }, crm_people_count: 1 },
  { account_id: 'C', display_name: '중앙신협', parent_account_id: 'G', account_kind: 'organization', aliases: ['중앙신용협동조합'], piscfh: 'I', crm_people_count: 1 }
];
const sampleTeams = () => ({ A: { primaryRmId: 'R1', backupRmId: '', sponsorRmId: '' }, C: { primaryRmId: '', backupRmId: '', sponsorRmId: 'R3' } });
test('RM scopes consider all three own roles and never inherit a parent or child assignment', () => {
  const accounts = sampleAccounts(), teams = sampleTeams();
  assert.deepEqual(scopeCounts(accounts, {}, teams), { all: 4, assigned: 2, unassigned: 2 });
  assert.equal(matchesAccount(accounts[2], { scope: 'assigned' }, teams), false);
  assert.equal(matchesAccount(accounts[3], { scope: 'assigned' }, teams), true);
  assert.equal(matchesAccount(accounts[1], { scope: 'unassigned', code: '미Account' }, teams), true);
  assert.equal(matchesAccount(accounts[3], { rm: 'R3' }, teams), true);
  assert.equal(matchesAccount(accounts[2], { rm: 'R3' }, teams), false);
});
test('a matching child stays reachable under a clearly nonmatching group without changing IDs or assignments', () => {
  const accounts = sampleAccounts(), teams = sampleTeams(), original = JSON.stringify({ accounts, teams });
  const tree = accountTree(accounts, { query: '중앙신용', scope: 'assigned' }, teams);
  assert.equal(tree.length, 1); assert.equal(tree[0].account.account_id, 'G'); assert.equal(tree[0].ownMatch, false);
  assert.deepEqual(tree[0].matches.map(account => account.account_id), ['C']);
  assert.equal(JSON.stringify({ accounts, teams }), original);
});
test('clearing one RM emits the API empty-string value and preserves every unchanged role', () => {
  assert.deepEqual(changedTeam({ primaryRmId: 'R1', backupRmId: 'R2' }, { primaryRmId: '', backupRmId: 'R2', sponsorRmId: '' }), { primaryRmId: '' });
  assert.deepEqual(changedTeam({}, { primaryRmId: '', backupRmId: null }), {});
});
test('routes use validated IDs and defined tab/view keys only', () => {
  const url = routeUrl('https://one.test/app?host=1', { account: 'A', person: 'PERSON-1', tab: 'history', view: 'accounts', query: '고객명' });
  assert.equal(url, '/app?host=1&account=A&person=PERSON-1&tab=history');
  assert.deepEqual(readRoute(url), { account: 'A', person: 'PERSON-1', tab: 'history', view: 'accounts' });
  assert.equal(readRoute('/app?account=%3Cscript%3E&tab=wrong').account, '');
  assert.equal(routeUrl('/app?account=A&person=P', { account: '', person: 'P' }), '/app');
});
test('metadata display updates retain lineage/financial values and never embed notes', () => {
  const account = { account_id: 'A', display_name: '원래 이름', aliases: ['원본 이름'], metrics: { amount: 12 }, piscfh: {} };
  mergeMetadata(account, { accountId: 'A', name: '변경 이름', piscfh: 'F', notes: 'PRIVATE NOTE', revision: 2 });
  assert.equal(account.display_name, '변경 이름'); assert.ok(account.aliases.includes('원본 이름')); assert.equal(account.metrics.amount, 12);
  assert.ok(matchesAccount(account, { query: '원래 이름' }, {}));
  assert.ok(!JSON.stringify(account).includes('PRIVATE NOTE'));
});

function harness({ responder, url = 'https://one.test/app', identity = null, deferredIdentity = null } = {}) {
  const nodes = [], events = {}, calls = [], mounts = [], people = [], shown = [], navigations = [];
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.style = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this.scrollTop = 0; this._text = ''; nodes.push(this); }
    get textContent() { return this._text + this.children.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    get classList() { return { add: name => { if (!this.className.split(' ').includes(name)) this.className += ' ' + name; }, contains: name => this.className.split(' ').includes(name), toggle: (name, on) => { this.className = this.className.split(' ').filter(part => part !== name).join(' '); if (on) this.className += ' ' + name; } }; }
    append(...children) { for (const child of children) { if (child.parentNode) child.remove(); child.parentNode = this; this.children.push(child); } }
    prepend(...children) { for (const child of children.reverse()) { if (child.parentNode) child.remove(); child.parentNode = this; this.children.unshift(child); } }
    replaceChildren(...children) { this.textContent = ''; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
    emit(name, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; for (let cursor = this; cursor; cursor = cursor.parentNode) for (const handler of cursor.listeners[name] || []) handler(event); }
    click() { if (!this.disabled) this.emit('click'); }
    focus() { document.activeElement = this; }
    scrollIntoView() {}
    querySelectorAll(selector) { const tags = selector.split(',').map(value => value.trim().toUpperCase()); return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
  }
  const body = new Node('body'); const document = { body, activeElement: null, createElement: tag => new Node(tag) };
  const location = new URL(url); const accounts = sampleAccounts(); const teams = sampleTeams(); const activeIdentity = identity || { email: 'test@example.test', identityVerified: false, canEdit: false, verifiedUntil: null };
  let identityReads = 0, locks = 0, dirtyPerson = false;
  const emit = (type, detail) => { const event = { type, detail, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of events[type] || []) fn(event); return event; };
  const defaultReply = async (target, init) => {
    const q = new URL(target, location).searchParams; const id = q.get('accountId') || 'A';
    const account = accounts.find(row => row.account_id === id); const action = q.get('action');
    if (target.startsWith('/api/crm?') && action === 'account') return { status: 'ok', account: { ...account, name: account?.display_name }, people: [{ person_id: 'P1', account_id: id, name: '테스트 인물', contact_count: 1 }], children: id === 'G' ? [accounts[3]] : [] };
    if (action === 'team') return teamReply(id, teams[id] || {});
    if (action === 'metadata') return metadataReply(id, activeIdentity.identityVerified);
    throw new Error('Unexpected request ' + target);
  };
  function teamReply(id, team = {}, revision = 1) { return { status: 'ok', accountId: id, accountRevision: revision, currentRevision: revision, team: { primaryRmId: '', backupRmId: '', sponsorRmId: '', updatedAtByRole: {}, ...team }, candidates: [{ rmId: 'R1', name: '가 RM', roles: ['primary', 'backup'] }, { rmId: 'R2', name: '나 RM', roles: ['primary', 'backup'] }, { rmId: 'R3', name: '다 RM', roles: ['backup', 'sponsor'] }], history: [] }; }
  function metadataReply(id, active = false, override = {}) { return { status: 'ok', account: { accountId: id, name: accounts.find(row => row.account_id === id)?.display_name, piscfh: 'P', aliases: ['원본'], notes: active ? 'PRIVATE NOTE' : '', notesMasked: active ? '' : '*', revision: 1, ...override }, privacy: { detailAccess: active ? 'verified' : 'locked', identityVerified: active, canEdit: active }, history: [] }; }
  const sandbox = { console, document, D: { accounts, rm_candidates: [{ person_id: 'R1', name: '가 RM' }, { person_id: 'R2', name: '나 RM' }, { person_id: 'R3', name: '다 RM' }], exposures: [] }, accountsById: new Map(accounts.map(row => [row.account_id, row])), location, URL, URLSearchParams, crypto, AbortController, setTimeout, clearTimeout, Date,
    fetch: async (target, init) => {
      const call = { target, init, body: init.body ? JSON.parse(init.body) : null }; calls.push(call);
      const answer = responder ? await responder(call, { defaultReply, teamReply, metadataReply, activeIdentity }) : await defaultReply(target, init);
      return { ok: !answer.httpStatus || answer.httpStatus < 400, status: answer.httpStatus || 200, json: async () => answer.body || answer };
    },
    history: { state: {}, pushState(state, _, path) { navigations.push(path); this.state = state; location.href = new URL(path, location).href; }, replaceState(state, _, path) { this.state = state; location.href = new URL(path, location).href; } },
    addEventListener(type, fn) { (events[type] ||= []).push(fn); }, dispatchEvent(event) { emit(event.type, event.detail); }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    OneAccountLegacy: { show: mode => shown.push(mode), getTeams: () => ({ teams, version: 1 }), hasUnsaved: () => false, refreshTeams: async () => ({ teams, version: 1 }), getAccountContext: () => ({ exposures: [] }), openMap() {} },
    OneAccountCRM: { mountPeople: (host, result, callbacks) => { mounts.push({ host, result, callbacks }); host.append(new Node('table')); }, openPerson: (id, account) => { people.push({ id, account }); emit('oa:crm-person-open', { personId: id, accountId: typeof account === 'string' ? account : account.account_id }); }, closePerson: () => !dirtyPerson, canLeave: () => !dirtyPerson, hasUnsavedChanges: () => dirtyPerson, readIdentity: async () => { identityReads++; const value = deferredIdentity ? await deferredIdentity : activeIdentity; emit('oa:crm-identity', value); return value; }, openIdentity() {}, lockIdentity: async () => { locks++; activeIdentity.identityVerified = false; activeIdentity.canEdit = false; emit('oa:crm-identity', activeIdentity); } }
  };
  sandbox.window = sandbox; sandbox.parent = sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/account-workspace.js'), 'utf8'), sandbox);
  const connected = node => node === body || Boolean(node.parentNode && connected(node.parentNode));
  const find = predicate => nodes.filter(node => connected(node) && predicate(node));
  const button = label => find(node => node.tagName === 'BUTTON' && node.textContent === label)[0];
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
  return { sandbox, calls, nodes, mounts, people, shown, navigations, body, find, button, settle, emit, teamReply, metadataReply, activeIdentity, reads: () => identityReads, locks: () => locks, setPersonDirty: value => { dirtyPerson = value; }, state: () => sandbox.OneAccountWorkspace.readState(), select: id => sandbox.OneAccountWorkspace.selectAccount(id) };
}
function editorInputs(h) { return h.find(node => node.className === 'oa-workspace-editor-fields')[0].querySelectorAll('input,textarea,select'); }
function editInput(h, index, value) { const input = editorInputs(h)[index]; input.value = value; input.emit('change'); return input; }
function submit(h) { h.find(node => node.tagName === 'FORM').at(-1).emit('submit'); }
const activeIdentity = () => ({ email: 'test@example.test', identityVerified: true, canEdit: true, verifiedUntil: new Date(Date.now() + 3600000).toISOString() });

test('initial screen does not pick an arbitrary account; identity is read once without an event loop', async () => {
  const h = harness(); await h.settle();
  assert.equal(h.state().account, ''); assert.equal(h.reads(), 1); assert.equal(h.calls.length, 0);
  assert.match(h.body.textContent, /기관을 선택해 주세요/); assert.deepEqual(h.shown, ['accounts']);
});
test('one account click mounts people immediately and all scope/filter state survives navigation', async () => {
  const h = harness(); await h.settle(); h.select('A'); await h.settle();
  assert.equal(h.mounts.length, 1); assert.equal(h.mounts[0].result.account.account_id, 'A');
  h.find(node => node.dataset.workspaceScope === 'unassigned')[0].click();
  h.select('B'); await h.settle(); h.button('RM 관리').click(); h.button('어카운트').click();
  assert.equal(h.state().scope, 'unassigned'); assert.equal(h.state().account, 'B'); assert.equal(h.reads(), 1);
  assert.equal(h.find(node => node.dataset.workspaceScope === 'assigned').length, 1);
});
test('group people open the actual child account and stable child/person URL', async () => {
  const h = harness(); await h.settle(); h.select('G'); await h.settle();
  h.mounts.at(-1).callbacks.onPerson('P1', 'C'); await h.settle();
  assert.equal(h.state().account, 'C'); assert.equal(h.state().person, 'P1');
  assert.match(h.sandbox.location.href, /account=C&person=P1/); assert.equal(h.people.at(-1).account.account_id, 'C');
});
test('deep-link restoration mounts the same account and person with the requested tab', async () => {
  const h = harness({ url: 'https://one.test/app?account=A&person=P1&tab=history' }); await h.settle();
  assert.equal(h.state().tab, 'history'); assert.equal(h.people.at(-1).id, 'P1'); assert.equal(h.state().account, 'A');
});
test('CRM unsaved input blocks account navigation and beforeunload', async () => {
  const h = harness(); await h.settle(); h.select('A'); await h.settle(); h.setPersonDirty(true); h.select('B');
  assert.equal(h.state().account, 'A');
  assert.equal(h.emit('beforeunload').defaultPrevented, true);
});
test('targeted RM save retries exactly the same request after uncertainty and blocks navigation until resolved', async () => {
  let posts = 0;
  const h = harness({ responder: async (call, api) => {
    if (!call.body) return api.defaultReply(call.target, call.init);
    posts++; if (posts === 1) return { httpStatus: 503, body: { message: 'temporary' } };
    return { ...api.teamReply('A', { primaryRmId: 'R2' }, 2), status: 'committed' };
  } });
  await h.settle(); h.select('A'); await h.settle(); h.button('RM 변경').click(); editInput(h, 0, 'R2'); submit(h); await h.settle();
  h.select('B'); assert.equal(h.state().account, 'A'); assert.equal(editorInputs(h)[0].disabled, true);
  h.button('저장 결과 재확인').click(); // Fake DOM does not implement default form submission.
  submit(h); await h.settle();
  const saved = h.calls.filter(call => call.body); assert.equal(saved.length, 2); assert.deepEqual(saved[0].body, saved[1].body);
  assert.deepEqual(saved[1].body.patch, { primaryRmId: 'R2' }); assert.equal(h.state().account, 'A');
});
test('conflict resolution retains concurrent edits to untouched roles', async () => {
  let posts = 0, teamReads = 0;
  const h = harness({ responder: async (call, api) => {
    if (call.body) { posts++; if (posts === 1) return { httpStatus: 409, body: api.teamReply('A', { primaryRmId: 'R1', backupRmId: 'R3' }, 2) }; return { ...api.teamReply('A', { primaryRmId: 'R2', backupRmId: 'R3' }, 3), status: 'committed' }; }
    if (call.target.includes('action=team')) { teamReads++; return api.teamReply('A', { primaryRmId: 'R1', backupRmId: teamReads > 1 ? 'R3' : '' }, teamReads > 1 ? 2 : 1); }
    return api.defaultReply(call.target, call.init);
  } });
  await h.settle(); h.select('A'); await h.settle(); h.button('RM 변경').click(); editInput(h, 0, 'R2'); submit(h); await h.settle();
  h.button('최신 값 비교').click(); await h.settle(); h.button('최신 버전을 기준으로 내 입력 저장').click(); await h.settle();
  const saved = h.calls.filter(call => call.body); assert.equal(saved[1].body.expectedRevision, 2); assert.deepEqual(saved[1].body.patch, { primaryRmId: 'R2' });
});
test('authenticated metadata edit reads fresh notes and sends changed fields only', async () => {
  const identity = activeIdentity(); let saved;
  const h = harness({ identity, responder: async (call, api) => {
    if (call.body) { saved = call.body; return { ...api.metadataReply('A', true, { name: '새 기관', revision: 2, profileRevision: 1 }), status: 'committed' }; }
    return api.defaultReply(call.target, call.init);
  } });
  await h.settle(); h.select('A'); await h.settle(); h.button('기관정보 수정').click(); await h.settle();
  assert.equal(editorInputs(h)[2].value, 'PRIVATE NOTE'); editInput(h, 0, '새 기관'); submit(h); await h.settle();
  assert.deepEqual(saved.patch, { name: '새 기관' }); assert.ok(!JSON.stringify(h.sandbox.D).includes('PRIVATE NOTE'));
});
test('relocking removes notes and person/metadata inputs, including late private responses', async () => {
  const identity = activeIdentity(); let release, defer = false;
  const h = harness({ identity, responder: async (call, api) => {
    if (defer && call.target.includes('action=metadata')) return new Promise(resolve => { release = () => resolve(api.metadataReply('A', true)); });
    return api.defaultReply(call.target, call.init);
  } });
  await h.settle(); h.select('A'); await h.settle(); h.button('기관정보 수정').click(); await h.settle();
  const privateInput = editorInputs(h)[2]; assert.equal(privateInput.value, 'PRIVATE NOTE');
  h.emit('oa:crm-identity', {}); assert.equal(privateInput.value, ''); assert.equal(h.find(node => node.className === 'oa-workspace-editor').length, 0);
  defer = true; const refreshing = h.sandbox.OneAccountWorkspace.refresh(); await h.settle(); release(); await refreshing; await h.settle();
  h.button('기관정보').click(); assert.ok(!h.body.textContent.includes('PRIVATE NOTE'));
});
test('401/403 revokes identity and discards sensitive input without reporting success', async () => {
  const h = harness({ identity: activeIdentity(), responder: async (call, api) => call.body ? { httpStatus: 403, body: { message: '인증 만료' } } : api.defaultReply(call.target, call.init) });
  await h.settle(); h.select('A'); await h.settle(); h.button('인물 추가').click(); editInput(h, 0, 'PRIVATE NEW PERSON'); submit(h); await h.settle();
  assert.ok(h.locks() > 0); assert.equal(h.find(node => node.className === 'oa-workspace-editor').length, 0); assert.ok(!h.body.textContent.includes('PRIVATE NEW PERSON'));
  assert.ok(!h.body.textContent.includes('인물과 소속을 등록했습니다.'));
});
test('switching editors or opening a person never silently discards an account draft', async () => {
  const h = harness({ identity: activeIdentity() }); await h.settle(); h.select('A'); await h.settle();
  h.button('기관정보 수정').click(); await h.settle(); editInput(h, 0, '작성 중 이름');
  h.button('RM 변경').click(); assert.equal(editorInputs(h)[0].value, '작성 중 이름'); assert.match(h.body.textContent, /저장하지 않은 입력/);
  h.button('계속 편집').click(); h.mounts.at(-1).callbacks.onPerson('P1', 'A');
  assert.equal(h.people.length, 0); assert.equal(editorInputs(h)[0].value, '작성 중 이름');
  h.button('버리고 이동').click(); assert.equal(h.people.length, 1); assert.equal(h.find(node => node.className === 'oa-workspace-editor').length, 0);
});
test('late metadata edit reads cannot replace a newly opened RM editor', async () => {
  let release, defer = false;
  const h = harness({ identity: activeIdentity(), responder: async (call, api) => {
    if (defer && call.target.includes('action=metadata')) return new Promise(resolve => { release = () => resolve(api.metadataReply('A', true)); });
    return api.defaultReply(call.target, call.init);
  } });
  await h.settle(); h.select('A'); await h.settle(); defer = true; h.button('기관정보 수정').click(); await h.settle();
  h.button('RM 변경').click(); release(); await h.settle();
  assert.equal(editorInputs(h).length, 3); assert.equal(editorInputs(h)[0].tagName, 'SELECT');
});
test('back navigation restores account and tab, but keeps the current route when a draft blocks it', async () => {
  const h = harness(); await h.settle(); h.select('A'); await h.settle(); h.select('B'); await h.settle();
  h.sandbox.location.href = 'https://one.test/app?account=A&tab=history'; h.emit('popstate'); await h.settle();
  assert.equal(h.state().account, 'A'); assert.equal(h.state().tab, 'history');
  h.button('RM 변경').click(); editInput(h, 0, 'R2');
  h.sandbox.location.href = 'https://one.test/app?account=B'; h.emit('popstate');
  assert.equal(h.state().account, 'A'); assert.match(h.sandbox.location.href, /account=A/); assert.equal(editorInputs(h)[0].value, 'R2');
});
test('new edits made after a conflict are included in the comparison and intentional retry patch', async () => {
  let posts = 0, teamReads = 0;
  const h = harness({ responder: async (call, api) => {
    if (call.body) { posts++; return posts === 1 ? { httpStatus: 409, body: api.teamReply('A', { primaryRmId: 'R1' }, 2) } : { ...api.teamReply('A', { primaryRmId: 'R2', sponsorRmId: 'R3' }, 3), status: 'committed' }; }
    if (call.target.includes('action=team')) return api.teamReply('A', { primaryRmId: 'R1' }, ++teamReads);
    return api.defaultReply(call.target, call.init);
  } });
  await h.settle(); h.select('A'); await h.settle(); h.button('RM 변경').click(); editInput(h, 0, 'R2'); submit(h); await h.settle();
  editInput(h, 2, 'R3'); h.button('최신 값 비교').click(); await h.settle(); h.button('최신 버전을 기준으로 내 입력 저장').click(); await h.settle();
  assert.deepEqual(h.calls.filter(call => call.body)[1].body.patch, { primaryRmId: 'R2', sponsorRmId: 'R3' });
});
