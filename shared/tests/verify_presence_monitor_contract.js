const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const authFunction = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'ra-auth', 'index.ts'), 'utf8');
const sharedAuth = fs.readFileSync(path.join(ROOT, 'shared', 'ra-auth.js'), 'utf8');
const securityLite = fs.readFileSync(path.join(ROOT, 'security-lite.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(ROOT, '05. Org Board', 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(ROOT, '05. Org Board', 'admin.js'), 'utf8');
const rootLogin = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const constructionDashboard = fs.readFileSync(path.join(ROOT, '03. Construction Board', 'index.html'), 'utf8');
const localServer = fs.readFileSync(path.join(ROOT, 'tools', 'local_access_monitor_server.js'), 'utf8');

assert.match(authFunction, /\| "heartbeat"/);
assert.match(authFunction, /\| "admin-check"/);
assert.match(authFunction, /\| "admin-access-list"/);
assert.match(authFunction, /async function requireAdminSession\(token: string\)/);
assert.match(authFunction, /normalizeEmail\(admin\.email\) !== ADMIN_EMAIL/);
assert.match(authFunction, /FORBIDDEN: 관리자만 접속 현황을 확인할 수 있습니다\./);
assert.match(authFunction, /ONLINE_WINDOW_MINUTES = 5/);
assert.match(authFunction, /async function maybeCreateSession\(staff: StaffRow, remember: boolean, presence: boolean\)/);
assert.match(authFunction, /if \(!remember && !presence\) return null/);
assert.match(authFunction, /"Cache-Control": "no-store"/);

assert.match(sharedAuth, /SESSION_TOKEN_KEY = "ra_session_token"/);
assert.match(sharedAuth, /request\("heartbeat", \{ session_token: token \}\)/);
assert.match(securityLite, /sendHeartbeat\(true\)/);
assert.match(securityLite, /return Boolean\(user && getSessionToken\(\)\)/);
assert.match(rootLogin, /presence: true/);
assert.match(rootLogin, /saveSessionToken\(data\.session_token, remember\)/);
assert.match(constructionDashboard, /RAAuth\.startPresence\(\)/);

assert.match(adminHtml, /data-sort="presence"/);
assert.match(adminHtml, /현재 접속 중/);
assert.match(adminHtml, /id="sessionCount"/);
assert.match(adminHtml, /누적 접속/);
assert.match(adminHtml, /RAAuth\.request\('admin-access-list'/);
assert.match(adminHtml, /__RA_ADMIN_ACCESS_SNAPSHOT__/);
assert.match(adminJs, /RAAuth\.request\('admin-access-list'/);
assert.match(adminJs, /window\.__RA_ADMIN_ACCESS_SNAPSHOT__/);
assert.match(adminJs, /fetch\('\/__ra_access_snapshot'/);
assert.match(adminJs, /30 \* 1000/);
assert.match(adminJs, /access === 'online'/);
assert.match(adminJs, /sortConfig = \{ key: 'last_login', direction: 'desc' \}/);
assert.match(adminJs, /sortStaffRows\(filteredStaff\)/);
assert.match(adminJs, /getStaffLastLogin\(staff\)/);

assert.match(localServer, /HOST = '127\.0\.0\.1'/);
assert.match(localServer, /pathname === '\/__ra_access_snapshot'/);
assert.match(localServer, /segment\.startsWith\('\.'\)/);
assert.match(localServer, /latestSessionByStaff\.has\(staff\.staff_id\)/);
assert.match(localServer, /activeSessionCountByStaff/);

console.log('Presence monitor contract verified: secure admin list, local-only proxy, 5-minute online state, and 30-second refresh.');
