'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const bootstrapSource = fs.readFileSync(require.resolve('../public/crm-bootstrap.js'), 'utf8');
const catalog = { status: 'ok', accounts: [{ account_id: 'QA-A', name: 'QA 기관', piscfh: 'P', people_count: 1 }], totals: { accounts: 1 } };
const scriptOrder = ['/account-hierarchy.js', '/shared-teams.js', '/crm.js', '/account-legacy-bridge.js', '/account-workspace.js'];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness({ cachedStyles = false, sharedVersion = 1, withDashboard = true } = {}) {
  const scripts = [], trace = [], timers = new Map(), fetches = [], windowEvents = new Map(), originalBuildCalls = [];
  const catalogGate = deferred(), sharedGate = deferred();
  let timerId = 0, workspaceNode = null, parsedDocument = null, readyCount = 0, failCount = 0, currentVersion = sharedVersion;
  class Node {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.listeners = new Map(); this.attributes = new Map(); this.style = {}; this.children = []; this.sheet = null; this.hidden = false; this.textContent = ''; this.removed = false; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    fire(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn({ type, target: this }); }
    append(node) { this.children.push(node); if (node.tagName === 'SCRIPT') { scripts.push(node); trace.push('script:' + node.src); } }
    insertAdjacentElement(_, node) { this.children.push(node); }
    remove() { this.removed = true; }
  }
  const styleLinks = ['/shared-teams.css', '/crm.css', '/account-workspace.css'].map(href => { const node = new Node('link'); node.href = href; if (cachedStyles) node.sheet = {}; return node; });
  const body = new Node('body'), topbar = new Node('header');
  const document = {
    body, createElement: tag => new Node(tag),
    querySelectorAll: selector => selector.includes('link[rel="stylesheet"]') ? styleLinks : [],
    querySelector: selector => selector === '#oa-workspace' ? workspaceNode : selector === '.topbar' ? topbar : null
  };
  const originalBuild = snapshotId => { originalBuildCalls.push(snapshotId); return '<html><body>legacy snapshot</body></html>'; };
  let buildFunction = originalBuild;
  const sandbox = {
    document, location: { protocol: 'https:' },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    AbortSignal: { timeout: milliseconds => ({ testTimeout: milliseconds }) },
    fetch(url, options) { fetches.push({ url, options }); trace.push('catalog-request'); return catalogGate.promise; },
    ONE_ACCOUNT_SHARED_READY: sharedGate.promise,
    OneAccountShared: { getState: () => ({ version: currentVersion }) },
    OneAccountStartup: {
      ready() { readyCount++; trace.push('startup-ready'); },
      fail() { failCount++; trace.push('startup-fail'); }
    },
    addEventListener(type, fn) { if (!windowEvents.has(type)) windowEvents.set(type, []); windowEvents.get(type).push(fn); },
    dispatchEvent(event) { trace.push('event:' + event.type); for (const fn of windowEvents.get(event.type) || []) fn(event); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    DOMParser: class {
      parseFromString() {
        const crmNode = new Node('section'), legacyApp = new Node('div'), embedded = new Node('script'), root = new Node('html');
        legacyApp.hidden = true; legacyApp.setAttribute('aria-hidden', 'true'); root.setAttribute('data-oa-startup', 'ready');
        const copyBody = new Node('body'); copyBody.setAttribute('data-oa-workspace-view', 'accounts');
        const removedClasses = []; copyBody.classList = { remove: (...names) => removedClasses.push(...names) };
        root.outerHTML = '<html>protected copy</html>';
        parsedDocument = {
          documentElement: root, body: copyBody, crmNode, legacyApp, embedded, removedClasses,
          querySelectorAll: selector => selector === '[data-one-account-crm]' ? [crmNode] : [],
          querySelector: selector => selector === 'body > .app' ? legacyApp : selector === '#embedded-data' ? embedded : null,
          createElement: tag => new Node(tag)
        };
        return parsedDocument;
      }
    }
  };
  if (withDashboard) { sandbox.D = { accounts: [], account_asset_exposures: [] }; sandbox.accountsById = new Map(); }
  Object.defineProperty(sandbox, 'buildSharedHtml', {
    configurable: true, get: () => buildFunction,
    set: next => { trace.push('offline-protected'); buildFunction = next; }
  });
  sandbox.window = sandbox;
  vm.runInNewContext(bootstrapSource, sandbox, { filename: 'public/crm-bootstrap.js' });
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  function loadStyle(index, error = false) {
    const node = styleLinks[index]; if (!error) node.sheet = {}; node.fire(error ? 'error' : 'load');
  }
  function loadScript(src, error = false) {
    const node = scripts.find(item => item.src === src); assert.ok(node, `bootstrap requested ${src}`);
    const handler = error ? node.onerror : node.onload; assert.equal(typeof handler, 'function', `${src} has an active ${error ? 'error' : 'load'} handler`);
    trace.push((error ? 'script-error:' : 'script-loaded:') + src); handler();
  }
  function resolveCatalog({ ok = true, data = catalog, jsonError = null } = {}) {
    catalogGate.resolve({ ok, json: async () => { if (jsonError) throw jsonError; return data; } });
  }
  function finishWorkspace(ready, element = true) {
    if (ready !== undefined) sandbox.OneAccountWorkspace = { ready };
    if (element) workspaceNode = new Node('main');
    loadScript('/account-workspace.js');
  }
  async function throughSharedScripts() {
    loadScript('/account-hierarchy.js'); await settle(); resolveCatalog(); await settle();
    loadScript('/shared-teams.js'); await settle(); loadScript('/crm.js'); await settle();
  }
  async function modules({ failScript, workspaceReady = true, workspaceElement = true } = {}) {
    for (const src of scriptOrder) {
      if (src === '/shared-teams.js') { resolveCatalog(); await settle(); }
      if (src === '/account-legacy-bridge.js') { sharedGate.resolve(); await settle(); }
      if (src === '/account-workspace.js' && !failScript) finishWorkspace(workspaceReady, workspaceElement);
      else {
        loadScript(src, src === failScript);
        if (src === failScript) { await settle(); return; }
        if (src === '/account-workspace.js') { sandbox.OneAccountWorkspace = { ready: workspaceReady }; workspaceNode = workspaceElement ? new Node('main') : null; }
      }
      await settle();
    }
  }
  return {
    sandbox, scripts, trace, timers, fetches, styleLinks, loadStyle, loadScript, resolveCatalog, finishWorkspace, throughSharedScripts, modules, settle,
    resolveShared: () => sharedGate.resolve(), rejectShared: error => sharedGate.reject(error), setSharedVersion: value => { currentVersion = value; },
    rejectCatalog: error => catalogGate.reject(error), originalBuildCalls, parsed: () => parsedDocument,
    ready: () => readyCount, failed: () => failCount, offlineProtected: () => buildFunction !== originalBuild,
    complete: () => sandbox.ONE_ACCOUNT_CRM_BOOTSTRAP_PROMISE
  };
}

test('startup stays hidden through delayed catalog, shared state, workspace script and the last stylesheet', async () => {
  const h = harness(); await h.settle();
  assert.equal(h.ready(), 0); assert.equal(h.failed(), 0); assert.deepEqual(h.scripts.map(node => node.src), [scriptOrder[0]]);
  h.loadStyle(0); h.loadStyle(1); h.loadScript('/account-hierarchy.js'); await h.settle();
  assert.equal(h.fetches.length, 1); assert.equal(h.ready(), 0); assert.equal(h.scripts.length, 1);
  h.resolveCatalog(); await h.settle();
  assert.equal(h.sandbox.accountsById.has('QA-A'), true); assert.equal(h.ready(), 0);
  h.loadScript('/shared-teams.js'); await h.settle(); h.loadScript('/crm.js'); await h.settle();
  assert.equal(h.ready(), 0); assert.equal(h.scripts.some(node => node.src === '/account-legacy-bridge.js'), false);
  h.resolveShared(); await h.settle(); h.loadScript('/account-legacy-bridge.js'); await h.settle();
  assert.equal(h.ready(), 0); assert.equal(h.offlineProtected(), false);
  h.finishWorkspace(true, true); await h.settle();
  assert.equal(h.offlineProtected(), true); assert.equal(h.ready(), 0, 'loaded workspace cannot reveal before the final CSS');
  h.loadStyle(2); assert.equal(await h.complete(), catalog);
  assert.equal(h.ready(), 1); assert.equal(h.failed(), 0); assert.equal(h.timers.size, 0);
});
test('cached styles allow success only after offline-export protection is installed and runnable', async () => {
  const h = harness({ cachedStyles: true }); await h.modules(); await h.complete();
  assert.equal(h.ready(), 1); assert.equal(h.failed(), 0);
  assert.ok(h.trace.indexOf('offline-protected') < h.trace.indexOf('startup-ready'));
  h.sandbox.buildSharedHtml('QA-SNAPSHOT');
  assert.deepEqual(h.originalBuildCalls, ['QA-SNAPSHOT']);
  const exported = h.parsed();
  assert.equal(exported.crmNode.removed, true); assert.equal(exported.documentElement.attributes.has('data-oa-startup'), false);
  assert.equal(exported.body.attributes.has('data-oa-workspace-view'), false); assert.equal(exported.legacyApp.hidden, false);
  assert.equal(exported.legacyApp.attributes.has('aria-hidden'), false);
  assert.deepEqual(JSON.parse(exported.embedded.textContent).accounts.map(row => row.account_id), ['QA-A']);
});
test('catalog transport, HTTP, parse or schema failure fails startup before loading shared adapters', async t => {
  for (const failure of ['network', 'http', 'json', 'schema']) await t.test(failure, async () => {
    const h = harness({ cachedStyles: true }); h.loadScript('/account-hierarchy.js'); await h.settle();
    if (failure === 'network') h.rejectCatalog(new Error('offline'));
    else h.resolveCatalog(failure === 'http' ? { ok: false } : failure === 'json' ? { jsonError: new Error('bad json') } : { data: { accounts: [{ account_id: 'INVALID ID', name: 'Invalid' }] } });
    assert.equal(await h.complete(), null); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
    assert.deepEqual(h.scripts.map(node => node.src), ['/account-hierarchy.js']); assert.equal(h.offlineProtected(), false);
  });
});
test('a resolved shared adapter with a null/noninteger version never reveals the workspace', async t => {
  for (const version of [null, undefined, '1', 1.5]) await t.test(String(version), async () => {
    const h = harness({ cachedStyles: true }); h.setSharedVersion(version); await h.throughSharedScripts();
    h.resolveShared(); assert.equal(await h.complete(), null);
    assert.equal(h.failed(), 1); assert.equal(h.ready(), 0); assert.equal(h.scripts.some(node => node.src === '/account-legacy-bridge.js'), false);
    assert.equal(h.offlineProtected(), false);
  });
});
test('rejected shared initialization fails startup without attempting the workspace', async () => {
  const h = harness({ cachedStyles: true }); await h.throughSharedScripts(); h.rejectShared(new Error('shared unavailable'));
  assert.equal(await h.complete(), null); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
  assert.equal(h.scripts.some(node => node.src === '/account-workspace.js'), false);
});
test('a stylesheet error is terminal even if all modules and other styles finish later', async () => {
  const h = harness(); h.loadStyle(1, true);
  assert.equal(await h.complete(), null); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
  h.loadStyle(0); h.loadStyle(2); await h.modules(); await h.settle();
  assert.equal(h.offlineProtected(), true); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
  for (const link of h.styleLinks) for (const listeners of link.listeners.values()) assert.equal(listeners.size, 0);
});
test('workspace requires explicit ready true together with its mounted root', async t => {
  for (const [label, ready, element] of [['missing flag', undefined, true], ['false flag', false, true], ['string flag', 'true', true], ['number flag', 1, true], ['missing root', true, false]]) await t.test(label, async () => {
    const h = harness({ cachedStyles: true });
    await h.throughSharedScripts(); h.resolveShared(); await h.settle(); h.loadScript('/account-legacy-bridge.js'); await h.settle();
    h.finishWorkspace(ready, element);
    assert.equal(await h.complete(), null); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
  });
});
test('script resource errors at every loading stage fail startup and stop later script injection', async t => {
  for (const [index, src] of scriptOrder.entries()) await t.test(src, async () => {
    const h = harness({ cachedStyles: true }); await h.modules({ failScript: src });
    assert.equal(await h.complete(), null); assert.equal(h.failed(), 1); assert.equal(h.ready(), 0);
    assert.deepEqual(h.scripts.map(node => node.src), scriptOrder.slice(0, index + 1));
    assert.equal(h.offlineProtected(), false); assert.equal(h.timers.size, 0);
  });
});
test('adapter timeout fails the gate and clears handlers without a real fifteen-second wait', async () => {
  const h = harness({ cachedStyles: true });
  const timer = [...h.timers.values()].find(item => item.ms === 15000); assert.ok(timer);
  timer.fn(); assert.equal(await h.complete(), null);
  assert.equal(h.failed(), 1); assert.equal(h.ready(), 0); assert.equal(h.scripts[0].onload, null); assert.equal(h.scripts[0].onerror, null);
});
test('missing initial dashboard data fails synchronously without requesting resources', () => {
  const h = harness({ cachedStyles: true, withDashboard: false });
  assert.equal(h.failed(), 1); assert.equal(h.ready(), 0); assert.equal(h.scripts.length, 0); assert.equal(h.fetches.length, 0);
});
