'use strict';

// This server-owned mask arrives before legacy CSS or scripts. Visibility keeps
// the existing layout measurable while the authenticated workspace is assembled.
const criticalStyle = '<style id="oa-startup-style" data-one-account-crm>' + [
  'html[data-oa-startup] body>:not(#oa-startup),html[data-oa-startup] body>:not(#oa-startup) *{visibility:hidden!important;pointer-events:none!important}',
  '#oa-startup{display:none}',
  'html[data-oa-startup] body>#oa-startup{visibility:visible!important;pointer-events:auto!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;margin:0!important;padding:28px!important;box-sizing:border-box!important;background:#f4f6f8!important;color:#193b50!important;text-align:center!important;font:14px/1.7 Arial,"Malgun Gothic",sans-serif!important}',
  '#oa-startup .oa-startup-brand{margin:0 0 12px!important;font-size:14px!important;font-weight:700!important;letter-spacing:2px!important;color:#193b50!important}',
  '#oa-startup #oa-startup-message{margin:0!important;color:#657d8d!important;font-size:13px!important}',
  '#oa-startup a{display:inline-block;margin-top:18px;padding:8px 14px;border:1px solid #b9cbd6;border-radius:5px;background:#fff;color:#176879;text-decoration:none}',
  '#oa-startup a:focus-visible{outline:3px solid #64afb8;outline-offset:3px}',
  '#oa-startup a[hidden]{display:none!important}'
].join('') + '</style>';

function startupController() {
  'use strict';
  var phase = 'loading';
  var root = document.documentElement;
  var timer;
  function retryUrl() {
    var location = window.location;
    try {
      if (window.parent !== window && window.parent.location.origin === window.location.origin) location = window.parent.location;
    } catch (_) { /* A cross-origin host cannot supply a route. */ }
    return '/app' + (location.search || '');
  }
  function render() {
    var loader = document.getElementById('oa-startup');
    if (phase === 'ready') { if (loader) loader.remove(); return; }
    var message = document.getElementById('oa-startup-message');
    var retry = document.getElementById('oa-startup-retry');
    if (message) message.textContent = phase === 'failed' ? '화면을 불러오지 못했습니다. 다시 불러와 주세요.' : '고객 관계 관리 화면을 불러오는 중입니다.';
    if (retry) { retry.href = retryUrl(); retry.hidden = phase !== 'failed'; }
  }
  function ready() {
    phase = 'ready'; clearTimeout(timer); root.removeAttribute('data-oa-startup'); render();
  }
  function fail() {
    if (phase === 'ready') return;
    phase = 'failed'; clearTimeout(timer); root.setAttribute('data-oa-startup', 'failed'); render();
  }
  window.OneAccountStartup = { ready: ready, fail: fail };
  timer = setTimeout(fail, 45000);
  document.addEventListener('error', function (event) {
    if (event.target && event.target.id === 'oa-crm-bootstrap') fail();
  }, true);
  document.addEventListener('DOMContentLoaded', render, { once: true });
}

const controller = '<script id="oa-startup-controller" data-one-account-crm>(' + startupController.toString() + ')();</script>';
const stylesheets = [
  '<link id="oa-shared-styles" rel="stylesheet" data-one-account-crm data-one-account-shared href="/shared-teams.css">',
  '<link id="oa-crm-styles" rel="stylesheet" data-one-account-crm href="/crm.css">',
  '<link id="oa-workspace-styles" rel="stylesheet" data-one-account-crm href="/account-workspace.css">'
].join('');
const loader = '<section id="oa-startup" data-one-account-crm aria-label="One Account 시작"><div><p class="oa-startup-brand">ONE ACCOUNT</p><p id="oa-startup-message" role="status" aria-live="polite">고객 관계 관리 화면을 불러오는 중입니다.</p><a id="oa-startup-retry" href="/app" target="_top" hidden>다시 불러오기</a></div></section>';
const bootstrap = '<script id="oa-crm-bootstrap" data-one-account-crm src="/crm-bootstrap.js"></script>';

function prepareDashboard(html) {
  if (typeof html !== 'string') throw new Error('BAD_DOCUMENT');
  // Raw-text elements and comments may contain literal </body> strings. Ignore
  // those and validate the actual document envelope before inserting adapters.
  const structural = [];
  const tokens = /<!--[\s\S]*?-->|<(script|style|title|textarea)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<\/?(html|head|body)\b(?:"[^"]*"|'[^']*'|[^'">])*?>/gi;
  let match;
  while ((match = tokens.exec(html))) {
    if (!match[2]) continue;
    structural.push({ name: (match[0].startsWith('</') ? '/' : '') + match[2].toLowerCase(), start: match.index, end: tokens.lastIndex, tag: match[0] });
  }
  if (structural.map(item => item.name).join(',') !== 'html,head,/head,body,/body,/html' || /\bdata-oa-startup\b/i.test(structural[0].tag)) throw new Error('BAD_DOCUMENT');
  const [htmlTag, headTag, , bodyTag, bodyClose] = structural;
  const edits = [
    { start: htmlTag.start, end: htmlTag.end, value: htmlTag.tag.slice(0, -1) + ' data-oa-startup="loading">' },
    { start: headTag.end, end: headTag.end, value: criticalStyle + controller + stylesheets },
    { start: bodyTag.end, end: bodyTag.end, value: loader },
    { start: bodyClose.start, end: bodyClose.start, value: bootstrap }
  ];
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + edit.value + html.slice(edit.end);
  return html;
}

module.exports = prepareDashboard;
module.exports.prepareDashboard = prepareDashboard;
