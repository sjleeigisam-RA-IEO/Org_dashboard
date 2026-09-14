'use strict';
const shared = require('./shared-db.cjs');
const ENTITY_FIELDS = {
  person: ['name', 'identity_status', 'notes'],
  affiliation: ['department', 'title', 'employment_status', 'started_on', 'ended_on', 'notes'],
  contact_point: ['kind', 'value', 'verification_status', 'notes'],
  preference: ['availability', 'scope', 'campaign_id', 'effective_from', 'effective_to', 'notes'],
  life_event: ['event_type', 'event_date', 'recurring', 'calendar', 'description', 'notes'],
  gift_recipient: ['item_id', 'plan_status', 'delivery_status', 'received_status', 'planned_amount', 'actual_amount', 'sent_on', 'received_on', 'notes'],
};
const CREATE_FIELDS = Object.fromEntries(Object.entries(ENTITY_FIELDS).filter(([entity]) => entity !== 'person').map(([entity, fields]) => [entity, [...fields, 'person_id', ...(entity === 'affiliation' ? ['account_id'] : ['affiliation_id']), ...(entity === 'gift_recipient' ? ['campaign_id'] : [])]]));
const ENUMS = {
  identity_status: ['unverified', 'verified', 'needs_review'], employment_status: ['unknown', 'current', 'former'],
  kind: ['mobile', 'phone', 'email', 'address', 'postcode'], verification_status: ['source_reported', 'unverified', 'conflict', 'verified'],
  availability: ['yes', 'no', 'unknown', 'not_applicable'], scope: ['campaign', 'ongoing', 'unknown'],
  event_type: ['birthday', 'wedding', 'bereavement', 'anniversary', 'other'], calendar: ['solar', 'lunar', 'unknown'],
  plan_status: ['listed', 'proposed', 'cancelled'], delivery_status: ['unknown', 'not_sent', 'sent', 'returned', 'cancelled'],
  received_status: ['unknown', 'received', 'not_received', 'declined'],
};
const NULLABLE = ['affiliation_id', 'campaign_id', 'item_id', 'started_on', 'ended_on', 'effective_from', 'effective_to', 'event_date', 'sent_on', 'received_on', 'planned_amount', 'actual_amount'];
const DATE_FIELDS = ['started_on', 'ended_on', 'effective_from', 'effective_to', 'event_date', 'sent_on', 'received_on'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const id = value => typeof value === 'string' && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);
function bad() { throw new Error('BAD_BODY'); }
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function commitBody(body) {
  if (!record(body) || Object.keys(body).some(k => !['action', 'entity', 'id', 'expectedRevision', 'patch', 'requestId'].includes(k))) bad();
  if (!['create', 'update'].includes(body.action) || !id(body.id) || !record(body.patch)) bad();
  const fields = (body.action === 'create' ? CREATE_FIELDS : ENTITY_FIELDS)[body.entity];
  if (!fields || !Object.keys(body.patch).length || Object.keys(body.patch).some(k => !fields.includes(k))) bad();
  if (!Number.isSafeInteger(body.expectedRevision) || (body.action === 'create' ? body.expectedRevision !== 0 : body.expectedRevision < 1)) bad();
  if (typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestId)) bad();
  for (const [key, value] of Object.entries(body.patch)) {
    if (value === null) { if (!NULLABLE.includes(key)) bad(); continue; }
    if (ENUMS[key]) { if (!ENUMS[key].includes(value)) bad(); }
    else if (DATE_FIELDS.includes(key)) { if (!date(value)) bad(); }
    else if (key === 'recurring') { if (typeof value !== 'boolean') bad(); }
    else if (['planned_amount', 'actual_amount'].includes(key)) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 99999999999999.99) bad(); }
    else if (key.endsWith('_id')) { if (!id(value)) bad(); }
    else if (typeof value !== 'string' || value.length > ({ notes: 10000, description: 2000, value: 3000, title: 1000, department: 1000, name: 200 }[key] || 200) || value.includes('\0')) bad();
  }
  if (body.action === 'create' && (!id(body.patch.person_id) || (body.entity === 'affiliation' && !id(body.patch.account_id)) || (body.entity === 'gift_recipient' && !id(body.patch.campaign_id)))) bad();
  if (body.entity === 'person' && body.patch.name !== undefined && !body.patch.name.trim()) bad();
  if (body.entity === 'contact_point' && body.patch.value !== undefined && !body.patch.value.trim()) bad();
  return body;
}
function readQuery(url) {
  const q = new URL(url, 'https://localhost').searchParams;
  const action = q.get('action') || 'catalog';
  if (!['catalog', 'account', 'person', 'search'].includes(action)) bad();
  const key = action === 'account' ? 'accountId' : 'personId';
  const entityId = ['account', 'person'].includes(action) ? q.get(key) : null;
  if (['account', 'person'].includes(action) && !id(entityId)) bad();
  const query = action === 'search' ? (q.get('q') || '').trim() : null;
  const limit = q.has('limit') ? Number(q.get('limit')) : 100;
  if (action === 'search' && (!query || query.length > 200 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)) bad();
  return { p_action: action, p_id: entityId, p_query: query, p_limit: limit };
}
function readView(raw, action) {
  if (!record(raw) || raw.status !== 'ok') throw new Error('DB_RESPONSE_INVALID');
  const array = key => { if (!Array.isArray(raw[key])) throw new Error('DB_RESPONSE_INVALID'); };
  if (action === 'catalog') {
    array('accounts'); if (!record(raw.totals)) throw new Error('DB_RESPONSE_INVALID');
    for (const name of ['top_level_accounts', 'grouped_accounts', 'groups']) {
      if (raw.totals[name] !== undefined && (!Number.isSafeInteger(raw.totals[name]) || raw.totals[name] < 0)) throw new Error('DB_RESPONSE_INVALID');
    }
  }
  if (action === 'account') {
    array('people'); if (!record(raw.account)) throw new Error('DB_RESPONSE_INVALID');
    // Optional until migration 006 is deployed, keeping rolling deployments safe.
    if (raw.children !== undefined) array('children');
    if (raw.parent_account !== undefined && raw.parent_account !== null && !record(raw.parent_account)) throw new Error('DB_RESPONSE_INVALID');
  }
  if (action === 'person') { if (!record(raw.person)) throw new Error('DB_RESPONSE_INVALID'); for (const key of ['affiliations', 'contact_points', 'receiving_preferences', 'life_events', 'gift_recipients', 'field_claims', 'source_records', 'audit']) array(key); }
  if (action === 'search') { array('people'); if (typeof raw.truncated !== 'boolean') throw new Error('DB_RESPONSE_INVALID'); }
  return raw;
}
function mutationView(raw) {
  if (!record(raw) || !['committed', 'noop', 'replayed', 'conflict'].includes(raw.status) || !record(raw.record) || !shared.positiveInt(raw.revision) || raw.record.revision !== raw.revision) throw new Error('DB_RESPONSE_INVALID');
  return raw;
}
module.exports = { commitBody, readQuery, readView, mutationView, ENTITY_FIELDS, CREATE_FIELDS };
