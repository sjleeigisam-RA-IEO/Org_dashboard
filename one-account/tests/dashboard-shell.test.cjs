'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { prepareDashboard } = require('../lib/dashboard-shell.cjs');

const source = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>.app{width:900px}</style></head><body class="original"><main class="app">Legacy fixture</main><script>window.fixture = "</body>";</script></body></html>';
function startupHarness(options = {}) {
  const prepared = prepareDashboard(source);
  const code = prepared.match(/<script\b[^>]*id="oa-startup-controller"[^>]*>([\s\S]*?)<\/script>/)[1];
  const root = { attributes: { 'data-oa-startup': 'loading' }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  const loader = { removed: false, remove() { this.removed = true; } };
  const message = { textContent: '' }, retry = { hidden: true, href: '', target: '_top' }, events = {}, captures = {}, timers = [];
  let bodyAvailable = options.bodyAvailable !== false;
  const location = { origin: 'https://one-account.invalid', search: options.search || '?account=DIRECT', href: 'https://one-account.invalid/api/dashboard' };
  const sandbox = {
    document: { documentElement: root, getElementById(id) { if (!bodyAvailable) return null; return { 'oa-startup': loader, 'oa-startup-message': message, 'oa-startup-retry': retry }[id] || null; }, addEventListener(name, callback, capture) { events[name] = callback; captures[name] = capture; } },
    location, URL,
    setTimeout(callback, ms) { const timer = { callback, ms, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; }
  };
  sandbox.window = sandbox;
  if (options.inaccessibleParent) { sandbox.parent = {}; Object.defineProperty(sandbox.parent, 'location', { get() { throw new Error('cross origin'); } }); }
  else sandbox.parent = options.parentSearch ? { location: { origin: location.origin, search: options.parentSearch } } : sandbox;
  vm.runInNewContext(code, sandbox);
  return { api: sandbox.OneAccountStartup, root, loader, message, retry, timers, captures, resourceError(id) { events.error?.({ target: { id } }); }, bodyReady() { bodyAvailable = true; events.DOMContentLoaded?.(); } };
}

test('the startup mask is the first head content and the loader precedes the measurable legacy app', () => {
  const output = prepareDashboard(source);
  assert.match(output, /<html lang="ko" data-oa-startup="loading">/);
  assert.match(output, /<head><style id="oa-startup-style" data-one-account-crm>/);
  assert.ok(output.indexOf('id="oa-startup-controller"') < output.indexOf('<meta charset="utf-8">'));
  for (const href of ['/shared-teams.css', '/crm.css', '/account-workspace.css']) {
    const link = output.match(new RegExp('<link[^>]+href="' + href.replace('.', '\\.') + '"[^>]*>'))[0];
    assert.match(link, /data-one-account-crm/);
    assert.ok(output.indexOf(link) < output.indexOf('</head>'));
  }
  assert.ok(output.indexOf('id="oa-startup"') > output.indexOf('<body class="original">'));
  assert.ok(output.indexOf('id="oa-startup"') < output.indexOf('<main class="app">'));
  assert.match(output, /body\s*>\s*:not\(#oa-startup\)[^{]*\{visibility:hidden!important;pointer-events:none!important\}/);
  assert.match(output, /body\s*>\s*:not\(#oa-startup\)\s*\*/);
  assert.doesNotMatch(output, /body\s*>\s*:not\(#oa-startup\)[^{]*\{[^}]*display:none/);
  assert.match(output, /<script>window.fixture = "<\/body>";<\/script><script id="oa-crm-bootstrap" data-one-account-crm src="\/crm-bootstrap.js"><\/script><\/body>/);
});

test('watchdog failure keeps the mask and uses the parent route query for the dashboard retry', () => {
  const h = startupHarness({ parentSearch: '?account=A&person=P&tab=information' });
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 45000);
  h.timers[0].callback();
  assert.equal(h.root.attributes['data-oa-startup'], 'failed');
  assert.equal(h.loader.removed, false); assert.equal(h.retry.hidden, false);
  assert.equal(h.retry.href, '/app?account=A&person=P&tab=information');
  assert.match(prepareDashboard(source), /id="oa-startup-retry"[^>]*target="_top"/);
  assert.match(h.message.textContent, /불러오지 못했습니다/);
  assert.equal(h.timers[0].cancelled, true);
});

test('ready reveals the completed workspace and ignores a stale timeout or later failure', () => {
  const h = startupHarness(); h.api.ready();
  assert.equal(h.root.attributes['data-oa-startup'], undefined);
  assert.equal(h.loader.removed, true); assert.equal(h.timers[0].cancelled, true);
  h.timers[0].callback(); h.api.fail();
  assert.equal(h.root.attributes['data-oa-startup'], undefined);
});

test('early failure renders when body arrives and inaccessible parents fall back to the current query', () => {
  const h = startupHarness({ bodyAvailable: false, inaccessibleParent: true, search: '?account=FALLBACK&view=rm' });
  assert.doesNotThrow(() => h.api.fail()); assert.equal(h.root.attributes['data-oa-startup'], 'failed');
  h.bodyReady(); assert.equal(h.retry.hidden, false); assert.equal(h.retry.href, '/app?account=FALLBACK&view=rm');
  h.api.ready(); assert.equal(h.loader.removed, true); assert.equal(h.root.attributes['data-oa-startup'], undefined);
});

test('bootstrap resource failure immediately fails closed while unrelated resource errors leave startup pending', () => {
  const h = startupHarness();
  assert.equal(h.captures.error, true);
  h.resourceError('optional-icon'); assert.equal(h.root.attributes['data-oa-startup'], 'loading');
  h.resourceError('oa-crm-bootstrap'); assert.equal(h.root.attributes['data-oa-startup'], 'failed');
  assert.equal(h.retry.hidden, false); assert.equal(h.timers[0].cancelled, true);
});

test('structural validation rejects missing, repeated, out-of-order and already prepared document markers', () => {
  assert.equal(require('../lib/dashboard-shell.cjs'), prepareDashboard);
  for (const input of [null, '', '<body>fragment</body>', source.replace('</head>', ''), source.replace('</body></html>', '</body><body></body></html>'), source.replace('<head>', '<body>'), prepareDashboard(source)]) assert.throws(() => prepareDashboard(input), /BAD_DOCUMENT/);
  const alternate = '<!doctype html><!-- <body>comment</body> --><HTML lang="ko"><HEAD><title>Test</title></HEAD><BODY data-note=">">Fixture</BODY></HTML>';
  assert.match(prepareDashboard(alternate), /<HTML lang="ko" data-oa-startup="loading">/);
});

test('the authenticated dashboard route delegates HTML adaptation without changing its gzip or auth paths', () => {
  const api = fs.readFileSync(require.resolve('../api/dashboard.js'), 'utf8');
  assert.match(api, /require\('\.\.\/lib\/dashboard-shell\.cjs'\)/);
  assert.match(api, /zlib\.gzipSync\(prepareDashboard\(html\)\)/);
  assert.match(api, /if \(!auth\.readSession\(req\)\)/);
  assert.match(api, /supportsGzip\(req\.headers\['accept-encoding'\]\)/);
  assert.match(api, /await pipeline\(Readable\.from\(\[data\]\), zlib\.createGunzip\(\), res\)/);
});
