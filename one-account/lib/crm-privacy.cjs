'use strict';

// Shared-code login does not verify mailbox ownership. No session claim,
// caller-supplied email, query flag, or environment switch unlocks CRM details.
// A future verified-identity flow must replace this explicit locked policy.
const PRIVATE_ARRAYS = ['contact_points', 'receiving_preferences', 'gift_recipients', 'life_events', 'field_claims', 'source_records', 'audit'];
const locked = () => ({ detailAccess: 'locked', identityVerified: false, canEdit: false });
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
const strings = (row, keys) => Object.fromEntries(keys.filter(key => own(row, key) && typeof row[key] === 'string').map(key => [key, row[key]]));
const integers = (row, keys) => Object.fromEntries(keys.filter(key => own(row, key) && Number.isSafeInteger(row[key]) && row[key] >= 0).map(key => [key, row[key]]));
const booleans = (row, keys) => Object.fromEntries(keys.filter(key => own(row, key) && typeof row[key] === 'boolean').map(key => [key, row[key]]));
const array = value => Array.isArray(value) ? value : [];
const emptyPrivateArrays = () => Object.fromEntries(PRIVATE_ARRAYS.map(key => [key, []]));
const contactCount = row => Array.isArray(row?.contact_points) ? row.contact_points.length
  : Number.isSafeInteger(row?.contact_count) && row.contact_count >= 0 ? row.contact_count : 0;
const CONTACT_KINDS = new Set(['mobile', 'phone', 'email', 'address', 'postcode']);
const rows = value => array(value).filter(row => row && typeof row === 'object' && !Array.isArray(row));

// Preserve whether a supported scalar was recorded, never its value or length.
// Database enum 'unknown' is absence; explicit no/false and an amount of 0 exist.
function mask(value) {
  if (typeof value === 'string') return value.trim() && value.trim().toLowerCase() !== 'unknown' ? '*' : '';
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? '*' : '';
}
function maskedField(row, ...keys) {
  return keys.some(key => own(row, key) && mask(row[key]) === '*') ? '*' : '';
}
function maskedFields(row, keys) {
  return Object.fromEntries(keys.map(key => [key, maskedField(row, key)]));
}
function maskedDetails(raw) {
  return {
    contacts: rows(raw.contact_points).filter(row => CONTACT_KINDS.has(row.kind))
      .map(row => ({ kind: row.kind, value: maskedField(row, 'value') })),
    preferences: rows(raw.receiving_preferences).map(row => ({
      campaign: maskedField(row, 'campaign_name', 'campaign_label', 'campaign_id'),
      ...maskedFields(row, ['availability', 'scope', 'effective_from', 'effective_to']),
    })),
    gifts: rows(raw.gift_recipients).map(row => ({
      campaign: maskedField(row, 'campaign_name', 'campaign_label', 'campaign_id'),
      send_target: maskedField(row, 'send_target'), item: maskedField(row, 'item_name', 'gift_name', 'item_id'),
      ...maskedFields(row, ['planned_amount', 'actual_amount', 'delivery_status', 'received_status', 'sent_on', 'received_on']),
    })),
    life_events: rows(raw.life_events).map(row => maskedFields(row, ['event_type', 'event_date', 'description'])),
  };
}

function account(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const result = {
    ...strings(row, ['account_id', 'name', 'piscfh', 'contact_account_id', 'parent_account_id', 'account_kind', 'hierarchy_label']),
    ...integers(row, ['revision', 'people_count', 'children_count']),
    ...booleans(row, ['is_existing', 'is_placeholder']),
  };
  for (const key of ['contact_account_id', 'parent_account_id']) if (row[key] === null) result[key] = null;
  if (Array.isArray(row.aliases)) result.aliases = row.aliases
    .map(alias => typeof alias === 'string' ? alias : typeof alias?.name === 'string' ? alias.name : null)
    .filter(alias => alias !== null);
  // The dashboard needs these two flags to retain reviewed classifications.
  // Reasons, notes, source links, actors, timestamps and other nested fields stay private.
  if (row.classification_review && typeof row.classification_review === 'object') {
    result.classification_review = {
      ...strings(row.classification_review, ['rule_version']),
      ...booleans(row.classification_review, ['review_required']),
    };
  }
  return result;
}

function affiliation(row) {
  return {
    ...strings(row, ['affiliation_id', 'person_id', 'name', 'identity_status', 'account_id', 'account_name', 'piscfh', 'department', 'title', 'rank', 'employment_status']),
    ...integers(row, ['revision', 'rank_order']),
  };
}

function listPerson(row) {
  return { ...affiliation(row), contact_count: contactCount(row), ...emptyPrivateArrays() };
}

function projectRead(raw, action) {
  const base = { status: 'ok', privacy: locked() };
  if (action === 'catalog') return {
    ...base,
    accounts: array(raw.accounts).map(account).filter(Boolean),
    totals: integers(raw.totals, ['accounts', 'top_level_accounts', 'grouped_accounts', 'groups', 'persons', 'affiliations', 'needs_review']),
    campaigns: [], items: [],
  };
  if (action === 'account') return {
    ...base, account: account(raw.account), people: array(raw.people).map(listPerson),
    children: array(raw.children).map(account).filter(Boolean), parent_account: account(raw.parent_account),
  };
  if (action === 'search') return {
    ...base, people: array(raw.people).map(listPerson), truncated: raw.truncated === true,
  };
  if (action === 'person') return {
    ...base,
    person: { ...strings(raw.person, ['person_id', 'name', 'identity_status']), ...integers(raw.person, ['revision']) },
    affiliations: array(raw.affiliations).map(affiliation), contact_count: contactCount(raw),
    masked_details: maskedDetails(raw),
    ...emptyPrivateArrays(),
  };
  throw new Error('CRM_PRIVACY_ACTION_INVALID');
}

function mutationDenied() {
  return { code: 'CRM_IDENTITY_VERIFICATION_REQUIRED', message: '본인 인증이 연결될 때까지 고객 상세정보 조회와 수정을 잠금 처리했습니다.', privacy: locked() };
}

module.exports = { projectRead, locked, mutationDenied };
