'use strict';
const shared = require('./shared-db.cjs');
const ROLES = ['primary', 'backup', 'sponsor'];
const FIELDS = ROLES.map(role => role + 'RmId');
const CLASSIFICATIONS = ['P', 'I', 'S', 'C', 'F', 'H', '미Account'];
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const text = (v, max, min = 0) => typeof v === 'string' && [...v].length >= min && [...v].length <= max && !/[\u0000-\u001f]/.test(v);
const id = v => text(v, 200, 1);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function requireValue(condition, error = 'BAD_BODY') { if (!condition) throw new Error(error); }
function readQuery(url) {
  const q = new URL(url, 'https://localhost').searchParams;
  requireValue([...q.keys()].every(k => ['action', 'accountId'].includes(k)) && [...q.keys()].length === new Set(q.keys()).size);
  requireValue(['team', 'metadata'].includes(q.get('action')) && id(q.get('accountId')));
  return { p_action: q.get('action'), p_account_id: q.get('accountId'), p_dataset_id: shared.DATASET_ID };
}
function commitBody(body) {
  requireValue(record(body) && ['save-team', 'update-account', 'create-person'].includes(body.action));
  const fields = ['action', 'accountId', 'patch', 'requestId', ...(body.action !== 'create-person' ? ['expectedRevision'] : []), ...(body.action === 'save-team' ? ['note'] : [])];
  requireValue(Object.keys(body).every(k => fields.includes(k)) && id(body.accountId) && uuid(body.requestId) && record(body.patch));
  requireValue(body.action === 'create-person' || shared.positiveInt(body.expectedRevision));
  const allowed = body.action === 'save-team' ? FIELDS : body.action === 'update-account' ? ['name', 'piscfh', 'notes'] : ['name', 'department', 'title'];
  requireValue(Object.keys(body.patch).length > 0 && Object.keys(body.patch).every(k => allowed.includes(k)));
  for (const [key, value] of Object.entries(body.patch)) {
    if (key === 'notes') requireValue(typeof value === 'string' && [...value].length <= 10000 && !value.includes('\0'));
    else if (key === 'piscfh') requireValue(CLASSIFICATIONS.includes(value));
    else requireValue(text(value, key === 'name' ? (body.action === 'create-person' ? 200 : 300) : ['department', 'title'].includes(key) ? 1000 : 200) && (key !== 'name' || !!value.trim()));
  }
  if (body.action === 'create-person') requireValue(Object.hasOwn(body.patch, 'name'));
  if (body.action === 'save-team') requireValue(body.note === undefined || (typeof body.note === 'string' && [...body.note].length <= 500 && !body.note.includes('\0')));
  return { ...body, ...(body.action === 'save-team' ? { note: (body.note || '').trim() } : {}) };
}
function view(raw, action) {
  const ok = c => requireValue(c, 'DB_RESPONSE_INVALID');
  ok(record(raw) && ['ok', 'committed', 'noop', 'replayed', 'conflict'].includes(raw.status));
  if (raw.status === 'replayed') ok(['committed', 'noop'].includes(raw.originalStatus));
  if (['team', 'save-team'].includes(action)) {
    ok(id(raw.accountId) && shared.positiveInt(raw.accountRevision) && shared.positiveInt(raw.currentRevision) && record(raw.team));
    ok(FIELDS.every(k => text(raw.team[k], 200)) && record(raw.team.updatedAtByRole));
    const assigned = FIELDS.map(k => raw.team[k]).filter(Boolean); ok(new Set(assigned).size === assigned.length);
    const team = Object.fromEntries(FIELDS.map(k => [k, raw.team[k]]));
    team.updatedAtByRole = Object.fromEntries(Object.entries(raw.team.updatedAtByRole).filter(([k, v]) => ROLES.includes(k) && text(v, 64)));
    ok(Array.isArray(raw.candidates) && raw.candidates.every(r => record(r) && id(r.rmId) && text(r.name, 300, 1) && Array.isArray(r.roles) && r.roles.every(role => ROLES.includes(role))));
    ok(Array.isArray(raw.history));
    const history = raw.history.map(h => {
      ok(record(h) && shared.positiveInt(h.revision) && Array.isArray(h.changes));
      return { revision: h.revision, createdAt: h.createdAt, actorEmail: h.actorEmail, action: h.action, note: h.note, changes: h.changes.map(c => {
        ok(record(c) && ROLES.includes(c.role) && [c.beforeRmId, c.afterRmId].every(v => v === null || id(v)));
        return { role: c.role, beforeRmId: c.beforeRmId, afterRmId: c.afterRmId };
      }) };
    });
    return { status: raw.status, ...(raw.originalStatus ? { originalStatus: raw.originalStatus } : {}), accountId: raw.accountId, accountRevision: raw.accountRevision, currentRevision: raw.currentRevision, team, candidates: raw.candidates.map(r => ({ rmId: r.rmId, name: r.name, roles: r.roles })), history };
  }
  if (['metadata', 'update-account'].includes(action)) {
    const a = raw.account; ok(record(a) && id(a.accountId) && text(a.name, 300, 1) && shared.positiveInt(a.revision) && Array.isArray(a.aliases) && typeof a.notes === 'string' && Array.isArray(raw.history));
    const verified = raw.privacy?.identityVerified === true && raw.privacy?.canEdit === true && raw.privacy?.detailAccess === 'verified';
    return { status: raw.status, ...(raw.originalStatus ? { originalStatus: raw.originalStatus } : {}), privacy: { detailAccess: verified ? 'verified' : 'locked', identityVerified: verified, canEdit: verified }, account: { accountId: a.accountId, name: a.name, piscfh: a.piscfh, aliases: a.aliases.filter(v => typeof v === 'string'), notes: verified ? a.notes : '', notesMasked: verified ? '' : a.notesMasked === '*' || a.notes.trim() ? '*' : '', revision: a.revision, profileRevision: a.profileRevision, isExisting: a.isExisting, isPlaceholder: a.isPlaceholder, accountKind: a.accountKind }, history: raw.history.map(h => {
      ok(record(h) && Array.isArray(h.changedFields));
      return { auditId: h.auditId, revision: h.revision, entityType: h.entityType, entityId: h.entityId, createdAt: h.createdAt, actorEmail: h.actorEmail, action: h.action, changedFields: h.changedFields.filter(k => typeof k === 'string') };
    }) };
  }
  ok(action === 'create-person' && id(raw.accountId) && id(raw.personId) && id(raw.affiliationId) && record(raw.person) && record(raw.affiliation));
  ok(raw.person.person_id === raw.personId && raw.affiliation.affiliation_id === raw.affiliationId && raw.affiliation.person_id === raw.personId && raw.affiliation.account_id === raw.accountId);
  return { status: raw.status, ...(raw.originalStatus ? { originalStatus: raw.originalStatus } : {}), accountId: raw.accountId, personId: raw.personId, affiliationId: raw.affiliationId, person: raw.person, affiliation: raw.affiliation };
}
module.exports = { readQuery, commitBody, view, CLASSIFICATIONS };
