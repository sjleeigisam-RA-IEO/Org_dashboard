'use strict';
const DATASET_ID = 'rm-v1.7';
function settings() {
  const url = process.env.ONE_ACCOUNT_SUPABASE_URL || '';
  const key = process.env.ONE_ACCOUNT_SUPABASE_SECRET_KEY || '';
  if (process.env.ONE_ACCOUNT_SHARED_ENABLED !== 'true' || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) || !key.startsWith('sb_secret_')) throw new Error('DB_NOT_CONFIGURED');
  return { url: url.replace(/\/$/, ''), key, dataset: DATASET_ID };
}
async function rpc(name, args) {
  const { url, key } = settings();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('DB_REQUEST_FAILED');
    error.dbCode = typeof result?.code === 'string' ? result.code : '';
    throw error;
  }
  if (!isRecord(result)) throw new Error('DB_RESPONSE_INVALID');
  return result;
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function requireResponse(condition) { if (!condition) throw new Error('DB_RESPONSE_INVALID'); }
function textWithin(value, max, min = 0) { return typeof value === 'string' && value.length >= min && [...value].length <= max; }
function databaseEmail(value) {
  return textWithin(value, 254, 1) && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@igisam\.com$/.test(value);
}
function timestamp(value) {
  return textWithin(value, 64, 1) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
const ROLES = ['primary', 'backup', 'sponsor'];
const ROLE_FIELDS = ROLES.map(role => role + 'RmId');
function assignmentsView(value) {
  requireResponse(isRecord(value) && Object.keys(value).length <= 5000);
  return Object.fromEntries(Object.entries(value).map(([id, record]) => {
    requireResponse(textWithin(id, 200, 1) && isRecord(record));
    requireResponse(Object.keys(record).every(field => [...ROLE_FIELDS, 'updatedAtByRole'].includes(field)));
    requireResponse(ROLE_FIELDS.every(field => textWithin(record[field], 200)));
    const assigned = ROLE_FIELDS.map(field => record[field]).filter(Boolean);
    requireResponse(new Set(assigned).size === assigned.length);
    const view = Object.fromEntries(ROLE_FIELDS.map(field => [field, record[field]]));
    if (record.updatedAtByRole !== undefined) {
      const times = record.updatedAtByRole;
      // Baseline dates are source values; SQL preserves them and bounds their length.
      requireResponse(isRecord(times) && Object.entries(times).every(([role, date]) => ROLES.includes(role) && textWithin(date, 64)));
      view.updatedAtByRole = { ...times };
    }
    return [id, view];
  }));
}
function stateView(raw, actorEmail) {
  requireResponse(isRecord(raw) && raw.dataset_id === DATASET_ID);
  requireResponse(['ok', 'committed', 'noop', 'conflict', 'replayed'].includes(raw.status));
  if (raw.status === 'replayed') requireResponse(['committed', 'noop'].includes(raw.original_status));
  requireResponse(positiveInt(raw.revision) && positiveInt(raw.current_revision) && raw.current_revision >= raw.revision);
  requireResponse(timestamp(raw.updated_at) && databaseEmail(raw.actor_email) && databaseEmail(actorEmail));
  requireResponse(textWithin(raw.snapshot_id, 200, 1) && typeof raw.baseline_sha256 === 'string' && /^[a-f0-9]{64}$/.test(raw.baseline_sha256));
  const assignments = assignmentsView(raw.assignments);
  return {
    datasetId: DATASET_ID, revision: raw.revision, currentRevision: raw.current_revision,
    assignments, updatedAt: raw.updated_at, updatedBy: raw.actor_email,
    actorEmail, snapshotId: raw.snapshot_id, baselineSha256: raw.baseline_sha256,
    status: raw.status,
  };
}
function historyView(raw) {
  requireResponse(isRecord(raw) && raw.dataset_id === DATASET_ID && Array.isArray(raw.versions) && raw.versions.length <= 100);
  const cursor = raw.next_before_revision;
  requireResponse(cursor === null || (positiveInt(cursor) && cursor === raw.versions.at(-1)?.revision));
  const versions = raw.versions.map((v, index) => {
    requireResponse(isRecord(v) && positiveInt(v.revision) && (index === 0 || raw.versions[index - 1].revision > v.revision));
    requireResponse(timestamp(v.created_at) && databaseEmail(v.actor_email) && textWithin(v.note, 500));
    requireResponse(v.revision === 1
      ? v.action === 'baseline' && v.parent_revision === null
      : ['save', 'restore'].includes(v.action) && v.parent_revision === v.revision - 1);
    requireResponse(v.action === 'restore'
      ? positiveInt(v.restored_from_revision) && v.restored_from_revision < v.revision
      : v.restored_from_revision === null);
    requireResponse(Array.isArray(v.changes) && v.changes.length <= 15000);
    const seen = new Set();
    const changes = v.changes.map(c => {
      requireResponse(isRecord(c) && textWithin(c.account_id, 200, 1) && ROLES.includes(c.role));
      requireResponse([c.before_rm_id, c.after_rm_id].every(id => id === null || textWithin(id, 200, 1)) && c.before_rm_id !== c.after_rm_id);
      const identity = JSON.stringify([c.account_id, c.role]);
      requireResponse(!seen.has(identity)); seen.add(identity);
      return { accountId: c.account_id, role: c.role, beforeRmId: c.before_rm_id, afterRmId: c.after_rm_id };
    });
    return {
      revision: v.revision, parentRevision: v.parent_revision, createdAt: v.created_at,
      actorEmail: v.actor_email, action: v.action, note: v.note, restoredFromRevision: v.restored_from_revision,
      changes,
    };
  });
  return { versions, nextBeforeRevision: cursor };
}
async function readJson(req) {
  const max = 512 * 1024;
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json') || Number(req.headers['content-length'] || 0) > max) throw new Error('BAD_BODY');
  let raw;
  if (req.body !== undefined) raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
  else {
    const chunks = []; let size = 0;
    for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > max) throw new Error('BAD_BODY'); chunks.push(buffer); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw) > max) throw new Error('BAD_BODY');
  return JSON.parse(raw);
}
function positiveInt(value) { return Number.isSafeInteger(value) && value > 0; }
function commitBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('BAD_BODY');
  if (Object.keys(body).some(k => !['expectedRevision','assignments','restoreRevision','requestId','note'].includes(k))) throw new Error('BAD_BODY');
  if (!positiveInt(body.expectedRevision) || typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestId)) throw new Error('BAD_BODY');
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 500)) throw new Error('BAD_BODY');
  const restore = body.restoreRevision !== undefined;
  if (restore ? (!positiveInt(body.restoreRevision) || body.assignments !== undefined) : (!body.assignments || Array.isArray(body.assignments) || typeof body.assignments !== 'object')) throw new Error('BAD_BODY');
  if (!restore) {
    if (Object.keys(body.assignments).length > 1000) throw new Error('BAD_BODY');
    for (const [id, record] of Object.entries(body.assignments)) {
      if (id.length > 120 || !record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(k => !['primaryRmId','backupRmId','sponsorRmId','updatedAtByRole'].includes(k))) throw new Error('BAD_BODY');
      for (const field of ['primaryRmId','backupRmId','sponsorRmId']) if (record[field] !== undefined && (typeof record[field] !== 'string' || record[field].length > 120)) throw new Error('BAD_BODY');
    }
  }
  return { expected: body.expectedRevision, requestId: body.requestId, assignments: restore ? null : body.assignments, restore: restore ? body.restoreRevision : null, note: (body.note || '').trim() };
}
module.exports = { DATASET_ID, settings, rpc, stateView, historyView, readJson, positiveInt, commitBody };
