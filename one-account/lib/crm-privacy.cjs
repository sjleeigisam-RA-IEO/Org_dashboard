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
    ...emptyPrivateArrays(),
  };
  throw new Error('CRM_PRIVACY_ACTION_INVALID');
}

function mutationDenied() {
  return { code: 'CRM_IDENTITY_VERIFICATION_REQUIRED', message: '본인 인증이 연결될 때까지 고객 상세정보 조회와 수정을 잠금 처리했습니다.', privacy: locked() };
}

module.exports = { projectRead, locked, mutationDenied };
