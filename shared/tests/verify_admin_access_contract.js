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

function loadAuthContext(email = '') {
  const sessionStorage = createStorage({
    ra_user: email ? JSON.stringify({ email }) : 'null',
  });
  const context = {
    console,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    localStorage: createStorage(),
    sessionStorage,
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

const adminContext = loadAuthContext(' SJLEE@IGISAM.COM ');
assert.equal(adminContext.RAAuth.isAdminUser(), true);

[
  'kabjoo.cho@igisam.com',
  'ethan.lee@igisam.com',
  'hshin@igisam.com',
  'minho@igisam.com',
  'patioblue@igisam.com',
  'user@igisam.com',
  '',
].forEach((email) => {
  const context = loadAuthContext(email);
  assert.equal(context.RAAuth.isAdminUser(), false, `${email || 'empty user'} must not be admin`);
});

const nonAdminContext = loadAuthContext('ethan.lee@igisam.com');
let promptCount = 0;
nonAdminContext.prompt = () => {
  promptCount += 1;
  return 'admin';
};
nonAdminContext.confirm = () => true;
nonAdminContext.alert = () => {};
nonAdminContext.renderResults = () => {};
nonAdminContext.sessionStorage.setItem('ra_asset_canonical_admin_enabled', '1');
vm.runInContext(
  fs.readFileSync(path.join(ROOT, '01. RA Portal', 'portfolio-analysis', 'js', 'asset-canonical.js'), 'utf8'),
  nonAdminContext,
  { filename: 'asset-canonical.js' },
);
assert.equal(nonAdminContext.AssetCanonical.isAdmin(), false);
nonAdminContext.AssetCanonical.adminLogin();
nonAdminContext.AssetCanonical.renameGroup('asset-test');
assert.equal(promptCount, 0, 'non-admin must not reach an admin prompt');

const sourceChecks = [
  ['portal.html', /RAAuth\?\.isAdminUser\?\.\(raUser\)/],
  ['05. Org Board/admin.html', /!window\.RAAuth\?\.isAdminUser\?\.\(user\)/],
  ['01. RA Portal/portfolio-analysis/js/asset-canonical.js', /function renderAdminBar\(container\) \{\s+if \(!isAuthorizedAdmin\(\)\) return;/s],
  ['05. Org Board/seat-layout.js', /\$\{authorizedAdmin \? `<button class="seat-admin-btn/s],
  ['05. Org Board/seat-layout.js', /async function saveAdminChanges\(\) \{\s+if \(!isAuthorizedAdmin\(\)\)/s],
];

sourceChecks.forEach(([relativePath, pattern]) => {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  assert.match(source, pattern, `${relativePath} must use the shared admin gate`);
});

console.log('Admin access contract verified: sjlee only; 7 non-admin identities rejected.');
