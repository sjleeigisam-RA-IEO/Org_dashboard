const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function loadAuthContext(user) {
  const context = {
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    localStorage: createStorage(),
    sessionStorage: createStorage({ ra_user: JSON.stringify(user) }),
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'shared', 'ra-auth.js'), 'utf8'),
    context,
    { filename: 'shared/ra-auth.js' },
  );
  return context;
}

assert.equal(loadAuthContext({ email: 'executive@igisam.com', is_executive: true }).RAAuth.isExecutiveUser(), true);
assert.equal(loadAuthContext({ email: 'staff@igisam.com', is_executive: false }).RAAuth.isExecutiveUser(), false);
assert.equal(loadAuthContext({ email: 'legacy-session@igisam.com' }).RAAuth.isExecutiveUser(), false);
assert.equal(loadAuthContext({ email: 'tampered@igisam.com', is_executive: 'true' }).RAAuth.isExecutiveUser(), false);

const sourceChecks = [
  ['supabase/functions/ra-auth/index.ts', /\| "session-profile"/],
  ['supabase/functions/ra-auth/index.ts', /select=staff_id,employee_no,name,email,position,title,status/],
  ['supabase/functions/ra-auth/index.ts', /is_executive: isExecutiveStaff\(staff\)/],
  ['supabase/functions/ra-auth/index.ts', /const EXECUTIVE_TITLES = new Set/],
  ['supabase/functions/ra-auth/index.ts', /const EXECUTIVE_POSITIONS = new Set/],
  ['shared/ra-auth.js', /request\("session-profile", \{ session_token: token \}\)/],
  ['01. RA Portal/portfolio-analysis/index-v2.html', /id="v2T5TLink"[^>]+hidden[^>]+style="display:none;"/],
  ['01. RA Portal/portfolio-analysis/index-v2.html', /RAAuth\.refreshSessionUser\(\)/],
  ['01. RA Portal/portfolio-analysis/index-v2.html', /RAAuth\.isExecutiveUser\(user\)/],
  ['security-lite.js', /function isT5TDashboardPath\(\)/],
  ['security-lite.js', /executiveRequired && data\.user\?\.is_executive !== true/],
  ['security-lite.js', /redirectToPortal\(\)/],
  ['portal.html', /if \(id === 't5t' && !executiveAccess\) return;/],
  ['portal.html', /executiveAccess = window\.RAAuth\?\.isExecutiveUser\?\.\(raUser\) === true/],
];

sourceChecks.forEach(([relativePath, pattern]) => {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  assert.match(source, pattern, `${relativePath} must preserve the executive-only T5T gate`);
});

const t5tHtml = fs.readFileSync(path.join(ROOT, '02. T5T Board', 'index.html'), 'utf8');
const authScriptIndex = t5tHtml.indexOf('../security-lite.js?v=t5t_exec_gate_1');
assert.ok(authScriptIndex > 0 && authScriptIndex < t5tHtml.indexOf('</head>'), 'T5T role gate must load before page content');
assert.match(t5tHtml, /data-t5t-auth="pending"/);
assert.match(t5tHtml, /functions\.supabase\.co/);

console.log('T5T executive access contract verified.');
