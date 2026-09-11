'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { changesBetween, applyChanges } = require('../public/shared-teams.js');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const team = (primary = '', backup = '', sponsor = '') => ({ primaryRmId: primary, backupRmId: backup, sponsorRmId: sponsor, updatedAtByRole: { primary: '2026-01-01T00:00:00Z' } });

test('comparison ignores client timestamps and detects assignment, unassignment, and deleted account roles', () => {
  const before = { A: team('p', 'b'), B: team('', '', 's') };
  const after = { A: { ...team('p', 'new'), updatedAtByRole: { primary: 'tomorrow' } }, C: team('x') };
  assert.deepEqual(changesBetween(before, after), [
    { accountId: 'A', role: 'backup', beforeRmId: 'b', afterRmId: 'new' },
    { accountId: 'B', role: 'sponsor', beforeRmId: 's', afterRmId: '' },
    { accountId: 'C', role: 'primary', beforeRmId: '', afterRmId: 'x' }
  ]);
});

test('manual import only changes selected roles and preserves concurrent unselected values', () => {
  const current = { A: team('new-common-primary', 'common-backup'), B: team('untouched') };
  const snapshot = JSON.stringify(current);
  const selected = [{ accountId: 'A', role: 'backup', beforeRmId: 'old', afterRmId: 'my-backup' }];
  const result = applyChanges(current, selected);
  assert.equal(result.A.primaryRmId, 'new-common-primary');
  assert.equal(result.A.backupRmId, 'my-backup');
  assert.deepEqual(result.B, current.B);
  assert.equal(JSON.stringify(current), snapshot);
});

test('restoring a complete role diff reproduces the historical assignments, including removals', () => {
  const current = { A: team('a', 'b'), B: team('new') };
  const historical = { A: team('', '', 's'), C: team('older') };
  const restored = applyChanges(current, changesBetween(current, historical));
  assert.deepEqual(changesBetween(restored, historical), []);
  assert.equal(restored.B, undefined);
  assert.equal(restored.C.primaryRmId, 'older');
});

// Execute the real classic script in its own global scope. The small DOM fixture
// tests storage and request behavior; visual layout remains a browser QA check.
function adapterHarness(responder, options = {}) {
  const nodes = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.classList = { toggle() {}, contains() { return false; } }; nodes.push(this); }
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); return item; }
    insertAdjacentElement(_where, item) { this.append(item); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    replaceChildren(...items) { this.children = items; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    remove() {}
    showModal() { this.open = true; }
    close() { if (this.open) { this.open = false; this.listeners.close?.(); } }
    click() { if (!this.disabled) this.listeners.click?.({ target: this }); }
  }
  const topbar = new Node('header');
  const storage = new Map([['legacy', JSON.stringify(options.legacy || { A: team('legacy') })]]);
  const initialLegacy = storage.get('legacy');
  const requests = [];
  const context = vm.createContext({
    location: { protocol: 'https:' }, crypto, AbortController, setTimeout, clearTimeout, URL, DOMParser: function () {},
    document: { body: new Node('body'), createElement: tag => new Node(tag), querySelector: selector => selector === '.topbar' ? topbar : null, addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    addEventListener() {},
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      const result = await responder(url, options, requests);
      return { status: result.status || 200, ok: (result.status || 200) < 400, json: async () => result.body };
    },
  });
  vm.runInContext(`
    const TEAM_STORAGE_KEY='legacy', SNAPSHOT_ID='snapshot', TEAM_ROLE_LABEL={primary:'Primary RM',backup:'Backup RM',sponsor:'Sponsor RM'};
    let teamAssignments=JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY));
    const accountsById=new Map([['A',{display_name:'Account A'}],['B',{display_name:'Account B'}]]);
    const rmById=new Map(['legacy','server','draft','backup'].map(id=>[id,{person_id:id,name:id}]));
    function cleanTeamAssignments(value){return JSON.parse(JSON.stringify(value));}
    function roleCohort(){return true;}
    function commitTeamAssignments(value){teamAssignments=value;localStorage.setItem(TEAM_STORAGE_KEY,JSON.stringify(value));}
    function ensureScopeSelection(){} function renderKpis(){} function renderList(){} function renderSelection(){} function renderLookthrough(){} function renderReviews(){} function renderQuality(){} function renderRmCandidates(){} function updateRmDrawerFooter(){}
    function setRmStatus(){} function buildSharedHtml(){return '';}
  `, context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/shared-teams.js'), 'utf8'), context);
  return {
    nodes, storage, initialLegacy, requests, context,
    settle: async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); },
    assignments: () => JSON.parse(vm.runInContext('JSON.stringify(teamAssignments)', context)),
    edit: value => { context.testAssignments = value; return vm.runInContext('commitTeamAssignments(testAssignments)', context); },
    click: text => { const node = nodes.find(node => node.tag === 'button' && node.textContent === text); assert.ok(node, `Missing button: ${text}`); node.click(); },
    recovery: () => JSON.parse(storage.get('one-account-shared-drafts:v1:snapshot:tester@igisam.com') || 'null'),
  };
}
const serverState = (revision = 1, assignments = { A: team('server') }) => ({ datasetId: 'rm-v1.7', revision, currentRevision: revision, assignments, updatedAt: '2026-09-11T10:00:00Z', updatedBy: 'tester@igisam.com', actorEmail: 'tester@igisam.com', snapshotId: 'snapshot', baselineSha256: 'hash' });

test('adapter loads shared state through lexical hooks without publishing or overwriting legacy draft', async () => {
  const harness = adapterHarness(async () => ({ body: serverState() }));
  await harness.settle();
  assert.equal(harness.assignments().A.primaryRmId, 'server');
  assert.equal(harness.storage.get('legacy'), harness.initialLegacy);
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].url, '/api/teams');
  harness.edit({ A: team('draft') });
  assert.equal(harness.storage.get('legacy'), harness.initialLegacy);
  assert.equal(harness.recovery().active.assignments.A.primaryRmId, 'draft');
  assert.equal(harness.requests.length, 1, 'editing is local until explicit shared save');
});

test('uncertain save persists and retries the same request ID before adopting confirmed server state', async () => {
  let posts = 0;
  const harness = adapterHarness(async (_url, options) => {
    if (options.method !== 'POST') return { body: serverState() };
    if (++posts === 1) throw new Error('network disconnected after submission');
    return { body: { ...serverState(2, { A: team('draft') }), status: 'replayed' } };
  });
  await harness.settle();
  harness.edit({ A: team('draft') });
  harness.click('공용 저장 · 1건');
  harness.click('1건 공용 저장');
  await harness.settle();
  assert.equal(harness.recovery().pendingRequest.assignments.A.primaryRmId, 'draft');
  assert.throws(() => harness.edit({ A: team('backup') }), /공용 저장 상태/);
  harness.click('저장 결과 재확인');
  await harness.settle();
  const sent = harness.requests.filter(request => request.method === 'POST').map(request => JSON.parse(request.body));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.equal(harness.recovery().pendingRequest, null);
  assert.equal(harness.assignments().A.primaryRmId, 'draft');
  assert.equal(harness.storage.get('legacy'), harness.initialLegacy);
});

test('409 leaves the current draft intact and does not publish an automatic merge', async () => {
  const harness = adapterHarness(async (_url, options) => options.method === 'POST'
    ? { status: 409, body: { ...serverState(2, { A: team('backup') }), status: 'conflict' } }
    : { body: serverState() });
  await harness.settle();
  harness.edit({ A: team('draft') });
  harness.click('공용 저장 · 1건'); harness.click('1건 공용 저장');
  await harness.settle();
  assert.equal(harness.assignments().A.primaryRmId, 'draft');
  assert.equal(harness.recovery().active.assignments.A.primaryRmId, 'draft');
  assert.equal(harness.recovery().pendingRequest, null);
  assert.equal(harness.requests.filter(request => request.method === 'POST').length, 1);
});

test('failed initial authentication blocks editing while retaining the legacy draft', async () => {
  const harness = adapterHarness(async () => ({ status: 401, body: { message: '로그인이 필요합니다.' } }));
  await harness.settle();
  assert.throws(() => harness.edit({ A: team('draft') }), /공용 저장 상태/);
  assert.equal(harness.storage.get('legacy'), harness.initialLegacy);
  assert.equal(harness.assignments().A.primaryRmId, 'legacy');
});
