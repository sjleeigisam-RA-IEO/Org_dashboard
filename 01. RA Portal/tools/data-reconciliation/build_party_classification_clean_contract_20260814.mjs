import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const auditDir = path.join(repoRoot, 'outputs', 'exposure_external_validation_20260814');
const migrationPath = path.join(
  repoRoot,
  '01. RA Portal',
  'migrations',
  '2026-08-14_party_classification_clean_contract.sql',
);

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).normalize('NFKC').replace(/\u00a0/g, ' ').trim().replace(/\s+/g, ' ');
}

function key(value) {
  return clean(value).toLocaleLowerCase('en-US');
}

function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
}

function id(prefix, value) {
  return `${prefix}_${md5(value).slice(0, 24)}`;
}

function splitCsvList(value) {
  return clean(value).split(',').map(clean).filter(Boolean);
}

function splitNames(value) {
  return clean(value).split(/\s+\/\s+/).map(clean).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter((value) => clean(value) !== ''))];
}

function confidenceNumber(value) {
  const normalized = clean(value);
  if (normalized === '높음') return 0.95;
  if (normalized === '중간') return 0.75;
  if (normalized === '낮음') return 0.45;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;
}

function reviewStatus(value) {
  return confidenceNumber(value) >= 0.9 ? 'confirmed' : 'review';
}

function dateValue(value) {
  const text = clean(value);
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return text || null;
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function distinctJoin(rows, field) {
  const values = unique(rows.map((row) => clean(row[field])));
  return values.length ? values.join(' / ') : null;
}

function firstValue(rows, field, transform = clean) {
  for (const row of rows) {
    const value = transform(row[field]);
    if (value !== '' && value !== null && value !== undefined) return value;
  }
  return null;
}

function booleanValue(value) {
  const normalized = key(value);
  if (!normalized) return null;
  if (['y', 'yes', 'true', '1', '예', '해당'].includes(normalized)) return true;
  if (['n', 'no', 'false', '0', '아니오', '비해당'].includes(normalized)) return false;
  return null;
}

function isBeneficiaryInvestmentVehicleName(value) {
  const name = clean(value);
  if (!name || /^개인투자자\s*포함/i.test(name)) return false;
  if (/(자산운용|투자운용|투자신탁운용)\s*$/i.test(name)) return false;
  if (/^메리츠\s*$/i.test(name)) return false;
  return /리츠\s*$/i.test(name)
    || /위탁관리부동산투자회사\s*$/i.test(name)
    || /투자신탁/i.test(name)
    || /사모.*투자(유한)?회사/i.test(name)
    || /\(?PFV\)?\s*$/i.test(name)
    || /([0-9]+호\s*)?펀드\s*$/i.test(name);
}

function beneficiaryVehicleSubtype(value) {
  const name = clean(value);
  if (/\(?PFV\)?\s*$/i.test(name)) return 'PFV';
  if (/(리츠|위탁관리부동산투자회사)\s*$/i.test(name)) return '리츠';
  return '펀드';
}

function beneficiaryIdentityRole(value) {
  const name = clean(value);
  if (/^개인(?:\s|\(|$)/i.test(name)) {
    return { roleClass: '개인', roleSubtype: '개인', basis: 'canonical_party_name_person_identity' };
  }
  if (/(자산운용|투자운용|투자신탁운용)\s*$/i.test(name)) {
    return { roleClass: '금융기관', roleSubtype: '자산운용사', basis: 'canonical_party_name_asset_manager_identity' };
  }
  return null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ''));
  return rows
    .filter((values) => values.some((value) => clean(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

async function readCsv(name) {
  return parseCsv(await fs.readFile(path.join(auditDir, name), 'utf8'));
}

function factKey(fundId, partyName, baseDate) {
  return `${clean(fundId)}|${key(partyName)}|${dateValue(baseDate) ?? ''}`;
}

function groupedSourceRows(rows, config) {
  const groups = new Map();
  for (const row of rows) {
    const fundId = clean(row[config.fund]);
    const partyName = clean(row[config.party]);
    const baseDate = dateValue(row[config.baseDate]);
    if (!fundId || !partyName || !baseDate) continue;
    const groupKey = factKey(fundId, partyName, baseDate);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  }
  return groups;
}

const [source, live, mergeRows, roleRows, groupRows, externalRows, enrichmentRows] = await Promise.all([
  fs.readFile(path.join(auditDir, 'source_rows.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(auditDir, 'live_db_rows.json'), 'utf8').then(JSON.parse),
  readCsv('party_identity_merge_candidates.csv'),
  readCsv('party_role_classification_candidates.csv'),
  readCsv('party_group_relation_candidates.csv'),
  readCsv('party_external_identifier_candidates.csv'),
  readCsv('party_master_enrichment_candidates.csv'),
]);

const mergeMap = new Map(mergeRows.map((row) => [row.source_party_id, row.target_party_id]));
function finalPartyId(partyId) {
  let current = clean(partyId);
  const seen = new Set();
  while (mergeMap.has(current) && !seen.has(current)) {
    seen.add(current);
    current = mergeMap.get(current);
  }
  return current;
}

const partyById = new Map(live.partyMaster.map((row) => [row.party_id, row]));
const identityMap = new Map();

function addIdentity(row, priority = 0) {
  const sourceName = clean(row.source_name);
  if (!sourceName || !row.party_id || !row.role_type) return;
  const normalized = key(sourceName);
  const mapKey = `${row.role_type}|${normalized}`;
  const candidate = {
    identity_id: id('pidm', mapKey),
    role_type: row.role_type,
    source_name: sourceName,
    source_name_key: normalized,
    source_standard_id: clean(row.source_standard_id) || null,
    source_standard_name: clean(row.source_standard_name) || null,
    party_id: finalPartyId(row.party_id),
    match_type: clean(row.match_type) || 'source_name',
    preserve_attribute: clean(row.preserve_attribute) || null,
    confidence: Number(row.confidence ?? 0.5),
    review_status: clean(row.review_status) || 'review',
    source_file: clean(row.source_file) || null,
    source_snapshot_date: dateValue(row.source_snapshot_date),
    priority,
  };
  const existing = identityMap.get(mapKey);
  if (existing && existing.party_id !== candidate.party_id) {
    if (priority === existing.priority) {
      throw new Error(`Identity collision for ${mapKey}: ${existing.party_id} / ${candidate.party_id}`);
    }
    if (priority < existing.priority) return;
  }
  if (!existing || priority >= existing.priority) identityMap.set(mapKey, candidate);
}

const roleClassifications = new Map();
for (const row of roleRows) {
  const roleType = clean(row.role);
  const sourcePartyIds = splitCsvList(row.db_party_ids).map(finalPartyId);
  const finalIds = unique(sourcePartyIds);
  const sourceIds = splitCsvList(row.source_standard_ids);
  const originalNames = splitNames(row.original_names);
  const confidence = confidenceNumber(row.source_confidence);
  let normalizedRoleClass = clean(row.source_role_class);
  if (roleType === 'lender' && normalizedRoleClass === '일반기업/기타') normalizedRoleClass = '기타';

  for (const partyId of finalIds) {
    const mapKey = `${roleType}|${partyId}`;
    const candidate = {
      classification_id: id('prc', mapKey),
      party_id: partyId,
      role_type: roleType,
      classification_scheme: roleType === 'beneficiary' ? 'investor_20260713' : 'lender_20260713',
      role_class: normalizedRoleClass || (roleType === 'beneficiary' ? '기타' : '미확인'),
      role_subtype: roleType === 'lender' ? clean(row.source_role_subtype) || null : null,
      source_role_class: clean(row.source_role_class) || null,
      source_role_subtype: clean(row.source_role_subtype) || null,
      source_standard_id: sourceIds.join(',') || null,
      source_standard_name: clean(row.source_standard_name) || null,
      classification_basis: '2026-07-13 외부검증 통합본 역할분류',
      confidence,
      review_status: reviewStatus(row.source_confidence),
      valid_from: '1900-01-01',
      valid_to: null,
      source_file: roleType === 'beneficiary'
        ? source.beneficiary.fileName
        : source.lender.fileName,
    };
    if (clean(row.source_standard_name) === 'GIC' && roleType === 'beneficiary') {
      candidate.role_class = '해외LP';
      candidate.confidence = 1;
      candidate.review_status = 'confirmed';
      candidate.classification_basis = '싱가포르투자청 사용자 확인 및 외부검증 통합본';
    }
    if (roleType === 'beneficiary'
      && candidate.role_class !== '개인'
      && isBeneficiaryInvestmentVehicleName(row.source_standard_name)) {
      candidate.role_class = '펀드·리츠·SPC';
      candidate.role_subtype = beneficiaryVehicleSubtype(row.source_standard_name);
      candidate.confidence = 1;
      candidate.review_status = 'confirmed';
      candidate.classification_basis = '법적 투자기구 명칭과 외부검증 원천을 결합한 역할분류';
    }
    const identityRole = roleType === 'beneficiary'
      ? beneficiaryIdentityRole(row.source_standard_name)
      : null;
    if (identityRole) {
      candidate.role_class = identityRole.roleClass;
      candidate.role_subtype = identityRole.roleSubtype;
      candidate.confidence = 1;
      candidate.review_status = 'confirmed';
      candidate.classification_basis = identityRole.basis;
    }
    const existing = roleClassifications.get(mapKey);
    if (!existing || candidate.confidence >= existing.confidence) roleClassifications.set(mapKey, candidate);
  }

  originalNames.forEach((name, index) => {
    addIdentity({
      role_type: roleType,
      source_name: name,
      source_standard_id: sourceIds[index] || sourceIds[0] || null,
      source_standard_name: row.source_standard_name,
      party_id: finalIds[0],
      match_type: key(name) === key(row.source_standard_name) ? 'standard_name' : 'merged_alias',
      preserve_attribute: mergeRows.find((item) => item.role === roleType && item.source_name === name)?.preserve_attribute,
      confidence,
      review_status: reviewStatus(row.source_confidence),
      source_file: roleType === 'beneficiary' ? source.beneficiary.fileName : source.lender.fileName,
      source_snapshot_date: '2026-06-30',
    }, 20);
  });
}

function fallbackRoleClass(roleType, party) {
  const oldClass = clean(party?.party_class);
  const oldCategory = clean(party?.party_category);
  if (roleType === 'beneficiary') {
    const identityRole = beneficiaryIdentityRole(party?.display_name);
    if (identityRole) return identityRole.roleClass;
    if (['펀드', '상장공모리츠', '사모리츠', 'SPC'].includes(oldCategory)
      || isBeneficiaryInvestmentVehicleName(party?.display_name)) return '펀드·리츠·SPC';
    if (clean(party?.party_origin) === '해외') return '해외LP';
    if (oldClass === '금융기관') return '금융기관';
    if (oldClass === '일반기업') return '일반기업';
    if (oldClass === '개인') return '개인';
    if (oldClass === '기관') return '국내LP';
    return '기타';
  }
  const lenderMap = {
    은행: '은행', 보험사: '보험', 증권사: '증권', 저축은행: '저축은행',
    '캐피탈·리스사': '캐피탈·여전', '카드·할부금융': '캐피탈·여전',
    상호금융: '신용협동조합', 자산운용사: '자산운용', 펀드: '펀드·투자기구',
    SPC: '유동화SPV', 대주단: '대주단', 일반기업: '일반기업', 개인: '개인',
  };
  return lenderMap[oldCategory] || (oldClass === '일반기업' ? '일반기업' : '미확인');
}

for (const [roleType, rows, rawField, cleanField] of [
  ['beneficiary', live.beneficiaryExposures, 'beneficiary_raw', 'beneficiary_clean'],
  ['lender', live.lenderExposures, 'lender_raw', 'lender_clean'],
]) {
  for (const row of rows) {
    const partyId = finalPartyId(row.party_id);
    if (!partyId) continue;
    addIdentity({
      role_type: roleType,
      source_name: row[rawField] || row[cleanField],
      party_id: partyId,
      match_type: 'historical_source_name',
      confidence: 1,
      review_status: 'confirmed',
      source_file: `${roleType}_exposures`,
      source_snapshot_date: row.base_date,
    }, 5);
    addIdentity({
      role_type: roleType,
      source_name: row[cleanField],
      party_id: partyId,
      match_type: 'historical_clean_name',
      confidence: 1,
      review_status: 'confirmed',
      source_file: `${roleType}_exposures`,
      source_snapshot_date: row.base_date,
    }, 5);

    const classKey = `${roleType}|${partyId}`;
    if (!roleClassifications.has(classKey)) {
      const party = partyById.get(row.party_id) || partyById.get(partyId);
      roleClassifications.set(classKey, {
        classification_id: id('prc', classKey),
        party_id: partyId,
        role_type: roleType,
        classification_scheme: 'historical_fallback_20260814',
        role_class: fallbackRoleClass(roleType, party),
        role_subtype: null,
        source_role_class: clean(party?.party_class) || null,
        source_role_subtype: clean(party?.party_category) || null,
        source_standard_id: null,
        source_standard_name: clean(party?.display_name) || null,
        classification_basis: '외부검증 범위 밖 과거 snapshot의 기존 분류를 역할축으로 보수적 이관',
        confidence: 0.4,
        review_status: 'review',
        valid_from: '1900-01-01',
        valid_to: null,
        source_file: 'legacy_party_master_archive',
      });
    }
  }
}

const canonicalRenames = enrichmentRows
  .filter((row) => row.action === 'canonical_identity_rebuild_review' && row.confidence === '높음')
  .map((row) => ({
    party_id: finalPartyId(row.party_id),
    old_name: clean(row.db_display_name),
    new_name: clean(row.proposed_value),
    basis: clean(row.basis),
  }));

const aliasSeeds = enrichmentRows
  .filter((row) => row.action === 'alias_add_candidate')
  .map((row) => ({
    alias_id: id('pal', `${finalPartyId(row.party_id)}|${key(row.proposed_value)}|external_validation_20260713`),
    party_id: finalPartyId(row.party_id),
    alias_name: clean(row.proposed_value),
    alias_key: key(row.proposed_value),
    source_table: 'external_validation_20260713',
    confidence: confidenceNumber(row.confidence),
  }))
  .filter((row) => row.party_id && row.alias_name);

const groupSeeds = [];
const membershipSeeds = [];
for (const row of groupRows) {
  const groupName = clean(row.proposed_group_name);
  const partyId = finalPartyId(row.party_id);
  if (!groupName || !partyId) continue;
  const groupId = id('pgrp', key(groupName));
  groupSeeds.push({
    group_id: groupId,
    group_name: groupName,
    group_key: key(groupName),
    group_type: 'parent_group',
    evidence_url: clean(row.evidence_url) || null,
    confidence: confidenceNumber(row.confidence),
    review_status: reviewStatus(row.confidence),
  });
  membershipSeeds.push({
    membership_id: id('pgm', `${groupId}|${partyId}|parent_group`),
    group_id: groupId,
    party_id: partyId,
    relationship_type: 'parent_group',
    role_context: clean(row.role) || null,
    evidence_status: clean(row.evidence_status) || null,
    evidence_url: clean(row.evidence_url) || null,
    confidence: confidenceNumber(row.confidence),
    review_status: reviewStatus(row.confidence),
    valid_from: '1900-01-01',
    valid_to: null,
  });
}

const externalSeeds = externalRows.map((row) => ({
  external_identifier_id: id('peid', `${finalPartyId(row.party_id)}|${clean(row.identifier_type)}|${clean(row.identifier_value)}`),
  party_id: finalPartyId(row.party_id),
  identifier_type: clean(row.identifier_type),
  identifier_value: clean(row.identifier_value),
  source_url: clean(row.source) || null,
  confidence: confidenceNumber(row.confidence),
  review_status: reviewStatus(row.confidence),
})).filter((row) => row.party_id && row.identifier_type && row.identifier_value);

function liveExposureIndex(rows, rawField, cleanField) {
  const result = new Map();
  for (const row of rows) {
    for (const name of unique([row[rawField], row[cleanField]])) {
      const rowKey = factKey(row.fund_id, name, row.base_date);
      if (!result.has(rowKey)) result.set(rowKey, []);
      if (!result.get(rowKey).some((item) => item.id === row.id)) result.get(rowKey).push(row);
    }
  }
  return result;
}

const beneficiaryMetadata = [];
const beneficiarySourceRows = source.beneficiary.sheets['검증_투자레코드'].rows;
const beneficiaryGroups = groupedSourceRows(beneficiarySourceRows, {
  fund: '펀드코드', party: '수익자', baseDate: '기준일자',
});
const beneficiaryLiveIndex = liveExposureIndex(
  live.beneficiaryExposures,
  'beneficiary_raw',
  'beneficiary_clean',
);
for (const [rowKey, rows] of beneficiaryGroups.entries()) {
  const matches = beneficiaryLiveIndex.get(rowKey) || [];
  if (matches.length !== 1) throw new Error(`Beneficiary metadata match count ${matches.length}: ${rowKey}`);
  beneficiaryMetadata.push({
    exposure_id: matches[0].id,
    source_beneficiary_type: distinctJoin(rows, '수익자구분'),
    source_beneficiary_category: distinctJoin(rows, '수익자분류'),
    source_standard_id: distinctJoin(rows, '표준투자자ID_후보'),
    source_standard_name: distinctJoin(rows, '표준투자자명_후보'),
    source_group_name: distinctJoin(rows, '상위그룹_후보'),
    initial_commitment_date: firstValue(rows, '최초약정일', dateValue),
    capital_call_date: firstValue(rows, '약정콜일자', dateValue),
    source_rows: rows.map((row) => Number(row.__sourceRow)).filter(Number.isFinite),
    source_file: distinctJoin(rows, '원본파일') || source.beneficiary.fileName,
    source_snapshot_date: firstValue(rows, '기준일자', dateValue),
  });
}

const lenderMetadata = [];
const lenderSourceRows = source.lender.sheets['검증_대출레코드'].rows;
const lenderGroups = groupedSourceRows(lenderSourceRows, {
  fund: '펀드코드', party: '대주', baseDate: '기준일자',
});
const lenderLiveIndex = liveExposureIndex(live.lenderExposures, 'lender_raw', 'lender_clean');
for (const [rowKey, rows] of lenderGroups.entries()) {
  const matches = lenderLiveIndex.get(rowKey) || [];
  if (matches.length !== 1) throw new Error(`Lender metadata match count ${matches.length}: ${rowKey}`);
  lenderMetadata.push({
    exposure_id: matches[0].id,
    source_lender_role: distinctJoin(rows, '대주역할'),
    source_account_notation: distinctJoin(rows, '실질대주/계정표기'),
    source_loan_type: distinctJoin(rows, '대출유형'),
    shareholder_loan_flag: firstValue(rows, '주주대여금여부', booleanValue),
    securitization_flag: firstValue(rows, '유동화증권여부', booleanValue),
    source_standard_id: distinctJoin(rows, '표준대주ID_후보'),
    source_standard_name: distinctJoin(rows, '표준대주법인명_후보'),
    source_group_name: distinctJoin(rows, '상위그룹_후보'),
    source_rows: rows.map((row) => Number(row.__sourceRow)).filter(Number.isFinite),
    source_file: source.lender.fileName,
    source_snapshot_date: firstValue(rows, '기준일자', dateValue),
  });
}

const seeds = {
  merges: mergeRows.map((row) => ({
    role_type: row.role,
    source_party_id: row.source_party_id,
    target_party_id: row.target_party_id,
    source_name: row.source_name,
    target_name: row.target_name,
    merge_semantics: row.merge_semantics,
    preserve_attribute: row.preserve_attribute,
  })),
  identities: [...identityMap.values()].map(({ priority, ...row }) => row),
  classifications: [...roleClassifications.values()],
  renames: canonicalRenames,
  aliases: [...new Map(aliasSeeds.map((row) => [row.alias_id, row])).values()],
  groups: [...new Map(groupSeeds.map((row) => [row.group_id, row])).values()],
  memberships: [...new Map(membershipSeeds.map((row) => [row.membership_id, row])).values()],
  externalIdentifiers: [...new Map(externalSeeds.map((row) => [row.external_identifier_id, row])).values()],
  beneficiaryMetadata,
  lenderMetadata,
};

function jsonSeed(name) {
  return JSON.stringify(seeds[name]).replace(/\$seed\$/g, '$ seed $');
}

// SQL is assembled below so the generated migration is UTF-8 without BOM and reproducible.
const sql = String.raw`-- Clean canonical party identity, role classification, group and exposure-analysis contract.
-- Generated from the 2026-07-13 externally validated beneficiary/lender workbooks.
-- Raw exposure names and amounts are preserved. Legacy classification machinery is archived, then removed.

begin;
select pg_advisory_xact_lock(hashtext('party_classification_clean_contract_20260814'));

create schema if not exists ra_archive;

create table if not exists ra_archive.beneficiary_exposure_classification_20260814 as
select id, beneficiary_type, beneficiary_cat, beneficiary_cat_source,
       beneficiary_class, beneficiary_cat_basis, beneficiary_cat_confidence,
       beneficiary_cat_method, beneficiary_cat_review_status,
       beneficiary_cat_normalized_at, now() as archived_at
from public.beneficiary_exposures;

create table if not exists ra_archive.party_master_classification_20260814 as
select party_id, party_class, party_category, classification_basis,
       classification_confidence, classification_method, review_status,
       now() as archived_at
from public.party_master;

create table if not exists ra_archive.party_role_memberships_20260814 as
select *, now() as archived_at
from public.party_role_memberships;

create temporary table party_exposure_totals_before on commit drop as
select 'beneficiary'::text as role_type, base_date,
       count(*)::bigint as row_count,
       coalesce(sum(committed_amt), 0)::numeric as committed_amt,
       coalesce(sum(invested_amt), 0)::numeric as primary_amount,
       coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
from public.beneficiary_exposures
group by base_date
union all
select 'lender'::text, base_date, count(*)::bigint,
       coalesce(sum(committed_amt), 0)::numeric,
       coalesce(sum(drawn_amt), 0)::numeric,
       coalesce(sum(remaining_amt), 0)::numeric
from public.lender_exposures
group by base_date;

drop trigger if exists beneficiary_category_contract_trigger on public.beneficiary_exposures;
drop trigger if exists party_exposure_party_assignment_trigger on public.beneficiary_exposures;
drop trigger if exists party_exposure_party_assignment_trigger on public.lender_exposures;
drop trigger if exists beneficiary_category_dictionary_sync_trigger on public.beneficiary_category_dictionary;
drop trigger if exists beneficiary_classification_master_sync_trigger on public.beneficiary_classification_master;
drop trigger if exists beneficiary_master_party_sync_trigger on public.beneficiary_classification_master;

create or replace function public.normalize_party_key(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;

create table if not exists public.party_identity_map (
  identity_id text primary key,
  role_type text not null check (role_type in ('beneficiary', 'lender')),
  source_name text not null,
  source_name_key text not null,
  source_standard_id text,
  source_standard_name text,
  party_id text not null references public.party_master(party_id) on delete cascade,
  match_type text not null,
  preserve_attribute text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  source_file text,
  source_snapshot_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_identity_map_key_check
    check (source_name_key = public.normalize_party_key(source_name)),
  unique (role_type, source_name_key)
);

create table if not exists public.party_role_classifications (
  classification_id text primary key,
  party_id text not null references public.party_master(party_id) on delete cascade,
  role_type text not null check (role_type in ('beneficiary', 'lender')),
  classification_scheme text not null,
  role_class text not null,
  role_subtype text,
  source_role_class text,
  source_role_subtype text,
  source_standard_id text,
  source_standard_name text,
  classification_basis text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  valid_from date not null default date '1900-01-01',
  valid_to date,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_role_classifications_period_check
    check (valid_to is null or valid_to > valid_from),
  constraint party_role_classifications_class_check check (
    (role_type = 'beneficiary' and role_class in
      ('국내LP', '해외LP', '펀드·리츠·SPC', '금융기관', '일반기업', '공기업', '개인', '기타'))
    or
    (role_type = 'lender' and role_class in
      ('은행', '보험', '증권', '저축은행', '캐피탈·여전', '신용협동조합',
       '새마을금고', '유동화SPV', '펀드·투자기구', '자산운용', '대주단',
       '일반기업', '개인', '기타', '미확인'))
  )
);

create unique index if not exists party_role_classifications_active_idx
  on public.party_role_classifications (party_id, role_type)
  where valid_to is null;

create table if not exists public.party_groups (
  group_id text primary key,
  group_name text not null,
  group_key text not null unique,
  group_type text not null default 'parent_group',
  evidence_url text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_groups_key_check
    check (group_key = public.normalize_party_key(group_name))
);

create table if not exists public.party_group_memberships (
  membership_id text primary key,
  group_id text not null references public.party_groups(group_id) on delete cascade,
  party_id text not null references public.party_master(party_id) on delete cascade,
  relationship_type text not null default 'parent_group',
  role_context text check (role_context is null or role_context in ('beneficiary', 'lender')),
  evidence_status text,
  evidence_url text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  valid_from date not null default date '1900-01-01',
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, party_id, relationship_type)
);

create table if not exists public.party_external_identifiers (
  external_identifier_id text primary key,
  party_id text not null references public.party_master(party_id) on delete cascade,
  identifier_type text not null,
  identifier_value text not null,
  source_url text,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, identifier_type, identifier_value)
);

create table if not exists public.beneficiary_exposure_source_metadata (
  exposure_id bigint primary key references public.beneficiary_exposures(id) on delete cascade,
  source_beneficiary_type text,
  source_beneficiary_category text,
  source_standard_id text,
  source_standard_name text,
  source_group_name text,
  initial_commitment_date date,
  capital_call_date date,
  source_rows jsonb not null default '[]'::jsonb,
  source_file text,
  source_snapshot_date date,
  updated_at timestamptz not null default now()
);

create table if not exists public.lender_exposure_source_metadata (
  exposure_id bigint primary key references public.lender_exposures(id) on delete cascade,
  source_lender_role text,
  source_account_notation text,
  source_loan_type text,
  shareholder_loan_flag boolean,
  securitization_flag boolean,
  source_standard_id text,
  source_standard_name text,
  source_group_name text,
  source_rows jsonb not null default '[]'::jsonb,
  source_file text,
  source_snapshot_date date,
  updated_at timestamptz not null default now()
);

insert into public.beneficiary_exposure_source_metadata (
  exposure_id, source_beneficiary_type, source_beneficiary_category,
  source_rows, source_file, source_snapshot_date, updated_at
)
select id, beneficiary_type, beneficiary_cat_source,
       jsonb_build_array(id), 'legacy_db_snapshot', base_date, now()
from public.beneficiary_exposures
on conflict (exposure_id) do nothing;

create temporary table party_merge_seed on commit drop as
select *
from jsonb_to_recordset($seed$${jsonSeed('merges')}$seed$::jsonb) as seed(
  role_type text,
  source_party_id text,
  target_party_id text,
  source_name text,
  target_name text,
  merge_semantics text,
  preserve_attribute text
);

insert into public.party_aliases (
  alias_id, party_id, alias_name, alias_key, source_table, confidence
)
select
  'pal_' || substr(md5(concat_ws('|', merge.target_party_id,
    public.normalize_party_key(source.display_name), 'identity_merge_20260814')), 1, 24),
  merge.target_party_id,
  source.display_name,
  public.normalize_party_key(source.display_name),
  'identity_merge_20260814',
  1.000
from party_merge_seed merge
join public.party_master source on source.party_id = merge.source_party_id
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = greatest(public.party_aliases.confidence, excluded.confidence);

insert into public.party_aliases (
  alias_id, party_id, alias_name, alias_key, source_table, confidence
)
select
  'pal_' || substr(md5(concat_ws('|', merge.target_party_id,
    alias.alias_key, alias.source_table)), 1, 24),
  merge.target_party_id,
  alias.alias_name,
  alias.alias_key,
  alias.source_table,
  alias.confidence
from party_merge_seed merge
join public.party_aliases alias on alias.party_id = merge.source_party_id
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = greatest(public.party_aliases.confidence, excluded.confidence);

delete from public.party_aliases alias
using party_merge_seed merge
where alias.party_id = merge.source_party_id;

update public.beneficiary_exposures exposure
set party_id = merge.target_party_id
from party_merge_seed merge
where merge.role_type = 'beneficiary'
  and exposure.party_id = merge.source_party_id;

update public.lender_exposures exposure
set party_id = merge.target_party_id
from party_merge_seed merge
where merge.role_type = 'lender'
  and exposure.party_id = merge.source_party_id;

drop view public.party_role_memberships;

delete from public.party_master party
using party_merge_seed merge
where party.party_id = merge.source_party_id
  and not exists (
    select 1 from public.beneficiary_exposures exposure where exposure.party_id = party.party_id
  )
  and not exists (
    select 1 from public.lender_exposures exposure where exposure.party_id = party.party_id
  );

create temporary table party_rename_seed on commit drop as
select *
from jsonb_to_recordset($seed$${jsonSeed('renames')}$seed$::jsonb) as seed(
  party_id text,
  old_name text,
  new_name text,
  basis text
);

insert into public.party_aliases (
  alias_id, party_id, alias_name, alias_key, source_table, confidence
)
select
  'pal_' || substr(md5(concat_ws('|', rename.party_id,
    public.normalize_party_key(rename.old_name), 'canonical_rename_20260814')), 1, 24),
  rename.party_id,
  rename.old_name,
  public.normalize_party_key(rename.old_name),
  'canonical_rename_20260814',
  1.000
from party_rename_seed rename
join public.party_master party on party.party_id = rename.party_id
where nullif(btrim(rename.old_name), '') is not null
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = greatest(public.party_aliases.confidence, excluded.confidence);

update public.party_master party
set display_name = rename.new_name,
    party_key = public.normalize_party_key(rename.new_name),
    notes = concat_ws(E'\n', nullif(party.notes, ''),
      '2026-08-14 canonical rename: ' || coalesce(rename.basis, 'external validation')),
    updated_at = now()
from party_rename_seed rename
where party.party_id = rename.party_id
  and nullif(btrim(rename.new_name), '') is not null
  and not exists (
    select 1
    from public.party_master conflict
    where conflict.party_id <> party.party_id
      and conflict.party_key = public.normalize_party_key(rename.new_name)
  );

insert into public.party_aliases (
  alias_id, party_id, alias_name, alias_key, source_table, confidence
)
select alias_id, party_id, alias_name, alias_key, source_table, confidence
from jsonb_to_recordset($seed$${jsonSeed('aliases')}$seed$::jsonb) as seed(
  alias_id text,
  party_id text,
  alias_name text,
  alias_key text,
  source_table text,
  confidence numeric
)
where exists (select 1 from public.party_master party where party.party_id = seed.party_id)
on conflict (party_id, alias_key, source_table) do update set
  alias_name = excluded.alias_name,
  confidence = greatest(public.party_aliases.confidence, excluded.confidence);

insert into public.party_identity_map (
  identity_id, role_type, source_name, source_name_key,
  source_standard_id, source_standard_name, party_id, match_type,
  preserve_attribute, confidence, review_status, source_file,
  source_snapshot_date, updated_at
)
select identity_id, role_type, source_name, source_name_key,
       source_standard_id, source_standard_name, party_id, match_type,
       preserve_attribute, confidence, review_status, source_file,
       source_snapshot_date, now()
from jsonb_to_recordset($seed$${jsonSeed('identities')}$seed$::jsonb) as seed(
  identity_id text,
  role_type text,
  source_name text,
  source_name_key text,
  source_standard_id text,
  source_standard_name text,
  party_id text,
  match_type text,
  preserve_attribute text,
  confidence numeric,
  review_status text,
  source_file text,
  source_snapshot_date date
)
where exists (select 1 from public.party_master party where party.party_id = seed.party_id)
on conflict (role_type, source_name_key) do update set
  source_name = excluded.source_name,
  source_standard_id = excluded.source_standard_id,
  source_standard_name = excluded.source_standard_name,
  party_id = excluded.party_id,
  match_type = excluded.match_type,
  preserve_attribute = excluded.preserve_attribute,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  source_file = excluded.source_file,
  source_snapshot_date = excluded.source_snapshot_date,
  updated_at = now();

insert into public.party_role_classifications (
  classification_id, party_id, role_type, classification_scheme,
  role_class, role_subtype, source_role_class, source_role_subtype,
  source_standard_id, source_standard_name, classification_basis,
  confidence, review_status, valid_from, valid_to, source_file, updated_at
)
select classification_id, party_id, role_type, classification_scheme,
       role_class, role_subtype, source_role_class, source_role_subtype,
       source_standard_id, source_standard_name, classification_basis,
       confidence, review_status, valid_from, valid_to, source_file, now()
from jsonb_to_recordset($seed$${jsonSeed('classifications')}$seed$::jsonb) as seed(
  classification_id text,
  party_id text,
  role_type text,
  classification_scheme text,
  role_class text,
  role_subtype text,
  source_role_class text,
  source_role_subtype text,
  source_standard_id text,
  source_standard_name text,
  classification_basis text,
  confidence numeric,
  review_status text,
  valid_from date,
  valid_to date,
  source_file text
)
where exists (select 1 from public.party_master party where party.party_id = seed.party_id)
on conflict (classification_id) do update set
  classification_scheme = excluded.classification_scheme,
  role_class = excluded.role_class,
  role_subtype = excluded.role_subtype,
  source_role_class = excluded.source_role_class,
  source_role_subtype = excluded.source_role_subtype,
  source_standard_id = excluded.source_standard_id,
  source_standard_name = excluded.source_standard_name,
  classification_basis = excluded.classification_basis,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  source_file = excluded.source_file,
  updated_at = now();

insert into public.party_groups (
  group_id, group_name, group_key, group_type, evidence_url,
  confidence, review_status, updated_at
)
select group_id, group_name, group_key, group_type, evidence_url,
       confidence, review_status, now()
from jsonb_to_recordset($seed$${jsonSeed('groups')}$seed$::jsonb) as seed(
  group_id text,
  group_name text,
  group_key text,
  group_type text,
  evidence_url text,
  confidence numeric,
  review_status text
)
on conflict (group_id) do update set
  group_name = excluded.group_name,
  group_key = excluded.group_key,
  group_type = excluded.group_type,
  evidence_url = excluded.evidence_url,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  updated_at = now();

insert into public.party_group_memberships (
  membership_id, group_id, party_id, relationship_type, role_context,
  evidence_status, evidence_url, confidence, review_status,
  valid_from, valid_to, updated_at
)
select membership_id, group_id, party_id, relationship_type, role_context,
       evidence_status, evidence_url, confidence, review_status,
       valid_from, valid_to, now()
from jsonb_to_recordset($seed$${jsonSeed('memberships')}$seed$::jsonb) as seed(
  membership_id text,
  group_id text,
  party_id text,
  relationship_type text,
  role_context text,
  evidence_status text,
  evidence_url text,
  confidence numeric,
  review_status text,
  valid_from date,
  valid_to date
)
where exists (select 1 from public.party_master party where party.party_id = seed.party_id)
on conflict (group_id, party_id, relationship_type) do update set
  role_context = excluded.role_context,
  evidence_status = excluded.evidence_status,
  evidence_url = excluded.evidence_url,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  updated_at = now();

insert into public.party_external_identifiers (
  external_identifier_id, party_id, identifier_type, identifier_value,
  source_url, confidence, review_status, updated_at
)
select external_identifier_id, party_id, identifier_type, identifier_value,
       source_url, confidence, review_status, now()
from jsonb_to_recordset($seed$${jsonSeed('externalIdentifiers')}$seed$::jsonb) as seed(
  external_identifier_id text,
  party_id text,
  identifier_type text,
  identifier_value text,
  source_url text,
  confidence numeric,
  review_status text
)
where exists (select 1 from public.party_master party where party.party_id = seed.party_id)
on conflict (party_id, identifier_type, identifier_value) do update set
  source_url = excluded.source_url,
  confidence = greatest(public.party_external_identifiers.confidence, excluded.confidence),
  review_status = case
    when public.party_external_identifiers.review_status = 'confirmed'
      or excluded.review_status = 'confirmed' then 'confirmed'
    else 'review'
  end,
  updated_at = now();

insert into public.beneficiary_exposure_source_metadata (
  exposure_id, source_beneficiary_type, source_beneficiary_category,
  source_standard_id, source_standard_name, source_group_name,
  initial_commitment_date, capital_call_date, source_rows,
  source_file, source_snapshot_date, updated_at
)
select exposure_id, source_beneficiary_type, source_beneficiary_category,
       source_standard_id, source_standard_name, source_group_name,
       initial_commitment_date, capital_call_date, source_rows,
       source_file, source_snapshot_date, now()
from jsonb_to_recordset($seed$${jsonSeed('beneficiaryMetadata')}$seed$::jsonb) as seed(
  exposure_id bigint,
  source_beneficiary_type text,
  source_beneficiary_category text,
  source_standard_id text,
  source_standard_name text,
  source_group_name text,
  initial_commitment_date date,
  capital_call_date date,
  source_rows jsonb,
  source_file text,
  source_snapshot_date date
)
on conflict (exposure_id) do update set
  source_beneficiary_type = excluded.source_beneficiary_type,
  source_beneficiary_category = excluded.source_beneficiary_category,
  source_standard_id = excluded.source_standard_id,
  source_standard_name = excluded.source_standard_name,
  source_group_name = excluded.source_group_name,
  initial_commitment_date = excluded.initial_commitment_date,
  capital_call_date = excluded.capital_call_date,
  source_rows = excluded.source_rows,
  source_file = excluded.source_file,
  source_snapshot_date = excluded.source_snapshot_date,
  updated_at = now();

insert into public.lender_exposure_source_metadata (
  exposure_id, source_lender_role, source_account_notation, source_loan_type,
  shareholder_loan_flag, securitization_flag, source_standard_id,
  source_standard_name, source_group_name, source_rows, source_file,
  source_snapshot_date, updated_at
)
select exposure_id, source_lender_role, source_account_notation, source_loan_type,
       shareholder_loan_flag, securitization_flag, source_standard_id,
       source_standard_name, source_group_name, source_rows, source_file,
       source_snapshot_date, now()
from jsonb_to_recordset($seed$${jsonSeed('lenderMetadata')}$seed$::jsonb) as seed(
  exposure_id bigint,
  source_lender_role text,
  source_account_notation text,
  source_loan_type text,
  shareholder_loan_flag boolean,
  securitization_flag boolean,
  source_standard_id text,
  source_standard_name text,
  source_group_name text,
  source_rows jsonb,
  source_file text,
  source_snapshot_date date
)
on conflict (exposure_id) do update set
  source_lender_role = excluded.source_lender_role,
  source_account_notation = excluded.source_account_notation,
  source_loan_type = excluded.source_loan_type,
  shareholder_loan_flag = excluded.shareholder_loan_flag,
  securitization_flag = excluded.securitization_flag,
  source_standard_id = excluded.source_standard_id,
  source_standard_name = excluded.source_standard_name,
  source_group_name = excluded.source_group_name,
  source_rows = excluded.source_rows,
  source_file = excluded.source_file,
  source_snapshot_date = excluded.source_snapshot_date,
  updated_at = now();

-- Repair only deterministic one-asset relationships. Multi-asset funds remain unresolved.
with one_asset as (
  select fund_id::text as fund_id, min(asset_id)::text as asset_id
  from public.asset_fund_links
  group by fund_id
  having count(distinct asset_id) = 1
)
update public.beneficiary_exposures exposure
set asset_id = one_asset.asset_id
from one_asset
where exposure.fund_id::text = one_asset.fund_id
  and (
    exposure.asset_id is null
    or not exists (
      select 1 from public.asset_fund_links link
      where link.fund_id::text = exposure.fund_id::text
        and link.asset_id::text = exposure.asset_id::text
    )
  );

with one_asset as (
  select fund_id::text as fund_id, min(asset_id)::text as asset_id
  from public.asset_fund_links
  group by fund_id
  having count(distinct asset_id) = 1
)
update public.lender_exposures exposure
set asset_id = one_asset.asset_id
from one_asset
where exposure.fund_id::text = one_asset.fund_id
  and (
    exposure.asset_id is null
    or not exists (
      select 1 from public.asset_fund_links link
      where link.fund_id::text = exposure.fund_id::text
        and link.asset_id::text = exposure.asset_id::text
    )
  );

-- Remove old public consumers before removing their columns and tables.
drop view if exists public.beneficiary_classification_backfill_audit;
drop view if exists public.beneficiary_classification_review_queue;
drop view if exists public.beneficiary_category_contract_audit;
drop view if exists public.beneficiary_exposures_classified;
drop view if exists public.party_origin_contract_audit;
drop view if exists public.party_exposure_contract_audit;
drop view if exists public.party_exposure_facets_v2;
drop view if exists public.party_exposure_rankings_v2;
drop view if exists public.party_exposure_analysis_fact_v2;
drop view if exists public.party_exposure_facets_v1;
drop view if exists public.party_exposure_rankings_v1;
drop view if exists public.party_exposure_analysis_fact_v1;
drop view if exists public.party_exposure_current_v1;

drop function if exists public.apply_beneficiary_category_contract();
drop function if exists public.refresh_beneficiary_category_contract();
drop function if exists public.sync_beneficiary_category_dictionary();
drop function if exists public.sync_beneficiary_master_classification();
drop function if exists public.sync_party_master_from_beneficiary_master();
drop function if exists public.assign_party_id_from_exposure();

create table if not exists ra_archive.beneficiary_category_dictionary_20260814 as
select *, now() as archived_at from public.beneficiary_category_dictionary;
create table if not exists ra_archive.beneficiary_category_source_map_20260814 as
select *, now() as archived_at from public.beneficiary_category_source_map;
create table if not exists ra_archive.beneficiary_classification_master_20260814 as
select *, now() as archived_at from public.beneficiary_classification_master;

alter table public.beneficiary_exposures
  drop constraint if exists beneficiary_exposures_beneficiary_cat_contract_fkey;

drop table public.beneficiary_classification_master;
drop table public.beneficiary_category_source_map;
drop table public.beneficiary_category_dictionary;

alter table public.beneficiary_exposures
  drop column beneficiary_type,
  drop column beneficiary_cat,
  drop column beneficiary_cat_source,
  drop column beneficiary_class,
  drop column beneficiary_cat_basis,
  drop column beneficiary_cat_confidence,
  drop column beneficiary_cat_method,
  drop column beneficiary_cat_review_status,
  drop column beneficiary_cat_normalized_at;

alter table public.party_master
  drop constraint if exists party_master_class_check,
  drop constraint if exists party_master_confidence_check,
  drop constraint if exists party_master_review_check,
  drop column party_class,
  drop column party_category,
  drop column classification_basis,
  drop column classification_confidence,
  drop column classification_method,
  drop column review_status;

drop function if exists public.normalize_beneficiary_key(text);
drop function if exists public.infer_party_class(text);
drop function if exists public.infer_party_category(text);

create or replace function public.assign_party_id_from_identity_map()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_role text;
  resolved_name text;
  resolved_raw_name text;
  resolved_key text;
  resolved_party_id text;
  resolved_origin text;
  resolved_country text;
begin
  if tg_table_name = 'beneficiary_exposures' then
    resolved_role := 'beneficiary';
    resolved_name := coalesce(nullif(btrim(new.beneficiary_clean), ''), nullif(btrim(new.beneficiary_raw), ''));
    resolved_raw_name := new.beneficiary_raw;
  else
    resolved_role := 'lender';
    resolved_name := coalesce(nullif(btrim(new.lender_clean), ''), nullif(btrim(new.lender_raw), ''));
    resolved_raw_name := new.lender_raw;
  end if;

  if resolved_name is null then
    new.party_id := null;
    return new;
  end if;

  resolved_key := public.normalize_party_key(resolved_name);
  select identity.party_id
  into resolved_party_id
  from public.party_identity_map identity
  where identity.role_type = resolved_role
    and identity.source_name_key = resolved_key
  order by identity.confidence desc, identity.updated_at desc
  limit 1;

  if resolved_party_id is null then
    select alias.party_id
    into resolved_party_id
    from public.party_aliases alias
    where alias.alias_key = resolved_key
    order by alias.confidence desc, alias.created_at
    limit 1;
  end if;

  if resolved_party_id is null then
    select party.party_id
    into resolved_party_id
    from public.party_master party
    where party.party_key = resolved_key;
  end if;

  if resolved_party_id is null then
    resolved_party_id := public.party_id_for_key(resolved_key);
    resolved_origin := public.infer_party_origin(resolved_name, null);
    resolved_country := public.infer_party_country_code(resolved_name, resolved_origin);

    insert into public.party_master (
      party_id, party_key, display_name, notes,
      party_origin, domicile_country_code, origin_basis,
      origin_confidence, origin_review_status, updated_at
    ) values (
      resolved_party_id, resolved_key, resolved_name,
      'Runtime-created identity; classification review required',
      resolved_origin, resolved_country, '명칭 단서 기반 신규 identity',
      case when resolved_origin = '확인 필요' then 0.300 else 0.650 end,
      'review', now()
    )
    on conflict (party_key) do update set
      updated_at = now()
    returning party_id into resolved_party_id;

    insert into public.party_role_classifications (
      classification_id, party_id, role_type, classification_scheme,
      role_class, classification_basis, confidence, review_status,
      valid_from, source_file
    ) values (
      'prc_' || substr(md5(concat_ws('|', resolved_role, resolved_party_id)), 1, 24),
      resolved_party_id, resolved_role, 'runtime_unclassified',
      case when resolved_role = 'beneficiary' then '기타' else '미확인' end,
      '신규 원천명: 역할분류 검토 필요', 0.000, 'review', date '1900-01-01',
      tg_table_name
    )
    on conflict (classification_id) do nothing;
  end if;

  insert into public.party_identity_map (
    identity_id, role_type, source_name, source_name_key, party_id,
    match_type, confidence, review_status, source_file,
    source_snapshot_date, updated_at
  ) values (
    'pidm_' || substr(md5(concat_ws('|', resolved_role, resolved_key)), 1, 24),
    resolved_role, resolved_name, resolved_key, resolved_party_id,
    'runtime_source_name', 1.000, 'confirmed', tg_table_name,
    new.base_date, now()
  )
  on conflict (role_type, source_name_key) do update set
    source_name = excluded.source_name,
    party_id = excluded.party_id,
    updated_at = now();

  if nullif(btrim(resolved_raw_name), '') is not null then
    insert into public.party_aliases (
      alias_id, party_id, alias_name, alias_key, source_table, confidence
    ) values (
      'pal_' || substr(md5(concat_ws('|', resolved_party_id,
        public.normalize_party_key(resolved_raw_name), tg_table_name)), 1, 24),
      resolved_party_id, resolved_raw_name, public.normalize_party_key(resolved_raw_name),
      tg_table_name, 1.000
    )
    on conflict (party_id, alias_key, source_table) do update set
      alias_name = excluded.alias_name,
      confidence = greatest(public.party_aliases.confidence, excluded.confidence);
  end if;

  new.party_id := resolved_party_id;
  return new;
end;
$$;

create trigger party_identity_assignment_trigger
before insert or update of beneficiary_raw, beneficiary_clean, party_id
on public.beneficiary_exposures
for each row execute function public.assign_party_id_from_identity_map();

create trigger party_identity_assignment_trigger
before insert or update of lender_raw, lender_clean, party_id
on public.lender_exposures
for each row execute function public.assign_party_id_from_identity_map();

create or replace view public.party_exposure_fact as
with exposure_source as (
  select
    'beneficiary:' || exposure.id::text as exposure_uid,
    'beneficiary'::text as role_type,
    exposure.id::text as source_exposure_id,
    exposure.party_id,
    exposure.fund_id::text as fund_id,
    exposure.base_date,
    coalesce(exposure.committed_amt, 0)::bigint as committed_amt,
    coalesce(exposure.invested_amt, 0)::bigint as invested_amt,
    0::bigint as drawn_amt,
    coalesce(exposure.remaining_amt, 0)::bigint as remaining_amt,
    coalesce(exposure.invested_amt, 0)::bigint as primary_amount,
    exposure.asset_id::text as direct_asset_id,
    metadata.source_beneficiary_type as source_party_type,
    metadata.source_beneficiary_category as source_party_category,
    metadata.source_standard_id,
    metadata.source_standard_name,
    metadata.source_group_name,
    exposure.remarks,
    coalesce(metadata.capital_call_date, exposure.invested_date) as activity_date,
    null::date as maturity_date
  from public.beneficiary_exposures exposure
  left join public.beneficiary_exposure_source_metadata metadata
    on metadata.exposure_id = exposure.id

  union all

  select
    'lender:' || exposure.id::text,
    'lender'::text,
    exposure.id::text,
    exposure.party_id,
    exposure.fund_id::text,
    exposure.base_date,
    coalesce(exposure.committed_amt, 0)::bigint,
    0::bigint,
    coalesce(exposure.drawn_amt, 0)::bigint,
    coalesce(exposure.remaining_amt, 0)::bigint,
    coalesce(exposure.drawn_amt, 0)::bigint,
    exposure.asset_id::text,
    metadata.source_lender_role,
    metadata.source_loan_type,
    metadata.source_standard_id,
    metadata.source_standard_name,
    metadata.source_group_name,
    exposure.remarks,
    coalesce(exposure.drawdown_date, exposure.start_date),
    coalesce(exposure.loan_maturity_date, exposure.end_date)
  from public.lender_exposures exposure
  left join public.lender_exposure_source_metadata metadata
    on metadata.exposure_id = exposure.id
),
fund_asset_degree as (
  select fund_id::text as fund_id, count(distinct asset_id)::int as asset_count
  from public.asset_fund_links
  group by fund_id
),
direct_match as (
  select source.exposure_uid,
         exists (
           select 1 from public.asset_fund_links link
           where link.fund_id::text = source.fund_id
             and link.asset_id::text = source.direct_asset_id
         ) as matches_fund_link
  from exposure_source source
),
resolved_asset_edges as (
  select source.exposure_uid, source.direct_asset_id as asset_id
  from exposure_source source
  where source.direct_asset_id is not null

  union

  select source.exposure_uid, link.asset_id::text
  from exposure_source source
  join public.asset_fund_links link on link.fund_id::text = source.fund_id
  left join direct_match match on match.exposure_uid = source.exposure_uid
  where source.direct_asset_id is null
     or coalesce(match.matches_fund_link, false) is false
),
asset_attributes as (
  select
    edge.exposure_uid,
    array_agg(distinct asset.asset_id order by asset.asset_id) as asset_ids,
    array_agg(
      distinct coalesce(
        nullif(asset.physical_asset_name, ''),
        nullif(asset.non_physical_asset_label, ''),
        nullif(asset.canonical_name, ''),
        nullif(asset.asset_code, ''),
        asset.asset_id
      )
      order by coalesce(
        nullif(asset.physical_asset_name, ''),
        nullif(asset.non_physical_asset_label, ''),
        nullif(asset.canonical_name, ''),
        nullif(asset.asset_code, ''),
        asset.asset_id
      )
    ) as asset_names,
    array_agg(distinct asset.asset_type order by asset.asset_type)
      filter (where nullif(btrim(asset.asset_type), '') is not null) as asset_types,
    array_agg(distinct asset.asset_kind order by asset.asset_kind)
      filter (where nullif(btrim(asset.asset_kind), '') is not null) as asset_kinds,
    array_agg(distinct asset.portfolio_region order by asset.portfolio_region)
      filter (where nullif(btrim(asset.portfolio_region), '') is not null) as asset_regions,
    array_agg(distinct asset.business_stage order by asset.business_stage)
      filter (where nullif(btrim(asset.business_stage), '') is not null) as asset_business_stages,
    array_agg(distinct asset.city order by asset.city)
      filter (where nullif(btrim(asset.city), '') is not null) as cities,
    array_agg(distinct asset.country_code order by asset.country_code)
      filter (where nullif(btrim(asset.country_code), '') is not null) as country_codes
  from resolved_asset_edges edge
  join public.asset_master asset on asset.asset_id::text = edge.asset_id
  group by edge.exposure_uid
)
select
  source.exposure_uid,
  source.role_type,
  source.source_exposure_id,
  source.party_id,
  party.display_name as party_name,
  classification.role_class,
  classification.role_subtype,
  classification.classification_scheme,
  classification.classification_basis,
  classification.confidence as classification_confidence,
  classification.review_status as classification_review_status,
  party.party_origin,
  party.domicile_country_code,
  party.origin_basis,
  party.origin_confidence,
  party.origin_review_status,
  coalesce((
    select array_agg(distinct alias.alias_name order by alias.alias_name)
    from public.party_aliases alias
    where alias.party_id = source.party_id
  ), array[]::text[]) as party_aliases,
  coalesce((
    select array_agg(distinct group_master.group_name order by group_master.group_name)
    from public.party_group_memberships membership
    join public.party_groups group_master on group_master.group_id = membership.group_id
    where membership.party_id = source.party_id
      and (membership.valid_to is null or source.base_date < membership.valid_to)
      and source.base_date >= membership.valid_from
  ), array[]::text[]) as party_group_names,
  source.fund_id,
  coalesce(nullif(fund.short_name, ''), nullif(fund.fund_name, ''), source.fund_id) as fund_name,
  source.base_date,
  source.committed_amt,
  source.invested_amt,
  source.drawn_amt,
  source.remaining_amt,
  source.primary_amount,
  source.direct_asset_id,
  coalesce(attributes.asset_ids, array[]::text[]) as asset_ids,
  coalesce(attributes.asset_names, array[]::text[]) as asset_names,
  coalesce(attributes.asset_types, array[]::text[]) as asset_types,
  coalesce(attributes.asset_kinds, array[]::text[]) as asset_kinds,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_regions, array[]::text[]) || array[fund.primary_region, fund.location]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as regions,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_business_stages, array[]::text[]) || array[fund.notion_business_stage_class]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as business_stages,
  array(
    select distinct value
    from unnest(coalesce(attributes.asset_types, array[]::text[]) || array[fund.notion_base_asset_class, fund.sector]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as base_asset_classes,
  array(
    select distinct value
    from unnest(array[fund.notion_investment_strategy_class]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as strategies,
  array(
    select distinct value
    from unnest(array[coalesce(fund.notion_vehicle_class, fund.fund_type, fund.fund_class)]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as vehicle_types,
  array(
    select distinct value
    from unnest(array[fund.status]) value
    where nullif(btrim(value), '') is not null
    order by value
  ) as operational_statuses,
  coalesce(attributes.cities, array[]::text[]) as cities,
  coalesce(attributes.country_codes, array[]::text[]) as country_codes,
  case
    when source.direct_asset_id is not null and coalesce(match.matches_fund_link, false) then 'direct'
    when source.direct_asset_id is not null and coalesce(match.matches_fund_link, false) is false then 'direct_conflict'
    when source.direct_asset_id is null and coalesce(degree.asset_count, 0) = 1 then 'derived_single'
    when source.direct_asset_id is null and coalesce(degree.asset_count, 0) > 1 then 'derived_multi'
    else 'unresolved'
  end as relationship_quality,
  source.source_party_type,
  source.source_party_category,
  source.source_standard_id,
  source.source_standard_name,
  source.source_group_name,
  source.remarks,
  source.activity_date,
  source.maturity_date
from exposure_source source
join public.party_master party on party.party_id = source.party_id
join lateral (
  select role.*
  from public.party_role_classifications role
  where role.party_id = source.party_id
    and role.role_type = source.role_type
    and source.base_date >= role.valid_from
    and (role.valid_to is null or source.base_date < role.valid_to)
  order by role.valid_from desc, role.confidence desc
  limit 1
) classification on true
left join public.v_funds_enriched fund on fund.fund_id::text = source.fund_id
left join fund_asset_degree degree on degree.fund_id = source.fund_id
left join direct_match match on match.exposure_uid = source.exposure_uid
left join asset_attributes attributes on attributes.exposure_uid = source.exposure_uid;

create or replace view public.party_exposure_current as
with latest as (
  select role_type, fund_id, max(base_date) as base_date
  from public.party_exposure_fact
  group by role_type, fund_id
)
select fact.*
from public.party_exposure_fact fact
join latest
  on latest.role_type = fact.role_type
 and latest.fund_id = fact.fund_id
 and latest.base_date is not distinct from fact.base_date;

create or replace view public.party_exposure_rankings as
with totals as (
  select
    fact.role_type,
    fact.party_id,
    min(fact.party_name) as party_name,
    min(fact.role_class) as role_class,
    min(fact.role_subtype) as role_subtype,
    min(fact.classification_scheme) as classification_scheme,
    min(fact.classification_basis) as classification_basis,
    min(fact.classification_confidence) as classification_confidence,
    min(fact.classification_review_status) as classification_review_status,
    min(fact.party_origin) as party_origin,
    min(fact.domicile_country_code) as domicile_country_code,
    min(fact.origin_basis) as origin_basis,
    min(fact.origin_confidence) as origin_confidence,
    min(fact.origin_review_status) as origin_review_status,
    count(*)::int as exposure_count,
    count(distinct fact.fund_id)::int as fund_count,
    min(fact.base_date) as min_base_date,
    max(fact.base_date) as max_base_date,
    coalesce(sum(fact.committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(fact.invested_amt), 0)::bigint as invested_amt,
    coalesce(sum(fact.drawn_amt), 0)::bigint as drawn_amt,
    coalesce(sum(fact.remaining_amt), 0)::bigint as remaining_amt,
    coalesce(sum(fact.primary_amount), 0)::bigint as primary_amount,
    count(*) filter (where fact.relationship_quality = 'direct')::int as direct_exposure_count,
    count(*) filter (where fact.relationship_quality = 'direct_conflict')::int as conflict_exposure_count,
    count(*) filter (where fact.relationship_quality = 'derived_single')::int as derived_single_exposure_count,
    count(*) filter (where fact.relationship_quality = 'derived_multi')::int as derived_multi_exposure_count,
    count(*) filter (where fact.relationship_quality = 'unresolved')::int as unresolved_exposure_count
  from public.party_exposure_current fact
  group by fact.role_type, fact.party_id
)
select
  totals.*,
  case when totals.committed_amt = 0 then 0::numeric
       else totals.primary_amount::numeric / totals.committed_amt::numeric end as utilization_ratio,
  coalesce((
    select count(distinct asset_id)::int
    from public.party_exposure_current fact
    cross join lateral unnest(fact.asset_ids) asset_id
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), 0) as asset_count,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.asset_types) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as asset_types,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.base_asset_classes) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as base_asset_classes,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.regions) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as regions,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.strategies) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as strategies,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.business_stages) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as business_stages,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.vehicle_types) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as vehicle_types,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.operational_statuses) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as operational_statuses,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.asset_names) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as asset_names,
  coalesce((
    select array_agg(distinct fact.fund_name order by fact.fund_name)
    from public.party_exposure_current fact
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as fund_names,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.party_aliases) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as party_aliases,
  coalesce((
    select array_agg(distinct value order by value)
    from public.party_exposure_current fact
    cross join lateral unnest(fact.party_group_names) value
    where fact.role_type = totals.role_type and fact.party_id = totals.party_id
  ), array[]::text[]) as party_group_names
from totals;

create or replace view public.party_exposure_facets as
with facet_rows as (
  select exposure_uid, role_type, party_id, fund_id,
         committed_amt, invested_amt, drawn_amt, remaining_amt, primary_amount,
         'role_class'::text as facet_name, role_class as facet_value
  from public.party_exposure_current
  union all
  select exposure_uid, role_type, party_id, fund_id,
         committed_amt, invested_amt, drawn_amt, remaining_amt, primary_amount,
         'party_origin', party_origin
  from public.party_exposure_current
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id,
         fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'base_asset_class', value
  from public.party_exposure_current fact cross join lateral unnest(fact.base_asset_classes) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id,
         fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'region', value
  from public.party_exposure_current fact cross join lateral unnest(fact.regions) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id,
         fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'vehicle_type', value
  from public.party_exposure_current fact cross join lateral unnest(fact.vehicle_types) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id,
         fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'operational_status', value
  from public.party_exposure_current fact cross join lateral unnest(fact.operational_statuses) value
  union all
  select fact.exposure_uid, fact.role_type, fact.party_id, fact.fund_id,
         fact.committed_amt, fact.invested_amt, fact.drawn_amt, fact.remaining_amt, fact.primary_amount,
         'party_group', value
  from public.party_exposure_current fact cross join lateral unnest(fact.party_group_names) value
),
deduplicated as (
  select distinct on (role_type, exposure_uid, facet_name, facet_value) *
  from facet_rows
  where nullif(btrim(facet_value), '') is not null
  order by role_type, exposure_uid, facet_name, facet_value
)
select
  role_type,
  facet_name,
  facet_value,
  count(distinct exposure_uid)::int as exposure_count,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as fund_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  coalesce(sum(primary_amount), 0)::bigint as primary_amount
from deduplicated
group by role_type, facet_name, facet_value;

create or replace view public.party_exposure_timeseries as
select
  role_type,
  base_date,
  role_class,
  party_origin,
  count(*)::int as exposure_count,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as fund_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  coalesce(sum(primary_amount), 0)::bigint as primary_amount
from public.party_exposure_fact
group by role_type, base_date, role_class, party_origin;

-- Keep the expensive relationship interpretation private and expose a refreshable
-- cache through the stable public fact contract. Downstream views retain the same
-- public relation and column contract, but dashboard reads no longer recompute the
-- full relationship graph on every REST request.
create schema if not exists ra_internal;

do $party_fact_cache$
declare
  source_definition text;
begin
  if to_regclass('ra_internal.party_exposure_fact_source') is null then
    select pg_get_viewdef('public.party_exposure_fact'::regclass, true)
      into source_definition;
    execute 'create view ra_internal.party_exposure_fact_source as ' || source_definition;
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ra_internal'
      and relation.relname = 'party_exposure_fact_cache'
      and relation.relkind = 'm'
  ) then
    execute 'create materialized view ra_internal.party_exposure_fact_cache '
         || 'as select * from ra_internal.party_exposure_fact_source with no data';
  end if;
end;
$party_fact_cache$;

refresh materialized view ra_internal.party_exposure_fact_cache;

create unique index if not exists party_exposure_fact_cache_uid_uq
  on ra_internal.party_exposure_fact_cache (exposure_uid);
create index if not exists party_exposure_fact_cache_role_fund_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, fund_id, base_date);
create index if not exists party_exposure_fact_cache_role_party_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, party_id, base_date);
create index if not exists party_exposure_fact_cache_role_date_idx
  on ra_internal.party_exposure_fact_cache (role_type, base_date);

create or replace view public.party_exposure_fact as
select * from ra_internal.party_exposure_fact_cache;

create or replace function public.refresh_party_exposure_surfaces()
returns void
language plpgsql
security definer
set search_path = public, ra_internal
set statement_timeout = 0
as $$
begin
  refresh materialized view ra_internal.party_exposure_fact_cache;
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.refresh_party_exposure_surfaces() from public;
grant execute on function public.refresh_party_exposure_surfaces() to service_role;

create or replace view public.party_exposure_contract_audit as
with source_totals as (
  select 'beneficiary'::text as role_type, base_date,
         count(*)::bigint as row_count,
         coalesce(sum(committed_amt), 0)::numeric as committed_amt,
         coalesce(sum(invested_amt), 0)::numeric as primary_amount,
         coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
  from public.beneficiary_exposures
  group by base_date
  union all
  select 'lender'::text, base_date, count(*)::bigint,
         coalesce(sum(committed_amt), 0)::numeric,
         coalesce(sum(drawn_amt), 0)::numeric,
         coalesce(sum(remaining_amt), 0)::numeric
  from public.lender_exposures
  group by base_date
),
fact_totals as (
  select role_type, base_date, count(*)::bigint as row_count,
         coalesce(sum(committed_amt), 0)::numeric as committed_amt,
         coalesce(sum(primary_amount), 0)::numeric as primary_amount,
         coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
  from public.party_exposure_fact
  group by role_type, base_date
),
current_totals as (
  select role_type, count(*)::bigint as row_count,
         coalesce(sum(committed_amt), 0)::numeric as committed_amt,
         coalesce(sum(primary_amount), 0)::numeric as primary_amount,
         coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
  from public.party_exposure_current
  group by role_type
),
class_totals as (
  select role_type, sum(row_count)::bigint as row_count,
         sum(committed_amt)::numeric as committed_amt,
         sum(primary_amount)::numeric as primary_amount,
         sum(remaining_amt)::numeric as remaining_amt
  from (
    select role_type, role_class, count(*)::bigint as row_count,
           coalesce(sum(committed_amt), 0)::numeric as committed_amt,
           coalesce(sum(primary_amount), 0)::numeric as primary_amount,
           coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
    from public.party_exposure_current
    group by role_type, role_class
  ) subtotal
  group by role_type
)
select
  coalesce((
    select bool_and(
      source.row_count = fact.row_count
      and source.committed_amt = fact.committed_amt
      and source.primary_amount = fact.primary_amount
      and source.remaining_amt = fact.remaining_amt
    )
    from source_totals source
    join fact_totals fact using (role_type, base_date)
  ), false) as source_fact_totals_match,
  coalesce((
    select bool_and(
      current.row_count = subtotal.row_count
      and current.committed_amt = subtotal.committed_amt
      and current.primary_amount = subtotal.primary_amount
      and current.remaining_amt = subtotal.remaining_amt
    )
    from current_totals current
    join class_totals subtotal using (role_type)
  ), false) as role_class_subtotals_match,
  (select count(*)::int from public.beneficiary_exposures where party_id is null)
    + (select count(*)::int from public.lender_exposures where party_id is null)
    as missing_party_id_rows,
  (select count(*)::int
   from (
     select role_type, source_exposure_id
     from public.party_exposure_current
     group by role_type, source_exposure_id
     having count(*) > 1
   ) duplicate) as duplicate_current_exposures,
  (select count(*)::int
   from (
     select 'beneficiary'::text as role_type, party_id from public.beneficiary_exposures
     union
     select 'lender'::text, party_id from public.lender_exposures
   ) observed
   where observed.party_id is not null
     and not exists (
       select 1 from public.party_role_classifications classification
       where classification.party_id = observed.party_id
         and classification.role_type = observed.role_type
         and classification.valid_to is null
     )) as missing_role_classifications,
  coalesce((
    select bool_and(
      classification.role_class = '해외LP'
      and party.party_origin = '해외'
      and party.domicile_country_code = 'SG'
    )
    from public.party_master party
    join public.party_role_classifications classification
      on classification.party_id = party.party_id
     and classification.role_type = 'beneficiary'
     and classification.valid_to is null
    where party.party_key = public.normalize_party_key('GIC')
  ), false) as gic_contract_valid;

do $$
declare
  audit record;
  before_mismatch integer;
begin
  select * into audit from public.party_exposure_contract_audit;
  if audit.source_fact_totals_match is not true
     or audit.role_class_subtotals_match is not true
     or audit.missing_party_id_rows <> 0
     or audit.duplicate_current_exposures <> 0
     or audit.missing_role_classifications <> 0
     or audit.gic_contract_valid is not true then
    raise exception 'Clean party contract verification failed: %', row_to_json(audit);
  end if;

  select count(*)::int
  into before_mismatch
  from party_exposure_totals_before before
  full join (
    select role_type, base_date, count(*)::bigint as row_count,
           coalesce(sum(committed_amt), 0)::numeric as committed_amt,
           coalesce(sum(primary_amount), 0)::numeric as primary_amount,
           coalesce(sum(remaining_amt), 0)::numeric as remaining_amt
    from public.party_exposure_fact
    group by role_type, base_date
  ) after using (role_type, base_date)
  where before.role_type is null
     or after.role_type is null
     or before.row_count <> after.row_count
     or before.committed_amt <> after.committed_amt
     or before.primary_amount <> after.primary_amount
     or before.remaining_amt <> after.remaining_amt;

  if before_mismatch <> 0 then
    raise exception 'Pre/post amount totals changed in % role/date groups', before_mismatch;
  end if;

  if exists (
    select 1
    from public.party_identity_map
    group by role_type, source_name_key
    having count(*) > 1
  ) then
    raise exception 'Duplicate role/source identity keys remain';
  end if;

  if exists (
    select 1
    from public.party_role_classifications
    where valid_to is null
    group by party_id, role_type
    having count(*) > 1
  ) then
    raise exception 'Multiple active role classifications remain';
  end if;
end;
$$;

grant select on public.party_identity_map to anon, authenticated;
grant select on public.party_role_classifications to anon, authenticated;
grant select on public.party_groups to anon, authenticated;
grant select on public.party_group_memberships to anon, authenticated;
grant select on public.party_external_identifiers to anon, authenticated;
grant select on public.beneficiary_exposure_source_metadata to anon, authenticated;
grant select on public.lender_exposure_source_metadata to anon, authenticated;
grant select on public.party_exposure_fact to anon, authenticated;
grant select on public.party_exposure_current to anon, authenticated;
grant select on public.party_exposure_rankings to anon, authenticated;
grant select on public.party_exposure_facets to anon, authenticated;
grant select on public.party_exposure_timeseries to anon, authenticated;
grant select on public.party_exposure_contract_audit to anon, authenticated;

comment on table public.party_identity_map is
  'Role-scoped source spelling to canonical party identity map. Raw names remain in exposure facts.';
comment on table public.party_role_classifications is
  'Role-specific controlled classification. Investor and lender semantics never overwrite party identity.';
comment on table public.party_groups is
  'Canonical corporate or institutional group identity.';
comment on table public.party_group_memberships is
  'Party-to-parent-group relation with evidence and validity metadata.';
comment on table public.beneficiary_exposure_source_metadata is
  'Source workbook fields and row lineage separated from canonical investor classification.';
comment on table public.lender_exposure_source_metadata is
  'Source workbook fields and row lineage separated from canonical lender classification.';
comment on view public.party_exposure_fact is
  'One row per exposure across all snapshots. Asset relations are arrays and never multiply amounts.';
comment on view public.party_exposure_current is
  'Latest per-fund snapshot for each role, preserving one row per source exposure.';
comment on view public.party_exposure_timeseries is
  'Role-class and origin time series at source snapshot grain.';
comment on schema ra_archive is
  'Read-only migration archive for retired contracts; not an operational query surface.';

commit;`;

await fs.writeFile(migrationPath, sql.replace(/^\uFEFF/, ''), 'utf8');
console.log(JSON.stringify({
  migrationPath,
  bytes: Buffer.byteLength(sql, 'utf8'),
  counts: Object.fromEntries(Object.entries(seeds).map(([name, rows]) => [name, rows.length])),
}, null, 2));
