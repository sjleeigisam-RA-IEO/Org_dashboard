const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = Number(process.argv[2] || 8766);
const ONLINE_WINDOW_MINUTES = 5;
const ASSET_MAP_PAGE_SIZE = 500;
const ASSET_MAP_MAX_ROWS = 10000;
const ASSET_MAP_SELECT = [
  'asset_id', 'asset_code', 'canonical_name', 'asset_type',
  'portfolio_region', 'location_subject_type',
  'normalized_country_name', 'country_code_alpha3',
  'normalized_city', 'normalized_admin1', 'raw_city', 'latitude', 'longitude',
  'coordinate_precision', 'coordinate_confidence', 'coordinate_source',
  'review_status', 'is_map_eligible', 'location_tier', 'location_status_label',
].join(',');
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const env = readEnv(path.join(ROOT, '.env'));
const supabaseUrl = env.SUPABASE_URL;
const supabaseSecret = env.SUPABASE_SECRET_KEY || env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseSecret) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required in .env');
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${HOST}:${PORT}`);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { error: 'Method not allowed' });
    }
    if (requestUrl.pathname === '/__ra_access_snapshot') {
      return await serveAccessSnapshot(request, response);
    }
    if (requestUrl.pathname === '/__ra_asset_map_snapshot') {
      return await serveAssetMapSnapshot(request, response);
    }
    return serveStatic(requestUrl.pathname, request, response);
  } catch (error) {
    console.error('[local-access-monitor]', error.message || error);
    return sendJson(response, 500, { error: '로컬 접속 현황을 불러오지 못했습니다.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RA local access monitor: http://${HOST}:${PORT}/portal.html`);
  console.log('This server is bound to localhost only.');
});

async function serveAccessSnapshot(request, response) {
  const remoteAddress = request.socket.remoteAddress || '';
  if (!isLoopback(remoteAddress)) return sendJson(response, 403, { error: 'Local access only' });

  const now = new Date();
  const onlineSince = new Date(now.getTime() - ONLINE_WINDOW_MINUTES * 60 * 1000);
  const [staffRows, sessionRows] = await Promise.all([
    querySupabase('staff', 'select=staff_id,employee_no,name,email,status,last_login,login_count&order=last_login.desc.nullslast'),
    querySupabase('ra_auth_sessions', `select=staff_id,created_at,last_seen_at,expires_at,revoked_at&revoked_at=is.null&expires_at=gt.${encodeURIComponent(now.toISOString())}&order=last_seen_at.desc`),
  ]);

  const latestSessionByStaff = new Map();
  const activeSessionCountByStaff = new Map();
  for (const session of sessionRows) {
    activeSessionCountByStaff.set(session.staff_id, (activeSessionCountByStaff.get(session.staff_id) || 0) + 1);
    const current = latestSessionByStaff.get(session.staff_id);
    if (!current || new Date(session.last_seen_at) > new Date(current.last_seen_at)) {
      latestSessionByStaff.set(session.staff_id, session);
    }
  }

  const visitors = staffRows.filter((staff) => (
    staff.last_login || Number(staff.login_count || 0) > 0 || latestSessionByStaff.has(staff.staff_id)
  )).map((staff) => {
    const session = latestSessionByStaff.get(staff.staff_id);
    const lastSeenAt = session?.last_seen_at || null;
    return {
      staff_id: staff.staff_id,
      employee_no: staff.employee_no || null,
      name: staff.name,
      email: String(staff.email || '').trim().toLowerCase(),
      status: staff.status || null,
      last_login_at: staff.last_login || lastSeenAt,
      login_count: Math.max(Number(staff.login_count || 0), activeSessionCountByStaff.get(staff.staff_id) || 0),
      online: Boolean(lastSeenAt && new Date(lastSeenAt) >= onlineSince),
      session_active: Boolean(session),
      last_seen_at: lastSeenAt,
    };
  });

  visitors.sort((left, right) => {
    if (left.online !== right.online) return left.online ? -1 : 1;
    if (left.session_active !== right.session_active) return left.session_active ? -1 : 1;
    return String(right.last_login_at || '').localeCompare(String(left.last_login_at || ''));
  });

  return sendJson(response, 200, {
    ok: true,
    source: 'local-secure-proxy',
    generated_at: now.toISOString(),
    online_window_minutes: ONLINE_WINDOW_MINUTES,
    visitors,
  });
}

async function serveAssetMapSnapshot(request, response) {
  const remoteAddress = request.socket.remoteAddress || '';
  if (!isLoopback(remoteAddress)) return sendJson(response, 403, { error: 'Local access only' });

  const assets = [];
  for (let offset = 0; offset < ASSET_MAP_MAX_ROWS; offset += ASSET_MAP_PAGE_SIZE) {
    const page = await querySupabase(
      'asset_map_location_progressive_v1',
      `select=${ASSET_MAP_SELECT}&order=location_tier.asc,asset_id.asc&limit=${ASSET_MAP_PAGE_SIZE}&offset=${offset}`,
    );
    assets.push(...page);
    if (page.length < ASSET_MAP_PAGE_SIZE) break;
  }
  if (assets.length >= ASSET_MAP_MAX_ROWS) {
    throw new Error('Asset map projection exceeds the supported population');
  }

  return sendJson(response, 200, {
    ok: true,
    source: 'local-secure-proxy',
    generated_at: new Date().toISOString(),
    count: assets.length,
    assets,
  });
}

async function querySupabase(table, query) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: supabaseSecret,
      'User-Agent': 'ra-local-access-monitor/1.0',
    },
  });
  if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function serveStatic(pathname, request, response) {
  const decodedPath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const pathSegments = decodedPath.split('/').filter(Boolean);
  if (pathSegments.some((segment) => segment.startsWith('.'))) {
    return sendJson(response, 404, { error: 'Not found' });
  }
  let filePath = path.resolve(ROOT, `.${decodedPath}`);
  if (!isInsideRoot(filePath)) return sendJson(response, 403, { error: 'Forbidden' });

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(response, 404, { error: 'Not found' });
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function isInsideRoot(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readEnv(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}
