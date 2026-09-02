(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var FETCH_PAGE_SIZE = 1000;
  var MAX_COMPARE = 5;
  var MILLION = 1000000;
  var MOBILE_BREAKPOINT = 760;

  var ROLE_CLASS_VALUES = {
    beneficiary: ['국내LP', '해외LP', '펀드·리츠·SPC', '금융기관', '일반기업', '공기업', '개인', '기타'],
    lender: ['은행', '보험', '증권', '저축은행', '캐피탈·여전', '신용협동조합', '새마을금고', '유동화SPV', '펀드·투자기구', '자산운용', '대주단', '일반기업', '개인', '기타', '미확인']
  };

  var ROLE_CLASS_COLORS = {
    '국내LP': '#4ea8de',
    '해외LP': '#72c7c1',
    '펀드·리츠·SPC': '#bb9cf2',
    '금융기관': '#f2cc5c',
    '일반기업': '#8d9ef0',
    '공기업': '#69c48d',
    '개인': '#f29b76',
    '은행': '#4ea8de',
    '보험': '#72c7c1',
    '증권': '#f2cc5c',
    '저축은행': '#8d9ef0',
    '캐피탈·여전': '#d98bd8',
    '신용협동조합': '#69c48d',
    '새마을금고': '#b7cf67',
    '유동화SPV': '#f29b76',
    '펀드·투자기구': '#8bc6ec',
    '자산운용': '#bb9cf2',
    '대주단': '#e4a95e',
    '기타': '#8f98a8',
    '미확인': '#656d78'
  };

  var ROLE_DETAIL_COLORS = {
    '연기금': '#4ea8de',
    '공제회': '#72c7c1',
    '펀드': '#f2cc5c',
    '조합': '#8d9ef0',
    '상장공모리츠': '#69c48d',
    '사모리츠': '#f29b76',
    '기타 투자기관': '#bb9cf2',
    '전문투자자': '#e4a95e',
    '일반투자자': '#8bc6ec',
    '복수 세부분류': '#a7adb8',
    '세부 미분류': '#656d78'
  };

  var ROLE_CONFIG = {
    beneficiary: {
      label: '에쿼티 투자자',
      countLabel: '투자자',
      currentLabel: '투입액',
      committedLabel: '약정액',
      remainingLabel: '미투입액',
      csvPrefix: 'equity_investor_ranking'
    },
    lender: {
      label: '대주',
      countLabel: '대주',
      currentLabel: '실행액',
      committedLabel: '약정액',
      remainingLabel: '미실행액',
      csvPrefix: 'lender_ranking'
    }
  };

  var FILTER_CONFIG = {
    search: { label: '검색어', property: 'searchText', type: 'search' },
    roleClass: { label: '역할분류', property: 'roleClass', type: 'scalar' },
    partyOrigin: { label: '권역', property: 'partyOrigin', type: 'scalar' },
    baseAssetClass: { label: '기초자산', property: 'baseAssetClasses', type: 'array' },
    region: { label: '지역', property: 'regions', type: 'array' },
    vehicleType: { label: '투자기구', property: 'vehicleTypes', type: 'array' },
    operationalStatus: { label: '운용상태', property: 'operationalStatuses', type: 'array' },
    minimumAmount: { label: '최소 약정액', property: 'committedAmount', type: 'amount' }
  };

  var FILTER_ELEMENT_IDS = {
    roleClass: 'capitalRoleClassFilter',
    partyOrigin: 'capitalPartyOriginFilter',
    baseAssetClass: 'capitalBaseAssetFilter',
    region: 'capitalRegionFilter',
    vehicleType: 'capitalVehicleTypeFilter',
    operationalStatus: 'capitalOperationalStatusFilter',
    minimumAmount: 'capitalMinimumAmountInput'
  };

  var FACET_NAME_MAP = {
    role_class: 'roleClass',
    party_origin: 'partyOrigin',
    investor_origin: 'partyOrigin',
    lp_scope: 'partyOrigin',
    base_asset_class: 'baseAssetClass',
    base_asset_classes: 'baseAssetClass',
    asset_type: 'baseAssetClass',
    asset_types: 'baseAssetClass',
    region: 'region',
    regions: 'region',
    vehicle_type: 'vehicleType',
    vehicle_types: 'vehicleType',
    operational_status: 'operationalStatus',
    operational_statuses: 'operationalStatus'
  };

  var state = {
    mode: 'portfolio',
    role: 'beneficiary',
    directFacts: [],
    facts: [],
    historicalFacts: [],
    rankings: [],
    facets: [],
    results: [],
    filtered: [],
    filters: emptyFilters(),
    page: 1,
    pageSize: PAGE_SIZE,
    selectedIds: new Set(),
    source: '',
    sourceLabel: '',
    snapshotDate: '',
    loaded: false,
    loading: false,
    loadPromise: null,
    loadErrors: [],
    duplicateFactsSuppressed: 0,
    economicDuplicatesSuppressed: 0,
    suppressedEconomicDuplicates: [],
    invalidContractRows: 0,
    internalFundRowsExcluded: 0,
    internalFundPartiesExcluded: 0,
    internalFundCommittedExcluded: 0,
    internalFundCoveredParties: 0,
    internalFundCoveredCommitted: 0,
    internalFundMissingParties: 0,
    internalFundMissingCommitted: 0,
    internalShellRowsExcluded: 0,
    internalShellPartiesExcluded: 0,
    internalShellCommittedExcluded: 0,
    delegatedLookthroughRows: 0,
    delegatedLookthroughCommitted: 0,
    paidInUnavailableRows: 0,
    historyMetric: 'committed',
    historyAggregation: 'annual',
    selectedHistoryDate: '',
    notice: null,
    hostKind: '',
    searchTimer: null,
    resizeTimer: null
  };

  function emptyFilters() {
    return {
      search: '',
      roleClass: '',
      partyOrigin: '',
      baseAssetClass: '',
      region: '',
      vehicleType: '',
      operationalStatus: '',
      minimumAmount: ''
    };
  }

  function hasValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }

  function pick(row, keys, fallback) {
    for (var i = 0; i < keys.length; i += 1) {
      if (hasValue(row[keys[i]])) return row[keys[i]];
    }
    return fallback;
  }

  function numberValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (!hasValue(value)) return 0;
    var text = String(value).trim().replace(/,/g, '');
    var negative = /^\(.*\)$/.test(text);
    text = text.replace(/[()]/g, '').replace(/[^0-9.+-]/g, '');
    var parsed = Number(text);
    if (!Number.isFinite(parsed)) return 0;
    return negative ? -Math.abs(parsed) : parsed;
  }

  function normalizeText(value) {
    return hasValue(value) ? String(value).replace(/\u00a0/g, ' ').trim() : '';
  }

  function searchToken(value) {
    return normalizeText(value).toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
  }

  function unique(values) {
    var seen = new Set();
    var result = [];
    (values || []).forEach(function (value) {
      var text = normalizeText(value);
      var key = text.toLocaleLowerCase('ko-KR');
      if (!text || seen.has(key) || ['null', 'undefined', 'n/a', 'none', 'nan', '-'].includes(key)) return;
      seen.add(key);
      result.push(text);
    });
    return result;
  }

  function arrayValue(value) {
    if (!hasValue(value)) return [];
    if (Array.isArray(value)) {
      return unique(value.reduce(function (all, item) { return all.concat(arrayValue(item)); }, []));
    }
    if (typeof value === 'object') {
      return unique(Object.keys(value).reduce(function (all, key) {
        return all.concat(arrayValue(value[key]));
      }, []));
    }

    var text = normalizeText(value);
    if (!text) return [];
    if ((text[0] === '[' && text[text.length - 1] === ']') || (text[0] === '{' && text[text.length - 1] === '}')) {
      try {
        if (text[0] === '[') return arrayValue(JSON.parse(text));
      } catch (error) {
        // PostgreSQL array strings are handled below.
      }
      text = text.slice(1, -1);
    }
    var matches = text.match(/"(?:\\.|[^"])*"|[^,，、;|]+/g) || [];
    return unique(matches.map(function (item) {
      return item.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"');
    }));
  }

  function combinedArray(row, arrayKeys, scalarKeys) {
    var values = [];
    arrayKeys.forEach(function (key) { values = values.concat(arrayValue(row[key])); });
    scalarKeys.forEach(function (key) {
      if (hasValue(row[key])) values = values.concat(arrayValue(row[key]));
    });
    return unique(values);
  }

  function normalizeRole(row) {
    var raw = searchToken(pick(row, ['role_type', 'party_role', 'role', 'exposure_role', 'source_role', 'entity_role'], ''));
    if (raw.includes('lender') || raw.includes('대주') || raw.includes('loan')) return 'lender';
    if (raw.includes('beneficiary') || raw.includes('수익자') || raw.includes('equity') || raw.includes('investor')) return 'beneficiary';
    if (hasValue(pick(row, ['lender_name', 'lender_clean', 'lender_raw'], ''))) return 'lender';
    if (numberValue(pick(row, ['drawn_amt', 'drawn_amount', 'executed_amt', 'executed_amount'], 0)) > 0) return 'lender';
    if (hasValue(pick(row, ['beneficiary_name', 'beneficiary_clean', 'beneficiary_raw'], ''))) return 'beneficiary';
    return 'beneficiary';
  }

  function normalizedReviewStatus(value) {
    var text = normalizeText(value);
    if (!text) return '확정';
    return text;
  }

  function normalizedPartyOrigin(value) {
    var raw = searchToken(value);
    if (['국내', '국내lp', 'domestic', 'korea', 'kr'].includes(raw)) return '국내';
    if (['해외', '글로벌lp', 'global', 'foreign', 'overseas'].includes(raw)) return '해외';
    if (['확인필요', '미확인', 'unknown', 'review'].includes(raw)) return '확인 필요';
    return '확인 필요';
  }

  function partyOriginDisplay(value, role) {
    var origin = normalizedPartyOrigin(value, '', '');
    if (origin === '국내') return role === 'lender' ? '국내 대주' : '국내 투자자';
    if (origin === '해외') return role === 'lender' ? '글로벌 대주' : '해외 투자자';
    return '확인 필요';
  }

  function normalizePartyRow(row, index, sourceKind) {
    var role = normalizeRole(row);
    var partyName = normalizeText(pick(row, [
      'canonical_account_name', 'party_name', 'party_display_name', 'display_name', 'canonical_party_name', 'normalized_party_name',
      role === 'lender' ? 'lender_clean' : 'beneficiary_clean',
      role === 'lender' ? 'lender_name' : 'beneficiary_name',
      role === 'lender' ? 'lender_raw' : 'beneficiary_raw'
    ], '명칭 미상'));
    var partyId = normalizeText(pick(row, [
      'canonical_account_id', 'party_id', 'canonical_party_id', 'counterparty_id',
      role === 'lender' ? 'lender_party_id' : 'beneficiary_party_id'
    ], ''));
    var committed = numberValue(pick(row, [
      'committed_amt', 'committed_amount', 'commitment_amt', 'commitment_amount', 'total_commitment',
      'agreed_amt', 'agreed_amount', 'committed_won'
    ], 0));
    var currentKeys = role === 'lender'
      ? ['drawn_amt', 'drawn_amount', 'executed_amt', 'executed_amount', 'funded_amt', 'loan_amount', 'current_amt', 'exposure_amt']
      : ['invested_amt', 'invested_amount', 'paid_in_amt', 'paid_in_amount', 'contributed_amt', 'investment_amt', 'current_amt', 'exposure_amt'];
    var paidInAvailable = row.paid_in_available !== false;
    var current = paidInAvailable ? numberValue(pick(row, currentKeys, 0)) : 0;
    var remainingRaw = pick(row, ['remaining_amt', 'remaining_amount', 'undrawn_amt', 'unfunded_amt', 'uninvested_amt'], null);
    var remaining = paidInAvailable
      ? (hasValue(remainingRaw) ? numberValue(remainingRaw) : Math.max(0, committed - current))
      : 0;
    var reviewStatuses = combinedArray(row, ['review_statuses'], [
       'review_status', 'classification_review_status', 'party_review_status'
    ]).map(normalizedReviewStatus);
    if (reviewStatuses.length === 0) reviewStatuses = ['확정'];

    var roleClass = normalizeText(row.role_class) || (role === 'lender' ? '미확인' : '기타');
    var roleSubtype = normalizeText(row.role_subtype);
    var qualityFlags = combinedArray(row, ['quality_flags'], ['quality_flag', 'relationship_quality']);
    if (!partyId) qualityFlags.push('missing_party_id');
    if (!normalizeText(row.role_class)) qualityFlags.push('missing_role_class');
    if (!ROLE_CLASS_VALUES[role].includes(roleClass)) qualityFlags.push('unexpected_role_class');
    if (!paidInAvailable) qualityFlags.push('paid_in_unavailable');
    var normalized = {
      role: role,
      partyId: partyId,
      partyName: partyName,
      roleClass: roleClass,
      roleSubtype: roleSubtype,
      sourcePartyTypes: combinedArray(row, ['source_party_types'], ['source_party_type']),
      sourcePartyCategories: combinedArray(row, ['source_party_categories'], ['source_party_category']),
      investorManagedFundIds: combinedArray(row, ['investor_managed_fund_ids'], []),
      investorManagedFundNames: combinedArray(row, ['investor_managed_fund_names'], []),
      capitalScope: normalizeText(row.capital_scope) || 'external_party',
      includeInExternalInvestorRollup: row.include_in_external_investor_rollup !== false,
      isManagedFundParty: row.is_managed_fund_party === true,
      isInternalFundLookthroughShell: row.is_internal_fund_lookthrough_shell === true
        || normalizeText(row.capital_scope) === 'internal_fund_lookthrough_shell',
      lookthroughCoverageStatus: normalizeText(row.lookthrough_coverage_status) || 'not_applicable',
      upstreamBeneficiaryRows: numberValue(row.upstream_beneficiary_rows),
      upstreamBeneficiaryParties: numberValue(row.upstream_beneficiary_parties),
      upstreamCommittedAmount: numberValue(row.upstream_committed_amt),
      partyOrigin: normalizedPartyOrigin(row.party_origin),
      domicileCountryCode: normalizeText(pick(row, ['domicile_country_code', 'party_country_code'], '')),
      committedAmount: committed,
      currentAmount: current,
      remainingAmount: remaining,
      paidInAvailable: paidInAvailable,
      relationshipLayer: normalizeText(row.relationship_layer) || 'DIRECT_SOURCE_RELATIONSHIP',
      assetTypes: combinedArray(row, ['asset_types'], ['asset_type']),
      baseAssetClasses: combinedArray(row, ['base_asset_classes'], ['base_asset_class', 'underlying_asset_type']),
      regions: combinedArray(row, ['regions'], ['region', 'domestic_overseas', 'country_name']),
      strategies: combinedArray(row, ['strategies'], ['strategy', 'investment_strategy']),
      businessStages: combinedArray(row, ['business_stages'], ['business_stage', 'business_stage_class']),
      vehicleTypes: combinedArray(row, ['vehicle_types'], ['vehicle_type', 'fund_type']),
      operationalStatuses: combinedArray(row, ['operational_statuses'], ['operational_status', 'fund_status']),
      reviewStatuses: unique(reviewStatuses),
      fundIds: combinedArray(row, ['fund_ids'], ['fund_id', 'fund_code']),
      fundNames: combinedArray(row, ['fund_names'], ['fund_name', 'short_name']),
      assetIds: combinedArray(row, ['asset_ids'], ['asset_id', 'asset_code']),
      assetNames: combinedArray(row, ['asset_names'], ['asset_name', 'canonical_asset_name', 'physical_asset_name']),
      projectNames: combinedArray(row, ['project_names'], ['project_name']),
      aliasNames: combinedArray(row, ['party_aliases', 'aliases'], ['party_alias', 'alias_name']),
      partyGroupNames: combinedArray(row, ['party_group_names'], []),
      fundCount: numberValue(pick(row, ['fund_count', 'related_fund_count'], 0)),
      assetCount: numberValue(pick(row, ['asset_count', 'related_asset_count'], 0)),
      factCount: numberValue(pick(row, ['fact_count', 'exposure_count', 'row_count'], sourceKind === 'fact' ? 1 : 0)),
      snapshotDate: normalizeText(pick(row, ['base_date', 'snapshot_date', 'as_of_date', 'source_snapshot_date', 'latest_base_date'], '')),
      commitmentYear: normalizeText(pick(row, ['commitment_cohort_year', 'commitment_year'], '')),
      commitmentYearLabel: normalizeText(pick(row, ['commitment_cohort_year_label', 'commitment_year_label'], '')) || '미상',
      commitmentDate: normalizeText(pick(row, ['commitment_cohort_date', 'commitment_date'], '')),
      commitmentDateBasis: normalizeText(pick(row, ['commitment_date_basis'], '')),
      commitmentDateQuality: normalizeText(pick(row, ['commitment_date_quality'], '')) || 'unresolved',
      sourceStandardId: normalizeText(pick(row, ['source_standard_id', 'standard_party_id'], '')),
      remarks: normalizeText(pick(row, ['remarks', 'remark', 'note'], '')),
      exposureId: sourceKind === 'fact'
        ? normalizeText(pick(row, ['exposure_id', 'source_exposure_id', 'beneficiary_exposure_id', 'lender_exposure_id', 'id'], ''))
        : '',
      sourceKind: sourceKind,
      qualityFlags: unique(qualityFlags),
      sourceIndex: index
    };

    normalized.baseAssetClasses = unique(normalized.baseAssetClasses.concat(normalized.assetTypes));
    normalized.fundCount = Math.max(normalized.fundCount, normalized.fundIds.length);
    normalized.assetCount = Math.max(normalized.assetCount, normalized.assetIds.length);
    normalized.searchText = unique([
      normalized.partyName,
      normalized.partyId,
      normalized.roleClass,
      normalized.roleSubtype,
      normalized.partyOrigin,
      partyOriginDisplay(normalized.partyOrigin, normalized.role)
    ].concat(
      normalized.sourcePartyTypes,
      normalized.sourcePartyCategories,
      normalized.aliasNames,
      normalized.partyGroupNames,
      normalized.fundIds,
      normalized.fundNames,
      normalized.assetIds,
      normalized.assetNames,
      normalized.projectNames,
      normalized.baseAssetClasses,
      normalized.regions,
      normalized.strategies
    )).join(' ');
    return normalized;
  }

  function mergeArrayProperty(target, source, property) {
    target[property] = unique((target[property] || []).concat(source[property] || []));
  }

  function mergeFactRows(target, source) {
    [
      'assetTypes', 'baseAssetClasses', 'regions', 'strategies', 'businessStages', 'vehicleTypes',
      'operationalStatuses', 'reviewStatuses', 'fundIds', 'fundNames', 'assetIds', 'assetNames',
      'projectNames', 'aliasNames', 'partyGroupNames', 'sourcePartyTypes', 'sourcePartyCategories', 'qualityFlags'
    ].forEach(function (property) { mergeArrayProperty(target, source, property); });
    target.fundCount = Math.max(target.fundCount, source.fundCount, target.fundIds.length);
    target.assetCount = Math.max(target.assetCount, source.assetCount, target.assetIds.length);
    target.snapshotDate = target.snapshotDate > source.snapshotDate ? target.snapshotDate : source.snapshotDate;
    target.searchText = unique([target.searchText, source.searchText]).join(' ');
    if (Math.abs(target.currentAmount - source.currentAmount) > 1 || Math.abs(target.committedAmount - source.committedAmount) > 1) {
      target.qualityFlags = unique(target.qualityFlags.concat(['duplicate_amount_mismatch']));
    }
    return target;
  }

  function dedupeFactRows(rows, trackSuppressed) {
    var explicit = new Map();
    var output = [];
    var suppressed = 0;
    rows.forEach(function (row) {
      if (!row.exposureId) {
        output.push(row);
        return;
      }
      var key = row.role + '|' + row.snapshotDate + '|' + row.exposureId;
      if (!explicit.has(key)) {
        explicit.set(key, row);
        output.push(row);
        return;
      }
      mergeFactRows(explicit.get(key), row);
      suppressed += 1;
    });
    if (trackSuppressed) state.duplicateFactsSuppressed = suppressed;
    return output;
  }

  function aggregatePartyRows(rows) {
    var groups = new Map();
    rows.forEach(function (row) {
      if (!row.partyId) return;
      var key = row.role + '|' + row.partyId;
      if (!groups.has(key)) {
        groups.set(key, {
          resultId: key,
          role: row.role,
          partyId: row.partyId,
          partyName: row.partyName,
          roleClass: row.roleClass,
          roleSubtype: row.roleSubtype,
          sourcePartyTypes: [],
          sourcePartyCategories: [],
          partyOrigin: row.partyOrigin || '확인 필요',
          domicileCountryCode: row.domicileCountryCode || '',
          committedAmount: 0,
          currentAmount: 0,
          remainingAmount: 0,
          assetTypes: [],
          baseAssetClasses: [],
          regions: [],
          strategies: [],
          businessStages: [],
          vehicleTypes: [],
          operationalStatuses: [],
          reviewStatuses: [],
          fundIds: [],
          fundNames: [],
          assetIds: [],
          assetNames: [],
          projectNames: [],
          aliasNames: [],
          partyGroupNames: [],
          qualityFlags: [],
          fundCount: 0,
          assetCount: 0,
          factCount: 0,
          snapshotDate: '',
          roleClassValues: new Set(),
          roleSubtypeValues: new Set(),
          originValues: new Set(),
          countryCodeValues: new Set()
        });
      }
      var group = groups.get(key);
      group.committedAmount += row.committedAmount;
      group.currentAmount += row.currentAmount;
      group.remainingAmount += row.remainingAmount;
      group.factCount += row.factCount || 0;
      group.snapshotDate = group.snapshotDate > row.snapshotDate ? group.snapshotDate : row.snapshotDate;
      group.roleClassValues.add(row.roleClass);
      if (row.roleSubtype) group.roleSubtypeValues.add(row.roleSubtype);
      group.originValues.add(row.partyOrigin || '확인 필요');
      if (row.domicileCountryCode) group.countryCodeValues.add(row.domicileCountryCode);
      [
        'assetTypes', 'baseAssetClasses', 'regions', 'strategies', 'businessStages', 'vehicleTypes',
        'operationalStatuses', 'reviewStatuses', 'fundIds', 'fundNames', 'assetIds', 'assetNames',
        'projectNames', 'aliasNames', 'partyGroupNames', 'sourcePartyTypes', 'sourcePartyCategories', 'qualityFlags'
      ].forEach(function (property) { mergeArrayProperty(group, row, property); });
      group.fundCount = Math.max(group.fundCount, row.fundCount, group.fundIds.length);
      group.assetCount = Math.max(group.assetCount, row.assetCount, group.assetIds.length);
    });

    return Array.from(groups.values()).map(function (group) {
      var roleClassValues = Array.from(group.roleClassValues);
      var roleSubtypeValues = Array.from(group.roleSubtypeValues);
      var originValues = Array.from(group.originValues);
      var countryCodeValues = Array.from(group.countryCodeValues);
      if (roleClassValues.length > 1) group.qualityFlags.push('role_class_conflict');
      if (roleSubtypeValues.length > 1) group.qualityFlags.push('role_subtype_conflict');
      if (originValues.length > 1) group.qualityFlags.push('origin_conflict');
      group.roleClass = roleClassValues[0] || (group.role === 'lender' ? '미확인' : '기타');
      group.roleSubtype = roleSubtypeValues.join(' · ');
      group.partyOrigin = originValues.length === 1 ? originValues[0] : '확인 필요';
      group.domicileCountryCode = countryCodeValues.length === 1 ? countryCodeValues[0] : '';
      group.qualityFlags = unique(group.qualityFlags);
      group.searchText = unique([
        group.partyName,
        group.roleClass,
        group.roleSubtype,
        group.partyOrigin,
        partyOriginDisplay(group.partyOrigin, group.role)
      ].concat(
        [group.partyId],
        group.sourcePartyTypes,
        group.sourcePartyCategories,
        group.aliasNames,
        group.partyGroupNames,
        group.fundIds,
        group.fundNames,
        group.assetIds,
        group.assetNames,
        group.projectNames,
        group.baseAssetClasses,
        group.regions,
        group.strategies
      )).join(' ');
      delete group.roleClassValues;
      delete group.roleSubtypeValues;
      delete group.originValues;
      delete group.countryCodeValues;
      return group;
    });
  }

  async function fetchAllRows(viewName) {
    if (!window._supabase || typeof window._supabase.from !== 'function') {
      throw new Error('Supabase client is not initialized.');
    }
    var rows = [];
    var from = 0;
    for (var page = 0; page < 50; page += 1) {
      var response = await window._supabase.from(viewName).select('*').range(from, from + FETCH_PAGE_SIZE - 1);
      if (response.error) throw new Error(viewName + ': ' + response.error.message);
      var batch = response.data || [];
      rows = rows.concat(batch);
      if (batch.length < FETCH_PAGE_SIZE) break;
      from += FETCH_PAGE_SIZE;
    }
    return rows;
  }

  async function safeFetch(viewName) {
    try {
      return { view: viewName, rows: await fetchAllRows(viewName), error: null };
    } catch (error) {
      return { view: viewName, rows: [], error: error };
    }
  }

  function secureCapitalExposureEndpoint() {
    if (window.RA_CAPITAL_EXPOSURE_ENDPOINT) return window.RA_CAPITAL_EXPOSURE_ENDPOINT;
    var supabaseUrl = window.SUPABASE_URL || '';
    if (!supabaseUrl) throw new Error('Secure capital exposure endpoint is not configured.');
    return supabaseUrl.replace('.supabase.co', '.functions.supabase.co') + '/ra-capital-exposure';
  }

  async function safeSecureCapitalExposure() {
    var delegatedView = 'one_account_delegated_exposure_current_v1';
    var bridgeView = 'one_account_party_bridge_current_v1';
    try {
      var tokenGetter = window.RAAuth && (
        (typeof window.RAAuth.getSessionToken === 'function' && window.RAAuth.getSessionToken) ||
        (typeof window.RAAuth.getRememberToken === 'function' && window.RAAuth.getRememberToken)
      );
      var token = tokenGetter ? tokenGetter.call(window.RAAuth) : '';
      if (!token) throw new Error('RA Portal login session is required for One Account exposure.');
      var response = await fetch(secureCapitalExposureEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: token })
      });
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || 'Secure One Account exposure fetch failed.');
      }
      return {
        delegated: { view: delegatedView, rows: payload.delegated_exposures || [], error: null },
        bridge: { view: bridgeView, rows: payload.party_bridge || [], error: null }
      };
    } catch (error) {
      return {
        delegated: { view: delegatedView, rows: [], error: error },
        bridge: { view: bridgeView, rows: [], error: error }
      };
    }
  }

  function maxSnapshotDate(rows) {
    return rows.reduce(function (latest, row) {
      return row.snapshotDate && row.snapshotDate > latest ? row.snapshotDate : latest;
    }, '');
  }

  async function loadCapitalRelationshipData(force) {
    if (state.loaded && !force) return state.results;
    if (state.loadPromise && !force) return state.loadPromise;
    state.loading = true;
    state.loadErrors = [];
    state.loadPromise = Promise.all([
      safeFetch('party_exposure_external_current_v1'),
      safeSecureCapitalExposure()
    ]).then(function (responses) {
      var currentResponse = responses[0];
      var delegatedResponse = responses[1].delegated;
      var bridgeResponse = responses[1].bridge;
      state.loadErrors = currentResponse.error ? [currentResponse.error.message] : [];
      if (state.loadErrors.length) throw new Error(state.loadErrors.join(' / '));
      state.facets = [];
      var accountByParty = new Map();
      (bridgeResponse.rows || []).forEach(function (row) {
        if (!row.party_id || !row.account_id) return;
        accountByParty.set(String(row.party_id), {
          accountId: String(row.account_id),
          accountName: normalizeText(row.canonical_account_name)
        });
      });
      var decoratedDirect = (currentResponse.rows || []).map(function (row) {
        var account = accountByParty.get(String(row.party_id || ''));
        return account ? Object.assign({}, row, {
          canonical_account_id: account.accountId,
          canonical_account_name: account.accountName
        }) : row;
      });
      var combinedRows = decoratedDirect.concat(delegatedResponse.rows || []);
      var normalizedCurrent = combinedRows.map(function (row, index) {
        return normalizePartyRow(row, index, 'fact');
      });
      state.delegatedLookthroughRows = normalizedCurrent.filter(function (row) {
        return row.relationshipLayer === 'DELEGATED_BENEFICIARY_LOOKTHROUGH';
      }).length;
      state.delegatedLookthroughCommitted = normalizedCurrent.reduce(function (sum, row) {
        return sum + (row.relationshipLayer === 'DELEGATED_BENEFICIARY_LOOKTHROUGH' ? row.committedAmount : 0);
      }, 0);
      state.paidInUnavailableRows = normalizedCurrent.filter(function (row) { return !row.paidInAvailable; }).length;
      state.invalidContractRows = normalizedCurrent.filter(function (row) {
        return !row.partyId;
      }).length;
      state.directFacts = normalizedCurrent.filter(function (row) { return Boolean(row.partyId); });
      var excludedInternal = state.directFacts.filter(function (row) {
        return !row.includeInExternalInvestorRollup
          || row.isManagedFundParty
          || row.isInternalFundLookthroughShell
          || row.capitalScope === 'internal_managed_fund';
      });
      var excludedManagedFunds = excludedInternal.filter(function (row) {
        return row.isManagedFundParty || row.capitalScope === 'internal_managed_fund';
      });
      var excludedShells = excludedInternal.filter(function (row) {
        return row.isInternalFundLookthroughShell;
      });
      state.internalFundRowsExcluded = excludedManagedFunds.length;
      state.internalFundPartiesExcluded = unique(excludedManagedFunds.map(function (row) { return row.partyId; })).length;
      state.internalFundCommittedExcluded = excludedManagedFunds.reduce(function (sum, row) {
        return sum + row.committedAmount;
      }, 0);
      state.internalShellRowsExcluded = excludedShells.length;
      state.internalShellPartiesExcluded = unique(excludedShells.map(function (row) { return row.partyId; })).length;
      state.internalShellCommittedExcluded = excludedShells.reduce(function (sum, row) {
        return sum + row.committedAmount;
      }, 0);
      var coveredInternal = excludedManagedFunds.filter(function (row) {
        return row.lookthroughCoverageStatus === 'direct_upstream_available';
      });
      var missingInternal = excludedManagedFunds.filter(function (row) {
        return row.lookthroughCoverageStatus === 'direct_upstream_missing';
      });
      state.internalFundCoveredParties = unique(coveredInternal.map(function (row) { return row.partyId; })).length;
      state.internalFundCoveredCommitted = coveredInternal.reduce(function (sum, row) {
        return sum + row.committedAmount;
      }, 0);
      state.internalFundMissingParties = unique(missingInternal.map(function (row) { return row.partyId; })).length;
      state.internalFundMissingCommitted = missingInternal.reduce(function (sum, row) {
        return sum + row.committedAmount;
      }, 0);
      state.facts = state.directFacts.filter(function (row) {
        return row.includeInExternalInvestorRollup
          && !row.isManagedFundParty
          && !row.isInternalFundLookthroughShell
          && row.capitalScope !== 'internal_managed_fund';
      });
      var explicitDedupedFacts = dedupeFactRows(state.facts.filter(function (row) {
        return Boolean(row.partyId);
      }), true);
      var economicResult = window.ExposureDedupe && typeof window.ExposureDedupe.dedupe === 'function'
        ? window.ExposureDedupe.dedupe(explicitDedupedFacts)
        : { rows: explicitDedupedFacts, suppressed: [] };
      state.facts = economicResult.rows;
      state.suppressedEconomicDuplicates = economicResult.suppressed;
      state.economicDuplicatesSuppressed = economicResult.suppressed.length;
      state.historicalFacts = state.facts.slice();
      state.rankings = [];

      state.results = aggregatePartyRows(state.facts);
      state.source = delegatedResponse.error
        ? currentResponse.view
        : currentResponse.view + ' + ' + delegatedResponse.view;
      state.sourceLabel = '외부 투자자 기준 · 재간접 중간기구 '
        + (state.internalFundPartiesExcluded + state.internalShellPartiesExcluded) + '개 제외'
        + (state.delegatedLookthroughRows
          ? ' · 위탁 look-through ' + state.delegatedLookthroughRows + '건(약정만, 투입액 미제공)'
          : '');
      state.snapshotDate = maxSnapshotDate(state.facts);
      state.loaded = true;
      state.loading = false;
      state.loadPromise = null;
      populateFilterOptions();
      return state.results;
    }).catch(function (error) {
      state.loading = false;
      state.loaded = false;
      state.loadPromise = null;
      state.loadErrors.push(error.message);
      throw error;
    });
    return state.loadPromise;
  }

  function isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  }

  function currentHost() {
    return isMobile() ? document.getElementById('results') : document.getElementById('detailPanel');
  }

  function prepareCapitalHost() {
    var results = document.getElementById('results');
    var detail = document.getElementById('detailPanel');
    var mobile = isMobile();
    state.hostKind = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      if (detail && detail.querySelector('.capital-analysis-root')) detail.innerHTML = '';
      if (results) {
        results.style.display = 'flex';
        results.classList.add('capital-relationship-results');
        results.classList.remove('mobile-analysis-results');
      }
      return results;
    }
    if (results) {
      if (results.querySelector('.capital-analysis-root')) results.innerHTML = '';
      results.style.display = 'none';
      results.classList.remove('capital-relationship-results');
    }
    return detail;
  }

  function renderLoading() {
    var host = prepareCapitalHost();
    if (!host) return;
    host.innerHTML = '<div class="analytics-container capital-analysis-root"><div class="capital-state"><span class="capital-spinner" aria-hidden="true"></span><strong>자금관계 데이터를 집계하고 있습니다.</strong></div></div>';
  }

  function renderLoadError() {
    var host = prepareCapitalHost();
    if (!host) return;
    var details = state.loadErrors.length
      ? '<details><summary>조회 오류</summary><p>' + escapeHtml(state.loadErrors.join(' / ')) + '</p></details>'
      : '';
    host.innerHTML = [
      '<div class="analytics-container capital-analysis-root">',
      '<div class="capital-state capital-state-error">',
      '<strong>자금관계 분석 데이터를 불러오지 못했습니다.</strong>',
      '<button type="button" data-capital-action="retry">다시 조회</button>',
      details,
      '</div>',
      '</div>'
    ].join('');
  }

  function facetKeyFromRow(row) {
    var raw = searchToken(pick(row, ['facet_name', 'facet_key', 'field_name', 'column_name', 'type'], '')).replace(/\s+/g, '_');
    return FACET_NAME_MAP[raw] || '';
  }

  function facetValuesFor(key) {
    var config = FILTER_CONFIG[key];
    if (!config) return [];
    var values = [];
    var roleRows = state.results.filter(function (row) { return row.role === state.role; });
    roleRows.forEach(function (row) {
      if (config.type === 'array') values = values.concat(row[config.property] || []);
      else values.push(row[config.property]);
    });
    state.facets.forEach(function (row) {
      var role = normalizeRole(row);
      if (role !== state.role || facetKeyFromRow(row) !== key) return;
      values = values.concat(arrayValue(pick(row, ['facet_values', 'values', 'facet_value', 'value', 'label'], '')));
    });
    values = unique(values);
    if (key === 'roleClass') {
      var order = ROLE_CLASS_VALUES[state.role];
      return values.sort(function (a, b) {
        var aIndex = order.indexOf(a);
        var bIndex = order.indexOf(b);
        if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'ko');
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
    }
    return values.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  }

  function friendlyStatus(value) {
    var normalized = searchToken(value);
    if (['reviewrequired', 'needsreview', 'review', '검토필요'].includes(normalized)) return '검토 필요';
    if (['confirmed', 'verified', 'approved', '확정', '완료'].includes(normalized)) return '확정';
    if (['unresolved', '미해결', '미분류'].includes(normalized)) return '미해결';
    return normalizeText(value) || '확정';
  }

  function populateSelect(id, values, selected, formatter) {
    var select = document.getElementById(id);
    if (!select) return;
    var current = hasValue(selected) ? String(selected) : '';
    select.replaceChildren(new Option('전체', ''));
    values.forEach(function (value) {
      select.appendChild(new Option(formatter ? formatter(value) : value, value));
    });
    if (values.includes(current)) select.value = current;
    else if (current) {
      select.appendChild(new Option(formatter ? formatter(current) : current, current));
      select.value = current;
    }
    select.disabled = values.length === 0;
  }

  function populateFilterOptions() {
    populateSelect(FILTER_ELEMENT_IDS.roleClass, facetValuesFor('roleClass'), state.filters.roleClass);
    populateSelect(FILTER_ELEMENT_IDS.partyOrigin, facetValuesFor('partyOrigin'), state.filters.partyOrigin, function (value) {
      return partyOriginDisplay(value, state.role);
    });
    populateSelect(FILTER_ELEMENT_IDS.baseAssetClass, facetValuesFor('baseAssetClass'), state.filters.baseAssetClass);
    populateSelect(FILTER_ELEMENT_IDS.region, facetValuesFor('region'), state.filters.region);
    populateSelect(FILTER_ELEMENT_IDS.vehicleType, facetValuesFor('vehicleType'), state.filters.vehicleType);
    populateSelect(FILTER_ELEMENT_IDS.operationalStatus, facetValuesFor('operationalStatus'), state.filters.operationalStatus);
  }

  function readFilters() {
    var searchInput = document.getElementById('capitalSearchInput');
    state.filters.search = searchInput ? normalizeText(searchInput.value) : '';
    Object.keys(FILTER_ELEMENT_IDS).forEach(function (key) {
      var element = document.getElementById(FILTER_ELEMENT_IDS[key]);
      state.filters[key] = element ? normalizeText(element.value) : '';
    });
  }

  function writeFilters() {
    var searchInput = document.getElementById('capitalSearchInput');
    if (searchInput) searchInput.value = state.filters.search || '';
    Object.keys(FILTER_ELEMENT_IDS).forEach(function (key) {
      var element = document.getElementById(FILTER_ELEMENT_IDS[key]);
      if (element) element.value = state.filters[key] || '';
    });
  }

  function containsValue(values, selected) {
    var target = searchToken(selected);
    return (values || []).some(function (value) {
      var candidate = searchToken(value);
      return candidate === target || candidate.includes(target) || target.includes(candidate);
    });
  }

  function matchesFilters(row, options) {
    var opts = options || {};
    if (row.role !== state.role) return false;
    var filters = state.filters;
    if (filters.search) {
      var terms = normalizeText(filters.search).split(/\s+/).map(searchToken).filter(Boolean);
      var haystack = searchToken(row.searchText);
      if (!terms.every(function (term) { return haystack.includes(term); })) return false;
    }
    if (filters.roleClass && row.roleClass !== filters.roleClass) return false;
    if (filters.partyOrigin && row.partyOrigin !== filters.partyOrigin) return false;
    if (filters.baseAssetClass && !containsValue(row.baseAssetClasses, filters.baseAssetClass)) return false;
    if (filters.region && !containsValue(row.regions, filters.region)) return false;
    if (filters.vehicleType && !containsValue(row.vehicleTypes, filters.vehicleType)) return false;
    if (filters.operationalStatus && !containsValue(row.operationalStatuses, filters.operationalStatus)) return false;
    if (!opts.ignoreMinimum && filters.minimumAmount && row.committedAmount < numberValue(filters.minimumAmount) * MILLION) return false;
    return true;
  }

  function aggregateFactsForActiveFilters(rows) {
    var matchingFacts = dedupeFactRows((rows || []).filter(function (row) {
      return matchesFilters(row, { ignoreMinimum: true });
    }), false);
    var minimum = numberValue(state.filters.minimumAmount) * MILLION;
    return aggregatePartyRows(matchingFacts).filter(function (row) {
      return !minimum || row.committedAmount >= minimum;
    });
  }

  function applyCapitalFilters(options) {
    var opts = options || {};
    if (opts.read !== false) readFilters();
    state.filtered = aggregateFactsForActiveFilters(state.facts).sort(function (a, b) {
      return b.committedAmount - a.committedAmount || b.currentAmount - a.currentAmount || a.partyName.localeCompare(b.partyName, 'ko');
    });
    if (opts.keepPage !== true) state.page = 1;
    var maxPage = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = Math.min(state.page, maxPage);
    if (state.mode === 'capital') renderCapitalResults();
  }

  function sumRows(rows) {
    return rows.reduce(function (totals, row) {
      totals.committed += row.committedAmount;
      totals.current += row.currentAmount;
      totals.remaining += row.remainingAmount;
      return totals;
    }, { committed: 0, current: 0, remaining: 0 });
  }

  function classificationSubtotals(rows) {
    var groups = new Map();
    rows.forEach(function (row) {
      var key = row.roleClass || (row.role === 'lender' ? '미확인' : '기타');
      if (!groups.has(key)) groups.set(key, { label: key, parties: 0, committed: 0, current: 0, remaining: 0 });
      var group = groups.get(key);
      group.parties += 1;
      group.committed += row.committedAmount;
      group.current += row.currentAmount;
      group.remaining += row.remainingAmount;
    });
    return Array.from(groups.values()).sort(function (a, b) { return b.committed - a.committed; });
  }

  function reconcileSubtotals(rows, subtotals) {
    var total = sumRows(rows);
    var subtotal = subtotals.reduce(function (acc, row) {
      acc.committed += row.committed;
      acc.current += row.current;
      acc.remaining += row.remaining;
      return acc;
    }, { committed: 0, current: 0, remaining: 0 });
    var differences = {
      committed: subtotal.committed - total.committed,
      current: subtotal.current - total.current,
      remaining: subtotal.remaining - total.remaining
    };
    var valid = Object.keys(differences).every(function (key) {
      return Math.abs(differences[key]) <= Math.max(1, Math.abs(total[key]) * 1e-10);
    });
    return { total: total, subtotal: subtotal, differences: differences, valid: valid };
  }

  function formatInteger(value) {
    return Math.round(numberValue(value)).toLocaleString('ko-KR');
  }

  function formatMillion(value) {
    return formatInteger(numberValue(value) / MILLION);
  }

  function formatCompactWon(value) {
    var amount = numberValue(value);
    if (Math.abs(amount) >= 1000000000000) return (amount / 1000000000000).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '조';
    if (Math.abs(amount) >= 100000000) return (amount / 100000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억';
    return formatMillion(amount) + '백만';
  }

  function historyMetricProperty(metric) {
    if (metric === 'committed') return 'committedAmount';
    if (metric === 'remaining') return 'remainingAmount';
    return 'currentAmount';
  }

  function historyMetricLabel(metric) {
    var role = currentRoleConfig();
    if (metric === 'committed') return role.committedLabel;
    if (metric === 'remaining') return role.remainingLabel;
    return role.currentLabel;
  }

  function historyDetailValue(row) {
    var subtype = normalizeText(row.roleSubtype);
    if (subtype && subtype !== row.roleClass) return subtype;
    var categories = unique(row.sourcePartyCategories || []);
    if (categories.length === 1) return categories[0];
    if (categories.length > 1) return '복수 세부분류';
    var types = unique(row.sourcePartyTypes || []);
    if (types.length === 1) return types[0];
    if (types.length > 1) return '복수 세부분류';
    return '세부 미분류';
  }

  function historyBreakdownConfig() {
    var detailed = Boolean(state.filters.roleClass);
    var partyBreakdown = detailed;
    return {
      detailed: detailed,
      partyBreakdown: partyBreakdown,
      label: partyBreakdown
        ? (state.role === 'lender' ? '개별 대주' : '개별 투자자')
        : detailed
        ? '원천 세부분류'
        : (state.role === 'lender' ? '대주 유형' : '투자자 분류'),
      context: detailed ? state.filters.roleClass : '',
      value: partyBreakdown
        ? function (row) { return row.partyName || '투자자명 미상'; }
        : detailed
        ? historyDetailValue
        : function (row) { return row.roleClass || (row.role === 'lender' ? '미확인' : '기타'); }
    };
  }

  function historicalPartyBuckets() {
    var groups = new Map();
    var breakdown = historyBreakdownConfig();
    var eligiblePartyIds = new Set(state.filtered.map(function (row) { return row.partyId; }));
    state.historicalFacts.filter(function (row) {
      return row.commitmentYearLabel
        && eligiblePartyIds.has(row.partyId)
        && matchesFilters(row, { ignoreMinimum: true });
    }).forEach(function (row) {
      var key = row.commitmentYearLabel + '|' + row.role + '|' + row.partyId;
      if (!groups.has(key)) {
        groups.set(key, {
          commitmentYearLabel: row.commitmentYearLabel,
          role: row.role,
          partyId: row.partyId,
          roleClass: row.roleClass,
          committedAmount: 0,
          currentAmount: 0,
          remainingAmount: 0,
          roleClassValues: new Set()
        });
      }
      var bucket = groups.get(key);
      bucket.committedAmount += row.committedAmount;
      bucket.currentAmount += row.currentAmount;
      bucket.remainingAmount += row.remainingAmount;
      bucket.roleClassValues.add(breakdown.value(row));
    });

    return Array.from(groups.values()).map(function (bucket) {
      var classes = Array.from(bucket.roleClassValues);
      bucket.roleClass = classes.length === 1
        ? classes[0]
        : (breakdown.detailed ? '복수 세부분류' : (bucket.role === 'lender' ? '미확인' : '기타'));
      delete bucket.roleClassValues;
      return bucket;
    });
  }

  function historyChartData() {
    var metricProperty = historyMetricProperty(state.historyMetric);
    var breakdown = historyBreakdownConfig();
    var dateGroups = new Map();
    historicalPartyBuckets().forEach(function (bucket) {
      if (!dateGroups.has(bucket.commitmentYearLabel)) dateGroups.set(bucket.commitmentYearLabel, new Map());
      var classGroups = dateGroups.get(bucket.commitmentYearLabel);
      classGroups.set(bucket.roleClass, (classGroups.get(bucket.roleClass) || 0) + bucket[metricProperty]);
    });

    var dates = Array.from(dateGroups.keys()).sort(function (a, b) {
      if (a === '미상') return 1;
      if (b === '미상') return -1;
      return numberValue(a) - numberValue(b);
    });
    var chartGroups = dateGroups;
    if (state.historyAggregation === 'cumulative') {
      chartGroups = new Map();
      var running = new Map();
      dates.forEach(function (date) {
        dateGroups.get(date).forEach(function (amount, roleClass) {
          running.set(roleClass, (running.get(roleClass) || 0) + amount);
        });
        chartGroups.set(date, new Map(running));
      });
    }
    var presentClasses = new Set();
    dates.forEach(function (date) {
      chartGroups.get(date).forEach(function (amount, roleClass) {
        if (amount !== 0) presentClasses.add(roleClass);
      });
    });
    var configured = breakdown.detailed ? [] : ROLE_CLASS_VALUES[state.role];
    var classTotals = new Map();
    dates.forEach(function (date) {
      chartGroups.get(date).forEach(function (amount, roleClass) {
        classTotals.set(roleClass, (classTotals.get(roleClass) || 0) + amount);
      });
    });
    var classes = Array.from(presentClasses).sort(function (a, b) {
      if (breakdown.detailed) {
        return (classTotals.get(b) || 0) - (classTotals.get(a) || 0) || a.localeCompare(b, 'ko');
      }
      var aIndex = configured.indexOf(a);
      var bIndex = configured.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'ko');
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return {
      dates: dates,
      classes: classes,
      groups: chartGroups,
      metricProperty: metricProperty,
      metricLabel: historyMetricLabel(state.historyMetric),
      aggregation: state.historyAggregation,
      breakdownLabel: breakdown.label,
      breakdownContext: breakdown.context,
      detailedBreakdown: breakdown.detailed,
      partyBreakdown: breakdown.partyBreakdown
    };
  }

  function formatHistoryDate(value) {
    return normalizeText(value) || '미상';
  }

  function stringColor(value) {
    var hash = 0;
    String(value || '').split('').forEach(function (character) {
      hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    });
    var hue = Math.abs(hash * 137.508) % 360;
    return 'hsl(' + hue.toFixed(1) + ' 62% 60%)';
  }

  function roleClassColor(roleClass, index, data) {
    var fallback = ['#4ea8de', '#72c7c1', '#f2cc5c', '#8d9ef0', '#69c48d', '#f29b76', '#a7adb8'];
    if (data && data.partyBreakdown) return stringColor(roleClass);
    return ROLE_CLASS_COLORS[roleClass] || ROLE_DETAIL_COLORS[roleClass] || fallback[index % fallback.length];
  }

  function historyChartWidth() {
    var host = currentHost();
    var horizontalInset = isMobile() ? 56 : 96;
    var available = host && host.clientWidth ? host.clientWidth - horizontalInset : 960;
    return Math.round(Math.max(360, Math.min(1040, available)));
  }

  function historyAxisLabel(value, compact) {
    var label = formatHistoryDate(value);
    if (compact && /^\d{4}$/.test(label)) return label.slice(2);
    return label;
  }

  function renderHistorySvg(data) {
    var width = historyChartWidth();
    var height = 360;
    var left = width < 520 ? 50 : 68;
    var right = 16;
    var top = 42;
    var bottom = 52;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var totals = data.dates.map(function (date) {
      return data.classes.reduce(function (sum, roleClass) {
        return sum + (data.groups.get(date).get(roleClass) || 0);
      }, 0);
    });
    var maxTotal = Math.max.apply(null, totals.concat([0]));
    if (maxTotal <= 0) return '';

    var hasSelection = data.dates.indexOf(state.selectedHistoryDate) !== -1;
    var svg = [
      '<svg class="capital-history-svg' + (hasSelection ? ' has-selection' : '') + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="capitalHistoryTitle capitalHistoryDescription" style="max-width:' + width + 'px">',
      '<title id="capitalHistoryTitle">관계 발생연도별 ' + (data.aggregation === 'cumulative' ? '누적 ' : '') + escapeHtml(data.metricLabel) + ' 시계열</title>',
      '<desc id="capitalHistoryDescription">연도별 합계와 ' + escapeHtml(data.breakdownLabel) + '별 금액을 누적 막대로 표시합니다. 각 연도에 마우스를 올리면 구성을 미리 보고, 막대를 선택하면 차트 아래에서 전체 구성을 확인할 수 있습니다.</desc>'
    ];

    for (var tick = 0; tick <= 4; tick += 1) {
      var ratio = tick / 4;
      var y = top + plotHeight - plotHeight * ratio;
      var tickValue = maxTotal * ratio;
      svg.push('<line class="capital-history-gridline" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line>');
      svg.push('<text class="capital-history-axis-label" x="' + (left - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + escapeHtml(formatCompactWon(tickValue)) + '</text>');
    }

    var slot = plotWidth / data.dates.length;
    var barWidth = Math.min(34, Math.max(10, slot * 0.44));
    var compactAxis = slot < 32;
    var showTotals = slot >= 40;
    data.dates.forEach(function (date, dateIndex) {
      var center = left + slot * dateIndex + slot / 2;
      var cursorY = top + plotHeight;
      var ariaParts = [];
      var segmentSvg = [];
      data.classes.forEach(function (roleClass, classIndex) {
        var amount = data.groups.get(date).get(roleClass) || 0;
        if (amount <= 0) return;
        ariaParts.push(roleClass + ' ' + formatCompactWon(amount));
        var segmentHeight = Math.max(1, plotHeight * amount / maxTotal);
        cursorY -= segmentHeight;
        var color = roleClassColor(roleClass, classIndex, data);
        segmentSvg.push([
          '<rect class="capital-history-segment" x="', center - barWidth / 2, '" y="', cursorY,
          '" width="', barWidth, '" height="', segmentHeight, '" rx="2" fill="', color, '"></rect>'
        ].join(''));
      });
      var selected = state.selectedHistoryDate === date;
      var columnLabel = formatHistoryDate(date) + ' ' + data.metricLabel + ' 합계 ' + formatCompactWon(totals[dateIndex]) + '. ' + ariaParts.join(', ');
      svg.push('<g class="capital-history-column' + (selected ? ' is-selected' : '') + '" data-capital-history-index="' + dateIndex + '" data-capital-history-total="' + totals[dateIndex] + '" tabindex="0" focusable="true" role="button" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + escapeHtml(columnLabel) + '">');
      svg.push(segmentSvg.join(''));
      var totalY = Math.max(16, cursorY - 8);
      if (showTotals) {
        svg.push('<text class="capital-history-total" x="' + center + '" y="' + totalY + '" text-anchor="middle">' + escapeHtml(formatCompactWon(totals[dateIndex])) + '</text>');
      }
      svg.push('<text class="capital-history-date' + (compactAxis ? ' is-compact' : '') + '" x="' + center + '" y="' + (height - 19) + '" text-anchor="middle">' + escapeHtml(historyAxisLabel(date, compactAxis)) + '</text>');
      svg.push('<rect class="capital-history-hit" x="' + (center - slot / 2 + 1) + '" y="' + top + '" width="' + Math.max(8, slot - 2) + '" height="' + plotHeight + '"></rect>');
      svg.push('</g>');
    });
    svg.push('</svg>');
    return svg.join('');
  }

  function historyStackRows(data, dateIndex) {
    var date = data.dates[dateIndex];
    return data.classes.map(function (roleClass, classIndex) {
      return {
        label: roleClass,
        amount: data.groups.get(date).get(roleClass) || 0,
        color: roleClassColor(roleClass, classIndex, data)
      };
    }).filter(function (row) {
      return row.amount > 0;
    }).sort(function (a, b) {
      return b.amount - a.amount;
    });
  }

  function historyTooltipHtml(data, dateIndex) {
    var date = data.dates[dateIndex];
    var rows = historyStackRows(data, dateIndex);
    var total = rows.reduce(function (sum, row) { return sum + row.amount; }, 0);
    var yearLabel = formatHistoryDate(date);
    if (/^\d{4}$/.test(yearLabel)) yearLabel += '년';
    var rowHtml = rows.map(function (row) {
      var share = total > 0 ? row.amount / total * 100 : 0;
      return [
        '<div class="capital-history-tooltip-row">',
        '<span class="capital-history-tooltip-label"><i style="--history-color:' + row.color + '"></i>' + escapeHtml(row.label) + '</span>',
        '<span class="capital-history-tooltip-value"><strong>' + escapeHtml(formatCompactWon(row.amount)) + '</strong><small>' + share.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%</small></span>',
        '</div>'
      ].join('');
    }).join('');
    return [
      '<div class="capital-history-tooltip-heading"><span>' + escapeHtml(yearLabel) + '</span><small>' + (data.aggregation === 'cumulative' ? '누적 · ' : '') + escapeHtml(data.metricLabel) + '</small></div>',
      '<div class="capital-history-tooltip-total"><span>합계</span><strong>' + escapeHtml(formatCompactWon(total)) + '</strong></div>',
      '<div class="capital-history-tooltip-rows">' + rowHtml + '</div>'
    ].join('');
  }

  function historySelectionHtml(data) {
    var dateIndex = data.dates.indexOf(state.selectedHistoryDate);
    if (dateIndex < 0) return '';
    var rows = historyStackRows(data, dateIndex);
    var total = rows.reduce(function (sum, row) { return sum + row.amount; }, 0);
    var yearLabel = formatHistoryDate(data.dates[dateIndex]);
    if (/^\d{4}$/.test(yearLabel)) yearLabel += '년';
    var context = data.breakdownContext ? data.breakdownContext + ' 내부 ' : '';
    var rowHtml = rows.map(function (row, index) {
      var share = total > 0 ? row.amount / total * 100 : 0;
      return [
        '<tr>',
        '<td><span class="capital-history-selection-label"><span class="capital-history-selection-rank">' + (index + 1) + '</span><i style="--history-color:' + row.color + '"></i><strong>' + escapeHtml(row.label) + '</strong></span></td>',
        '<td class="capital-history-selection-amount"><strong>' + escapeHtml(formatCompactWon(row.amount)) + '</strong><small>' + escapeHtml(formatInteger(row.amount / MILLION)) + '백만원</small></td>',
        '<td class="capital-history-selection-share">' + share.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%</td>',
        '</tr>'
      ].join('');
    }).join('');
    return [
      '<section class="capital-history-selection" aria-label="' + escapeHtml(yearLabel) + ' 스택 상세">',
      '<header class="capital-history-selection-heading">',
      '<div><span>선택 연도</span><h4>' + escapeHtml(yearLabel) + ' ' + (data.aggregation === 'cumulative' ? '누적 ' : '') + escapeHtml(data.metricLabel) + ' 구성</h4><p>' + rows.length + '개 항목 · ' + escapeHtml(context + data.breakdownLabel) + '</p></div>',
      '<div class="capital-history-selection-total"><span>합계</span><strong>' + escapeHtml(formatCompactWon(total)) + '</strong></div>',
      '<button type="button" class="capital-history-selection-close" data-capital-history-clear aria-label="선택 연도 상세 닫기" title="선택 해제">×</button>',
      '</header>',
      '<div class="capital-history-selection-table-wrap">',
      '<table class="capital-history-selection-table">',
      '<thead><tr><th scope="col">구성 항목</th><th scope="col">금액</th><th scope="col">비중</th></tr></thead>',
      '<tbody>' + rowHtml + '</tbody>',
      '</table>',
      '</div>',
      '</section>'
    ].join('');
  }

  function bindHistoryTooltip(host) {
    var container = host && host.querySelector('.capital-history-scroll');
    if (!container) return;
    var tooltip = container.querySelector('.capital-history-tooltip');
    var svg = container.querySelector('.capital-history-svg');
    var selectionHost = host.querySelector('.capital-history-selection-host');
    if (!tooltip || !svg) return;
    var data = historyChartData();
    var activeColumn = null;

    function hideTooltip() {
      if (activeColumn) activeColumn.classList.remove('is-active');
      activeColumn = null;
      svg.classList.remove('has-active');
      tooltip.hidden = true;
    }

    function positionTooltip(clientX, clientY) {
      var bounds = container.getBoundingClientRect();
      var x = clientX - bounds.left;
      var y = clientY - bounds.top;
      var tooltipWidth = tooltip.offsetWidth;
      var tooltipHeight = tooltip.offsetHeight;
      var left = x + 14;
      var top = y - tooltipHeight - 14;
      if (left + tooltipWidth > container.clientWidth - 8) left = x - tooltipWidth - 14;
      if (top < 8) top = y + 14;
      left = Math.max(8, Math.min(left, container.clientWidth - tooltipWidth - 8));
      top = Math.max(8, Math.min(top, container.clientHeight - tooltipHeight - 8));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function showTooltip(column, event) {
      var dateIndex = Number(column.dataset.capitalHistoryIndex);
      if (!Number.isInteger(dateIndex) || !data.dates[dateIndex]) return;
      if (activeColumn && activeColumn !== column) activeColumn.classList.remove('is-active');
      activeColumn = column;
      activeColumn.classList.add('is-active');
      svg.classList.add('has-active');
      tooltip.innerHTML = historyTooltipHtml(data, dateIndex);
      tooltip.classList.toggle(
        'is-wide',
        tooltip.querySelectorAll('.capital-history-tooltip-row').length > 12
      );
      tooltip.hidden = false;
      var anchorBounds = column.getBoundingClientRect();
      var clientX = event && Number.isFinite(event.clientX) ? event.clientX : anchorBounds.left + anchorBounds.width / 2;
      var clientY = event && Number.isFinite(event.clientY) ? event.clientY : anchorBounds.top + Math.min(80, anchorBounds.height / 2);
      positionTooltip(clientX, clientY);
    }

    function syncSelection() {
      var hasSelection = false;
      svg.querySelectorAll('[data-capital-history-index]').forEach(function (column) {
        var date = data.dates[Number(column.dataset.capitalHistoryIndex)];
        var selected = Boolean(date) && date === state.selectedHistoryDate;
        column.classList.toggle('is-selected', selected);
        column.setAttribute('aria-pressed', selected ? 'true' : 'false');
        if (selected) hasSelection = true;
      });
      svg.classList.toggle('has-selection', hasSelection);
      if (selectionHost) selectionHost.innerHTML = historySelectionHtml(data);
    }

    function toggleSelection(column) {
      var dateIndex = Number(column.dataset.capitalHistoryIndex);
      var date = data.dates[dateIndex];
      if (!Number.isInteger(dateIndex) || !date) return;
      state.selectedHistoryDate = state.selectedHistoryDate === date ? '' : date;
      syncSelection();
    }

    container.addEventListener('pointermove', function (event) {
      var column = event.target.closest('[data-capital-history-index]');
      if (!column) {
        hideTooltip();
        return;
      }
      showTooltip(column, event);
    });
    container.addEventListener('pointerleave', hideTooltip);
    container.addEventListener('click', function (event) {
      var column = event.target.closest('[data-capital-history-index]');
      if (column) {
        toggleSelection(column);
        hideTooltip();
      }
    });
    container.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var column = event.target.closest('[data-capital-history-index]');
      if (!column) return;
      event.preventDefault();
      toggleSelection(column);
      hideTooltip();
    });
    container.addEventListener('focusin', function (event) {
      var column = event.target.closest('[data-capital-history-index]');
      if (column) showTooltip(column);
    });
    container.addEventListener('focusout', function (event) {
      if (!container.contains(event.relatedTarget)) hideTooltip();
    });
    if (selectionHost) {
      selectionHost.addEventListener('click', function (event) {
        if (!event.target.closest('[data-capital-history-clear]')) return;
        state.selectedHistoryDate = '';
        syncSelection();
      });
    }
  }

  function renderHistoryChart() {
    var data = historyChartData();
    if (state.selectedHistoryDate && data.dates.indexOf(state.selectedHistoryDate) === -1) {
      state.selectedHistoryDate = '';
    }
    var svg = renderHistorySvg(data);
    var eligiblePartyIds = new Set(state.filtered.map(function (row) { return row.partyId; }));
    var coverage = state.historicalFacts.filter(function (row) {
      return row.role === state.role
        && eligiblePartyIds.has(row.partyId)
        && matchesFilters(row, { ignoreMinimum: true });
    }).reduce(function (counts, row) {
      if (row.commitmentDateQuality === 'source_date') counts.source += 1;
      else if (row.commitmentDateQuality === 'proxy') counts.proxy += 1;
      else counts.unresolved += 1;
      return counts;
    }, { source: 0, proxy: 0, unresolved: 0 });
    var coverageText = '직접일자 ' + formatInteger(coverage.source) + '건 · 설정일 보정 ' + formatInteger(coverage.proxy) + '건';
    if (coverage.unresolved) coverageText += ' · 미상 ' + formatInteger(coverage.unresolved) + '건';
    var metricButtons = ['committed', 'current', 'remaining'].map(function (metric) {
      var active = state.historyMetric === metric;
      return '<button type="button" data-capital-history-metric="' + metric + '" aria-pressed="' + (active ? 'true' : 'false') + '" class="' + (active ? 'active' : '') + '">' + escapeHtml(historyMetricLabel(metric)) + '</button>';
    }).join('');
    var aggregationButtons = [
      { value: 'annual', label: '연도별' },
      { value: 'cumulative', label: '누적' }
    ].map(function (item) {
      var active = state.historyAggregation === item.value;
      return '<button type="button" data-capital-history-aggregation="' + item.value + '" aria-pressed="' + (active ? 'true' : 'false') + '" class="' + (active ? 'active' : '') + '">' + item.label + '</button>';
    }).join('');
    var legend = data.classes.map(function (roleClass, index) {
      return '<span><i style="--history-color:' + roleClassColor(roleClass, index, data) + '"></i>' + escapeHtml(roleClass) + '</span>';
    }).join('');
    var legendHtml = '';
    if (legend && data.partyBreakdown) {
      var partyLabel = state.role === 'lender' ? '대주' : '투자자';
      legendHtml = '<details class="capital-history-legend-panel"><summary>금액 표시 ' + partyLabel + ' ' + data.classes.length + '곳 범례</summary><div class="capital-history-legend" aria-label="개별 ' + partyLabel + ' 범례">' + legend + '</div></details>';
    } else if (legend) {
      legendHtml = '<div class="capital-history-legend" aria-label="' + escapeHtml(data.breakdownLabel) + ' 범례">' + legend + '</div>';
    }
    var stackContext = data.breakdownContext ? data.breakdownContext + ' 내부 ' : '';
    return [
      '<section class="capital-history-section" aria-label="관계 발생연도별 자금 시계열">',
      '<div class="capital-history-heading">',
      '<div><h3>' + (state.role === 'lender' ? '대출 실행연도' : '최초약정연도') + (state.historyAggregation === 'cumulative' ? ' 누적 금액' : '별 금액') + '</h3><p>' + (state.role === 'lender' ? '대출인출일 기준' : '최초약정일 기준') + ' · 스택 ' + escapeHtml(stackContext + data.breakdownLabel) + ' · ' + escapeHtml(coverageText) + ' · 금액 단위 백만원</p></div>',
      '<div class="capital-history-controls">',
      '<div class="capital-history-aggregation" role="group" aria-label="시계열 집계 방식">' + aggregationButtons + '</div>',
      '<div class="capital-history-metrics" role="group" aria-label="시계열 금액 기준">' + metricButtons + '</div>',
      '</div>',
      '</div>',
      svg ? '<div class="capital-history-scroll" tabindex="0">' + svg + '<div class="capital-history-tooltip" role="tooltip" hidden></div></div>' : '<div class="capital-history-empty">현재 조건에 표시할 시계열 금액이 없습니다.</div>',
      '<div class="capital-history-selection-host" aria-live="polite">' + (svg ? historySelectionHtml(data) : '') + '</div>',
      legendHtml,
      '</section>'
    ].join('');
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentRoleConfig() {
    return ROLE_CONFIG[state.role];
  }

  function activeFilterEntries() {
    return Object.keys(state.filters).filter(function (key) {
      return hasValue(state.filters[key]);
    }).map(function (key) {
      var value = state.filters[key];
      return {
        key: key,
        label: key === 'partyOrigin'
          ? (state.role === 'lender' ? '대주 권역' : '투자자 권역')
          : (key === 'roleClass' ? (state.role === 'lender' ? '대주 유형' : '투자자 분류') : FILTER_CONFIG[key].label),
        value: key === 'minimumAmount'
          ? formatInteger(value) + '백만원 이상'
          : (key === 'partyOrigin' ? partyOriginDisplay(value, state.role) : value)
      };
    });
  }

  function renderActiveFilters() {
    var entries = activeFilterEntries();
    if (entries.length === 0) return '<div class="capital-active-filters is-empty"><span>적용 필터 없음</span></div>';
    return '<div class="capital-active-filters" aria-label="적용된 필터">' + entries.map(function (entry) {
      return '<button type="button" data-capital-remove-filter="' + escapeHtml(entry.key) + '"><span>' + escapeHtml(entry.label) + '</span><strong>' + escapeHtml(entry.value) + '</strong><b aria-hidden="true">×</b></button>';
    }).join('') + '<button type="button" class="capital-clear-chip" data-capital-action="reset">모두 해제</button></div>';
  }

  function renderKpis(totals) {
    var role = currentRoleConfig();
    return [
      '<section class="capital-kpi-strip" aria-label="자금관계 핵심 지표" data-capital-committed="' + totals.committed + '" data-capital-current="' + totals.current + '" data-capital-remaining="' + totals.remaining + '">',
      '<div><span>' + escapeHtml(role.countLabel) + '</span><strong>' + formatInteger(state.filtered.length) + '</strong><small>개</small></div>',
      '<div class="is-primary"><span>' + escapeHtml(role.committedLabel) + '</span><strong>' + escapeHtml(formatCompactWon(totals.committed)) + '</strong><small>' + escapeHtml(formatMillion(totals.committed)) + '백만원</small></div>',
      '<div><span>' + escapeHtml(role.currentLabel) + '</span><strong>' + escapeHtml(formatCompactWon(totals.current)) + '</strong><small>' + escapeHtml(formatMillion(totals.current)) + '백만원</small></div>',
      '<div><span>' + escapeHtml(role.remainingLabel) + '</span><strong>' + escapeHtml(formatCompactWon(totals.remaining)) + '</strong><small>' + escapeHtml(formatMillion(totals.remaining)) + '백만원</small></div>',
      '</section>'
    ].join('');
  }

  function currentInternalFundCoverage() {
    if (state.role !== 'beneficiary') {
      return {
        rows: [], parties: 0, committed: 0, current: 0, remaining: 0,
        managedFundParties: 0, managedFundRows: 0, managedFundCommitted: 0,
        shellParties: 0, shellRows: 0, shellCommitted: 0,
        covered: 0, coveredCommitted: 0, missing: 0, missingCommitted: 0,
        shellSameFundRows: 0, shellFamilyRows: 0, shellIntermediateRows: 0, shellUnresolvedRows: 0
      };
    }
    var matchingFacts = dedupeFactRows(state.directFacts.filter(function (row) {
      return row.role === 'beneficiary'
        && !row.includeInExternalInvestorRollup
        && matchesFilters(row, { ignoreMinimum: true });
    }), false);
    var groups = new Map();
    matchingFacts.forEach(function (row) {
      if (!groups.has(row.partyId)) {
        groups.set(row.partyId, {
          partyId: row.partyId,
          partyName: row.partyName,
          internalType: row.isInternalFundLookthroughShell ? 'internal_fund_lookthrough_shell' : 'internal_managed_fund',
          lookthroughCoverageStatuses: [],
          lookthroughCoverageCounts: {},
          managedFundNames: [],
          targetFundNames: [],
          committedAmount: 0,
          currentAmount: 0,
          remainingAmount: 0,
          exposureCount: 0
        });
      }
      var group = groups.get(row.partyId);
      group.lookthroughCoverageStatuses = unique(group.lookthroughCoverageStatuses.concat([row.lookthroughCoverageStatus]));
      group.lookthroughCoverageCounts[row.lookthroughCoverageStatus] = (group.lookthroughCoverageCounts[row.lookthroughCoverageStatus] || 0) + 1;
      group.managedFundNames = unique(group.managedFundNames.concat(row.investorManagedFundNames || []));
      group.targetFundNames = unique(group.targetFundNames.concat(row.fundNames || []));
      group.committedAmount += row.committedAmount;
      group.currentAmount += row.currentAmount;
      group.remainingAmount += row.remainingAmount;
      group.exposureCount += 1;
    });
    var minimum = numberValue(state.filters.minimumAmount) * MILLION;
    var rows = Array.from(groups.values()).filter(function (row) {
      return !minimum || row.committedAmount >= minimum;
    }).sort(function (a, b) {
      return b.committedAmount - a.committedAmount || a.partyName.localeCompare(b.partyName, 'ko');
    });
    return rows.reduce(function (coverage, row) {
      coverage.rows.push(row);
      coverage.parties += 1;
      coverage.committed += row.committedAmount;
      coverage.current += row.currentAmount;
      coverage.remaining += row.remainingAmount;
      if (row.internalType === 'internal_fund_lookthrough_shell') {
        coverage.shellParties += 1;
        coverage.shellRows += row.exposureCount;
        coverage.shellCommitted += row.committedAmount;
        coverage.shellSameFundRows += row.lookthroughCoverageCounts.same_fund_lp_candidates || 0;
        coverage.shellFamilyRows += row.lookthroughCoverageCounts.share_class_family_lp_candidates || 0;
        coverage.shellIntermediateRows += row.lookthroughCoverageCounts.intermediate_fund_lp_candidates || 0;
        coverage.shellUnresolvedRows += row.lookthroughCoverageCounts.lookthrough_unresolved || 0;
      } else {
        coverage.managedFundParties += 1;
        coverage.managedFundRows += row.exposureCount;
        coverage.managedFundCommitted += row.committedAmount;
        if (row.lookthroughCoverageStatuses.includes('direct_upstream_available')) {
          coverage.covered += 1;
          coverage.coveredCommitted += row.committedAmount;
        } else {
          coverage.missing += 1;
          coverage.missingCommitted += row.committedAmount;
        }
      }
      return coverage;
    }, {
      rows: [], parties: 0, committed: 0, current: 0, remaining: 0,
      managedFundParties: 0, managedFundRows: 0, managedFundCommitted: 0,
      shellParties: 0, shellRows: 0, shellCommitted: 0,
      covered: 0, coveredCommitted: 0, missing: 0, missingCommitted: 0,
      shellSameFundRows: 0, shellFamilyRows: 0, shellIntermediateRows: 0, shellUnresolvedRows: 0
    });
  }

  function renderExternalInvestorCoverage(externalTotals) {
    if (state.role !== 'beneficiary') return '';
    var coverage = currentInternalFundCoverage();
    if (coverage.parties === 0) return '';
    var directCommitted = externalTotals.committed + coverage.committed;
    return [
      '<section class="capital-rollup-coverage" aria-label="외부 투자자 집계 대사">',
      '<div class="capital-rollup-equation"><span>중복 제거 대사</span><strong>원천 출자행 합계(중복 포함) ' + escapeHtml(formatCompactWon(directCommitted)) + ' = 실제 투자자 ' + escapeHtml(formatCompactWon(externalTotals.committed)) + ' + 재간접 중간기구 명의행 ' + escapeHtml(formatCompactWon(coverage.committed)) + '</strong></div>',
      '<div class="capital-rollup-coverage-meta">',
      coverage.managedFundParties ? '<span>펀드·리츠·SPC 명의행 ' + formatInteger(coverage.managedFundParties) + '개 주체 · ' + escapeHtml(formatCompactWon(coverage.managedFundCommitted)) + '</span>' : '',
      coverage.shellParties ? '<span>운용사 명의 대체행 ' + formatInteger(coverage.shellParties) + '개 주체 · ' + escapeHtml(formatCompactWon(coverage.shellCommitted)) + '</span>' : '',
      coverage.missing || coverage.shellUnresolvedRows ? '<span class="needs-review">실제 LP 연결 검토 필요 ' + formatInteger(coverage.missing + coverage.shellUnresolvedRows) + '건</span>' : '',
      coverage.parties ? '<button type="button" data-capital-action="show-internal-funds">중복 제외 근거 ' + formatInteger(coverage.parties) + '개 보기</button>' : '',
      '</div>',
      '</section>'
    ].join('');
  }

  function statusClass(statuses) {
    var joined = (statuses || []).map(friendlyStatus).join(' ');
    return joined.includes('검토') || joined.includes('미해결') ? 'needs-review' : 'confirmed';
  }

  function renderResultRows() {
    var role = currentRoleConfig();
    var start = (state.page - 1) * state.pageSize;
    var pageRows = state.filtered.slice(start, start + state.pageSize);
    if (pageRows.length === 0) {
      return '<tr><td colspan="9" class="capital-table-empty">현재 조건에 맞는 결과가 없습니다.</td></tr>';
    }
    return pageRows.map(function (row, index) {
      var selected = state.selectedIds.has(row.resultId);
      var disableCompare = !selected && state.selectedIds.size >= MAX_COMPARE;
      var statuses = row.reviewStatuses.map(friendlyStatus);
      var relationText = '펀드 ' + formatInteger(row.fundCount) + ' · 자산 ' + formatInteger(row.assetCount);
      return [
        '<tr>',
        '<td class="capital-compare-cell"><input type="checkbox" data-capital-compare-id="' + escapeHtml(row.resultId) + '" aria-label="' + escapeHtml(row.partyName) + ' 비교 선택" ' + (selected ? 'checked' : '') + (disableCompare ? ' disabled' : '') + '></td>',
        '<td class="capital-rank-cell">' + formatInteger(start + index + 1) + '</td>',
        '<td class="capital-name-cell"><button type="button" class="capital-party-drill" data-capital-party-id="' + escapeHtml(row.resultId) + '" aria-label="' + escapeHtml(row.partyName) + ' 연결 자산 목록 보기"><strong>' + escapeHtml(row.partyName) + '</strong><span>' + escapeHtml(row.roleSubtype || row.partyGroupNames.join(', ') || '세부유형 없음') + ' · ' + escapeHtml(partyOriginDisplay(row.partyOrigin, row.role)) + '</span><b aria-hidden="true">›</b></button></td>',
        '<td><span class="capital-class-label">' + escapeHtml(row.roleClass) + '</span></td>',
        '<td class="capital-amount-cell capital-current-amount">' + escapeHtml(formatMillion(row.committedAmount)) + '</td>',
        '<td class="capital-amount-cell">' + escapeHtml(formatMillion(row.currentAmount)) + '</td>',
        '<td class="capital-amount-cell">' + escapeHtml(formatMillion(row.remainingAmount)) + '</td>',
        '<td class="capital-relation-cell">' + escapeHtml(relationText) + '</td>',
        '<td><span class="capital-review-status ' + statusClass(statuses) + '">' + escapeHtml(unique(statuses).join(', ')) + '</span></td>',
        '</tr>'
      ].join('');
    }).join('');
  }

  function renderPagination() {
    var pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    var start = state.filtered.length ? (state.page - 1) * state.pageSize + 1 : 0;
    var end = Math.min(state.filtered.length, state.page * state.pageSize);
    return [
      '<div class="capital-pagination">',
      '<span>' + formatInteger(start) + '–' + formatInteger(end) + ' / ' + formatInteger(state.filtered.length) + '</span>',
      '<div>',
      '<button type="button" data-capital-page="prev" aria-label="이전 페이지" title="이전 페이지" ' + (state.page <= 1 ? 'disabled' : '') + '>‹</button>',
      '<strong>' + formatInteger(state.page) + ' / ' + formatInteger(pageCount) + '</strong>',
      '<button type="button" data-capital-page="next" aria-label="다음 페이지" title="다음 페이지" ' + (state.page >= pageCount ? 'disabled' : '') + '>›</button>',
      '</div>',
      '</div>'
    ].join('');
  }

  function renderRankingTable() {
    var role = currentRoleConfig();
    return [
      '<section class="capital-ranking-section">',
      '<div class="capital-section-heading">',
      '<div><h3>약정액 순위</h3><p>' + escapeHtml(role.committedLabel) + ' 기준 내림차순 · 금액 단위 백만원</p></div>',
      '<span>' + formatInteger(state.filtered.length) + '개 ' + escapeHtml(role.countLabel) + '</span>',
      '</div>',
      '<div class="capital-table-wrap">',
      '<table class="capital-ranking-table">',
      '<thead><tr>',
      '<th scope="col"><span class="sr-only">비교</span></th>',
      '<th scope="col">순위</th>',
      '<th scope="col">' + escapeHtml(role.countLabel) + '명</th>',
      '<th scope="col">' + escapeHtml(state.role === 'lender' ? '대주 유형' : '투자자 분류') + '</th>',
      '<th scope="col">' + escapeHtml(role.committedLabel) + '</th>',
      '<th scope="col">' + escapeHtml(role.currentLabel) + '</th>',
      '<th scope="col">' + escapeHtml(role.remainingLabel) + '</th>',
      '<th scope="col">연결 관계</th>',
      '<th scope="col">검토상태</th>',
      '</tr></thead>',
      '<tbody>' + renderResultRows() + '</tbody>',
      '</table>',
      '</div>',
      renderPagination(),
      '</section>'
    ].join('');
  }

  function renderSubtotals(subtotals, reconciliation) {
    var role = currentRoleConfig();
    var validationText = reconciliation.valid ? '부분합 = 전체' : '합계 불일치';
    var validationClass = reconciliation.valid ? 'is-valid' : 'is-invalid';
    var rows = subtotals.length ? subtotals.map(function (row) {
      var share = reconciliation.total.committed ? row.committed / reconciliation.total.committed * 100 : 0;
      return [
        '<tr>',
        '<td><strong>' + escapeHtml(row.label) + '</strong><span>' + formatInteger(row.parties) + '개</span></td>',
        '<td>' + escapeHtml(formatMillion(row.committed)) + '</td>',
        '<td>' + share.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '%</td>',
        '</tr>'
      ].join('');
    }).join('') : '<tr><td colspan="3" class="capital-table-empty">부분합이 없습니다.</td></tr>';
    var difference = Math.abs(reconciliation.differences.committed);
    return [
      '<aside class="capital-subtotal-section">',
      '<div class="capital-section-heading">',
      '<div><h3>분류별 부분합</h3><p>' + escapeHtml(role.committedLabel) + ' 기준</p></div>',
      '<span class="capital-reconciliation ' + validationClass + '" title="약정·현재·잔여 금액을 각각 검증">' + escapeHtml(validationText) + '</span>',
      '</div>',
      '<div class="capital-subtotal-table-wrap">',
      '<table class="capital-subtotal-table">',
      '<thead><tr><th scope="col">' + escapeHtml(state.role === 'lender' ? '대주 유형' : '투자자 분류') + '</th><th scope="col">금액</th><th scope="col">비중</th></tr></thead>',
      '<tbody>' + rows + '</tbody>',
      '<tfoot><tr><th scope="row">전체</th><td>' + escapeHtml(formatMillion(reconciliation.total.committed)) + '</td><td>100%</td></tr></tfoot>',
      '</table>',
      '</div>',
      (!reconciliation.valid ? '<p class="capital-reconciliation-error">차이 ' + escapeHtml(formatMillion(difference)) + '백만원</p>' : ''),
      '</aside>'
    ].join('');
  }

  function ensureBreakdownDialog() {
    var overlay = document.getElementById('capitalBreakdownDialog');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'capitalBreakdownDialog';
    overlay.className = 'capital-breakdown-overlay';
    overlay.hidden = true;
    overlay.innerHTML = [
      '<section class="capital-breakdown-dialog" role="dialog" aria-modal="true" aria-labelledby="capitalBreakdownTitle" aria-describedby="capitalBreakdownDescription">',
      '<header class="capital-breakdown-header">',
      '<div><p class="capital-eyebrow">CAPITAL RELATIONSHIPS</p><h2 id="capitalBreakdownTitle"></h2><p id="capitalBreakdownDescription"></p></div>',
      '<button type="button" class="capital-breakdown-close" data-capital-breakdown-close aria-label="팝업 닫기" title="닫기">×</button>',
      '</header>',
      '<div class="capital-breakdown-summary" id="capitalBreakdownSummary"></div>',
      '<div class="capital-breakdown-list" id="capitalBreakdownList"></div>',
      '</section>'
    ].join('');
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderInternalFundCoverageRow(row, index) {
    var isLookthroughShell = row.internalType === 'internal_fund_lookthrough_shell';
    var shellFamilyCount = row.lookthroughCoverageCounts.share_class_family_lp_candidates || 0;
    var shellIntermediateCount = row.lookthroughCoverageCounts.intermediate_fund_lp_candidates || 0;
    var shellUnresolvedCount = row.lookthroughCoverageCounts.lookthrough_unresolved || 0;
    var shellCandidateCount = (row.lookthroughCoverageCounts.same_fund_lp_candidates || 0)
      + shellFamilyCount + shellIntermediateCount;
    var coverageLabel = isLookthroughShell
      ? (shellUnresolvedCount && shellCandidateCount
        ? 'LP 후보 ' + formatInteger(shellCandidateCount) + '행 · 검토 ' + formatInteger(shellUnresolvedCount) + '행'
        : (shellUnresolvedCount
          ? 'LP 후보 연결 검토 필요'
        : (shellIntermediateCount
          ? '중간기구 상위 LP 후보'
          : (shellFamilyCount ? '동일 펀드·종류 LP 후보' : '동일 펀드 LP 후보'))))
      : (row.lookthroughCoverageStatuses.includes('direct_upstream_available')
        ? '상위 출자관계 확인'
        : '상위 출자관계 미연결');
    var scopeRelation = isLookthroughShell
      ? '<div><dt>관계 해석</dt><dd>운용사 명의 대체행 · LP 후보 경로는 관계 근거로만 표시</dd></div>'
      : '<div><dt>재간접 중간기구</dt><dd>' + escapeHtml(relationList(row.managedFundNames, [row.partyName])) + '</dd></div>';
    return [
      '<article class="capital-breakdown-row capital-internal-fund-row">',
      '<div class="capital-breakdown-rank">' + formatInteger(index + 1) + '</div>',
      '<div class="capital-breakdown-party"><strong>' + escapeHtml(row.partyName) + '</strong><span>' + escapeHtml(coverageLabel) + '</span></div>',
      '<div class="capital-asset-relation-count"><strong>' + formatInteger(row.exposureCount) + '</strong><span>직접 관계</span></div>',
      '<dl class="capital-breakdown-relations">',
      scopeRelation,
      '<div><dt>투자 대상 펀드 ' + formatInteger(row.targetFundNames.length) + '개</dt><dd>' + escapeHtml(relationList(row.targetFundNames, [], 8)) + '</dd></div>',
      '</dl>',
      '<div class="capital-breakdown-amount-grid">',
      '<div><span>약정액</span><strong>' + escapeHtml(formatMillion(row.committedAmount)) + '</strong><small>백만원</small></div>',
      '<div><span>투입액</span><strong>' + escapeHtml(formatMillion(row.currentAmount)) + '</strong><small>백만원</small></div>',
      '<div><span>미투입액</span><strong>' + escapeHtml(formatMillion(row.remainingAmount)) + '</strong><small>백만원</small></div>',
      '</div>',
      '</article>'
    ].join('');
  }

  function openInternalFundCoverageDialog(trigger) {
    var coverage = currentInternalFundCoverage();
    var overlay = ensureBreakdownDialog();
    state.breakdownTrigger = trigger || document.activeElement;
    document.getElementById('capitalBreakdownTitle').textContent = '재간접 중간기구 제외 내역';
    document.getElementById('capitalBreakdownDescription').textContent = '실제 투자자와 중간기구 명의행을 동시에 더하지 않도록 중간기구는 금액 집계에서 제외합니다. LP 경로는 명시적 귀속이 없는 경우 후보 관계로만 표시합니다.';
    document.getElementById('capitalBreakdownSummary').innerHTML = [
      '<div><span>제외 주체</span><strong>' + formatInteger(coverage.parties) + '개</strong></div>',
      '<div><span>원천 명의행 약정액</span><strong>' + escapeHtml(formatMillion(coverage.committed)) + '백만원</strong></div>',
      '<div><span>펀드·리츠·SPC 명의행</span><strong>' + formatInteger(coverage.managedFundParties) + '개 · ' + escapeHtml(formatCompactWon(coverage.managedFundCommitted)) + '</strong></div>',
      '<div><span>운용사 명의 대체행</span><strong>' + formatInteger(coverage.shellParties) + '개 · ' + escapeHtml(formatCompactWon(coverage.shellCommitted)) + '</strong></div>',
      '</div>'
    ].join('');
    document.getElementById('capitalBreakdownList').innerHTML = [
      '<section class="capital-breakdown-group">',
      '<header><h3>관계 근거 보존 목록</h3><span>' + formatInteger(coverage.rows.length) + '개</span></header>',
      coverage.rows.length ? coverage.rows.map(renderInternalFundCoverageRow).join('') : '<div class="capital-table-empty">현재 조건에서 외부 집계 제외 관계가 없습니다.</div>',
      '</section>'
    ].join('');
    overlay.hidden = false;
    document.body.classList.add('capital-dialog-open');
    window.requestAnimationFrame(function () {
      overlay.classList.add('active');
      var closeButton = overlay.querySelector('[data-capital-breakdown-close]');
      if (closeButton) closeButton.focus();
    });
  }

  function openDuplicateCoverageDialog(trigger) {
    var rows = state.suppressedEconomicDuplicates || [];
    var overlay = ensureBreakdownDialog();
    state.breakdownTrigger = trigger || document.activeElement;
    document.getElementById('capitalBreakdownTitle').textContent = '중복 익스포저 합산 제외';
    document.getElementById('capitalBreakdownDescription').textContent = '원본 행은 DB에 보존하고, 동일 역할·기관·기준일·펀드·자산·금액이면서 비고에 중복 제외가 명시된 행만 화면 합계에서 제외합니다.';
    document.getElementById('capitalBreakdownSummary').innerHTML = [
      '<div><span>합산 제외</span><strong>' + formatInteger(rows.length) + '행</strong></div>',
      '<div><span>원본 보존</span><strong>DB 행 유지</strong></div>',
      '<div><span>판정 방식</span><strong>명시적 비고 + 경제적 key</strong></div>',
      '</div>'
    ].join('');
    document.getElementById('capitalBreakdownList').innerHTML = [
      '<section class="capital-breakdown-group">',
      '<header><h3>제외 근거</h3><span>' + formatInteger(rows.length) + '건</span></header>',
      rows.length ? rows.map(function (row, index) {
        return [
          '<article class="capital-breakdown-row v2-duplicate-exclusion-row">',
          '<div class="capital-breakdown-rank">' + formatInteger(index + 1) + '</div>',
          '<div class="capital-breakdown-party"><strong>' + escapeHtml(row.partyName || row.partyId || '기관 미상') + '</strong>',
          '<span>제외 ID ' + escapeHtml(row.exposureId || '-') + ' · 유지 ID ' + escapeHtml(row.keptExposureId || '-') + '</span></div>',
          '<div class="capital-breakdown-amount-grid">',
          '<div><span>약정액</span><strong>' + escapeHtml(formatMillion(row.committedAmount)) + '</strong><small>백만원</small></div>',
          '<div><span>' + (row.role === 'lender' ? '실행액' : '투입액') + '</span><strong>' + escapeHtml(formatMillion(row.currentAmount)) + '</strong><small>백만원</small></div>',
          '</div>',
          '</article>'
        ].join('');
      }).join('') : '<div class="capital-table-empty">현재 합산 제외된 중복 exposure가 없습니다.</div>',
      '</section>'
    ].join('');
    overlay.hidden = false;
    document.body.classList.add('capital-dialog-open');
    window.requestAnimationFrame(function () {
      overlay.classList.add('active');
      var closeButton = overlay.querySelector('[data-capital-breakdown-close]');
      if (closeButton) closeButton.focus();
    });
  }

  function factsForParty(row) {
    var seen = new Set();
    return state.facts.filter(function (fact) {
      return fact.role === row.role && fact.partyId === row.partyId;
    }).filter(function (fact) {
      var key = fact.exposureId ? fact.role + '|' + fact.exposureId : fact.role + '|' + fact.sourceIndex;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function assetEntriesForFact(fact) {
    var names = unique(fact.assetNames || []);
    var ids = unique(fact.assetIds || []);
    if (names.length === 0) return ids.map(function (id) { return { name: id, ids: [id] }; });
    return names.map(function (name, index) {
      var matchedId = names.length === ids.length ? ids[index] : (ids.length === 1 ? ids[0] : '');
      return { name: name, ids: matchedId ? [matchedId] : ids };
    });
  }

  function fundEntriesForFact(fact) {
    var names = unique(fact.fundNames || []);
    var ids = unique(fact.fundIds || []);
    if (ids.length === 1) {
      return [{ id: ids[0], name: names[0] || ids[0] }];
    }
    if (ids.length > 1) {
      return ids.map(function (id, index) {
        return { id: id, name: names[index] || id };
      });
    }
    return names.map(function (name) { return { id: '', name: name }; });
  }

  function partyFundRows(row) {
    var facts = factsForParty(row);
    if (facts.length === 0) facts = [row];
    var groups = new Map();
    facts.forEach(function (fact) {
      var funds = fundEntriesForFact(fact);
      funds.forEach(function (fund) {
        var key = searchToken(fund.id || fund.name);
        if (!key) return;
        if (!groups.has(key)) {
          groups.set(key, {
            name: fund.name,
            fundId: fund.id,
            assetNames: [],
            assetIds: [],
            projectNames: [],
            committedAmount: 0,
            currentAmount: 0,
            remainingAmount: 0,
            unallocatedCommittedAmount: 0,
            unallocatedCurrentAmount: 0,
            unallocatedRemainingAmount: 0,
            exposureCount: 0,
            hasUnallocatedAmount: false
          });
        }
        var group = groups.get(key);
        group.assetNames = unique(group.assetNames.concat(fact.assetNames || []));
        group.assetIds = unique(group.assetIds.concat(fact.assetIds || []));
        group.projectNames = unique(group.projectNames.concat(fact.projectNames || []));
        group.exposureCount += 1;
        if (funds.length === 1) {
          group.committedAmount += numberValue(fact.committedAmount);
          group.currentAmount += numberValue(fact.currentAmount);
          group.remainingAmount += numberValue(fact.remainingAmount);
        } else {
          group.hasUnallocatedAmount = true;
          group.unallocatedCommittedAmount += numberValue(fact.committedAmount);
          group.unallocatedCurrentAmount += numberValue(fact.currentAmount);
          group.unallocatedRemainingAmount += numberValue(fact.remainingAmount);
        }
      });
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.committedAmount - a.committedAmount || a.name.localeCompare(b.name, 'ko');
    });
  }

  function partyAssetRows(row) {
    var facts = factsForParty(row);
    if (facts.length === 0) facts = [row];
    var groups = new Map();
    facts.forEach(function (fact) {
      var assets = assetEntriesForFact(fact);
      assets.forEach(function (asset) {
        var key = searchToken(asset.name) || searchToken((asset.ids || []).join('|'));
        if (!key) return;
        if (!groups.has(key)) {
          groups.set(key, {
            name: asset.name,
            assetIds: [],
            fundNames: [],
            fundIds: [],
            projectNames: [],
            committedAmount: 0,
            currentAmount: 0,
            remainingAmount: 0,
            unallocatedCommittedAmount: 0,
            unallocatedCurrentAmount: 0,
            unallocatedRemainingAmount: 0,
            exposureCount: 0,
            hasUnallocatedAmount: false
          });
        }
        var group = groups.get(key);
        group.assetIds = unique(group.assetIds.concat(asset.ids || []));
        group.fundNames = unique(group.fundNames.concat(fact.fundNames || []));
        group.fundIds = unique(group.fundIds.concat(fact.fundIds || []));
        group.projectNames = unique(group.projectNames.concat(fact.projectNames || []));
        group.exposureCount += 1;
        if (assets.length === 1) {
          group.committedAmount += numberValue(fact.committedAmount);
          group.currentAmount += numberValue(fact.currentAmount);
          group.remainingAmount += numberValue(fact.remainingAmount);
        } else {
          group.hasUnallocatedAmount = true;
          group.unallocatedCommittedAmount += numberValue(fact.committedAmount);
          group.unallocatedCurrentAmount += numberValue(fact.currentAmount);
          group.unallocatedRemainingAmount += numberValue(fact.remainingAmount);
        }
      });
    });

    if (groups.size === 0) {
      unique((row.assetNames || []).length ? row.assetNames : row.assetIds).forEach(function (name) {
        groups.set(searchToken(name), {
          name: name,
          assetIds: row.assetIds || [],
          fundNames: row.fundNames || [],
          fundIds: row.fundIds || [],
          projectNames: row.projectNames || [],
          committedAmount: 0,
          currentAmount: 0,
          remainingAmount: 0,
          unallocatedCommittedAmount: numberValue(row.committedAmount),
          unallocatedCurrentAmount: numberValue(row.currentAmount),
          unallocatedRemainingAmount: numberValue(row.remainingAmount),
          exposureCount: row.factCount || 0,
          hasUnallocatedAmount: true
        });
      });
    }
    return Array.from(groups.values()).sort(function (a, b) {
      var aTotal = a.committedAmount + a.unallocatedCommittedAmount;
      var bTotal = b.committedAmount + b.unallocatedCommittedAmount;
      return bTotal - aTotal || a.name.localeCompare(b.name, 'ko');
    });
  }

  function relationList(values, fallbackValues, limit) {
    var rows = unique((values || []).length ? values : (fallbackValues || []));
    if (!rows.length) return '연결 정보 없음';
    if (limit && rows.length > limit) {
      return rows.slice(0, limit).join(', ') + ' 외 ' + formatInteger(rows.length - limit) + '개';
    }
    return rows.join(', ');
  }

  function renderBreakdownAmounts(item) {
    var role = currentRoleConfig();
    var hasDirectAmount = item.committedAmount !== 0 || item.currentAmount !== 0 || item.remainingAmount !== 0 || !item.hasUnallocatedAmount;
    var direct = hasDirectAmount ? [
      '<div><span>' + escapeHtml(role.committedLabel) + '</span><strong>' + escapeHtml(formatMillion(item.committedAmount)) + '</strong><small>백만원</small></div>',
      '<div><span>' + escapeHtml(role.currentLabel) + '</span><strong>' + escapeHtml(formatMillion(item.currentAmount)) + '</strong><small>백만원</small></div>',
      '<div><span>' + escapeHtml(role.remainingLabel) + '</span><strong>' + escapeHtml(formatMillion(item.remainingAmount)) + '</strong><small>백만원</small></div>'
    ].join('') : '';
    var unallocated = item.hasUnallocatedAmount ? [
      '<div class="capital-breakdown-unallocated">',
      '<span>자산별 미배분 펀드 금액</span>',
      '<strong>' + escapeHtml(role.committedLabel) + ' ' + escapeHtml(formatMillion(item.unallocatedCommittedAmount)) + ' · ' + escapeHtml(role.currentLabel) + ' ' + escapeHtml(formatMillion(item.unallocatedCurrentAmount)) + ' · ' + escapeHtml(role.remainingLabel) + ' ' + escapeHtml(formatMillion(item.unallocatedRemainingAmount)) + '백만원</strong>',
      '</div>'
    ].join('') : '';
    return '<div class="capital-breakdown-amount-grid">' + direct + unallocated + '</div>';
  }

  function renderPartyFundRow(fund, index) {
    return [
      '<article class="capital-breakdown-row capital-party-fund-row">',
      '<div class="capital-breakdown-rank">' + formatInteger(index + 1) + '</div>',
      '<div class="capital-breakdown-party"><strong>' + escapeHtml(fund.name) + '</strong><span>' + escapeHtml(fund.fundId || '펀드 ID 미등록') + '</span></div>',
      '<div class="capital-asset-relation-count"><strong>' + formatInteger(fund.exposureCount) + '</strong><span>관계</span></div>',
      '<dl class="capital-breakdown-relations">',
      '<div><dt>자산</dt><dd>' + escapeHtml(relationList(fund.assetNames, fund.assetIds)) + '</dd></div>',
      fund.projectNames.length ? '<div><dt>프로젝트</dt><dd>' + escapeHtml(fund.projectNames.join(', ')) + '</dd></div>' : '',
      '</dl>',
      renderBreakdownAmounts(fund),
      '</article>'
    ].join('');
  }

  function renderPartyAssetRow(asset, index) {
    return [
      '<article class="capital-breakdown-row capital-party-asset-row">',
      '<div class="capital-breakdown-rank">' + formatInteger(index + 1) + '</div>',
      '<div class="capital-breakdown-party"><strong>' + escapeHtml(asset.name) + '</strong><span>' + escapeHtml(asset.assetIds.join(' · ') || '자산 ID 미등록') + '</span></div>',
      '<div class="capital-asset-relation-count"><strong>' + formatInteger(asset.exposureCount) + '</strong><span>관계</span></div>',
      '<dl class="capital-breakdown-relations">',
      '<div><dt>펀드</dt><dd>' + escapeHtml(relationList(asset.fundNames, asset.fundIds)) + '</dd></div>',
      asset.projectNames.length ? '<div><dt>프로젝트</dt><dd>' + escapeHtml(asset.projectNames.join(', ')) + '</dd></div>' : '',
      '</dl>',
      renderBreakdownAmounts(asset),
      '</article>'
    ].join('');
  }

  function openPartyAssetDialog(resultId, trigger) {
    var role = currentRoleConfig();
    var row = state.results.find(function (candidate) { return candidate.resultId === resultId; });
    if (!row) return;
    var funds = partyFundRows(row);
    var assets = partyAssetRows(row);
    var overlay = ensureBreakdownDialog();
    state.breakdownTrigger = trigger || document.activeElement;
    document.getElementById('capitalBreakdownTitle').textContent = row.partyName + ' 자금관계';
    document.getElementById('capitalBreakdownDescription').textContent = row.partyName + '의 ' + (row.role === 'lender' ? '대출' : '에쿼티 투자') + ' 금액을 펀드와 자산 관계별로 정리했습니다.';
    document.getElementById('capitalBreakdownSummary').innerHTML = [
      '<div><span>자산</span><strong>' + formatInteger(assets.length) + '개</strong></div>',
      '<div><span>연결 펀드</span><strong>' + formatInteger(funds.length || row.fundCount) + '개</strong></div>',
      '<div><span>' + escapeHtml(role.committedLabel) + '</span><strong>' + escapeHtml(formatMillion(row.committedAmount)) + '백만원</strong></div>',
      '<div><span>' + escapeHtml(role.currentLabel) + '</span><strong>' + escapeHtml(formatMillion(row.currentAmount)) + '백만원</strong></div>',
      '<div><span>' + escapeHtml(role.remainingLabel) + '</span><strong>' + escapeHtml(formatMillion(row.remainingAmount)) + '백만원</strong></div>',
      '<div><span>분류</span><strong>' + escapeHtml(row.roleClass) + (row.roleSubtype ? ' · ' + escapeHtml(row.roleSubtype) : '') + '</strong></div>',
      '<div><span>' + (row.role === 'lender' ? '대주 권역' : '투자자 권역') + '</span><strong>' + escapeHtml(partyOriginDisplay(row.partyOrigin, row.role)) + (row.domicileCountryCode ? ' · ' + escapeHtml(row.domicileCountryCode) : '') + '</strong></div>'
    ].join('');
    document.getElementById('capitalBreakdownList').innerHTML = [
      '<section class="capital-breakdown-group">',
      '<header><h3>연결 펀드/비히클</h3><span>' + formatInteger(funds.length) + '개</span></header>',
      funds.length ? funds.map(renderPartyFundRow).join('') : '<div class="capital-table-empty">연결된 펀드 정보가 없습니다.</div>',
      '</section>',
      '<section class="capital-breakdown-group">',
      '<header><h3>연결 자산</h3><span>' + formatInteger(assets.length) + '개</span></header>',
      assets.length ? assets.map(renderPartyAssetRow).join('') : '<div class="capital-table-empty">연결된 자산 정보가 없습니다.</div>',
      '</section>'
    ].join('');
    overlay.hidden = false;
    document.body.classList.add('capital-dialog-open');
    window.requestAnimationFrame(function () {
      overlay.classList.add('active');
      var closeButton = overlay.querySelector('[data-capital-breakdown-close]');
      if (closeButton) closeButton.focus();
    });
  }

  function closeBreakdownDialog() {
    var overlay = document.getElementById('capitalBreakdownDialog');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('active');
    document.body.classList.remove('capital-dialog-open');
    window.setTimeout(function () { overlay.hidden = true; }, 160);
    if (state.breakdownTrigger && typeof state.breakdownTrigger.focus === 'function') state.breakdownTrigger.focus();
    state.breakdownTrigger = null;
  }

  function selectedRows() {
    return state.results.filter(function (row) {
      return row.role === state.role && state.selectedIds.has(row.resultId);
    });
  }

  function renderComparison() {
    var rows = selectedRows();
    if (rows.length === 0) return '';
    var role = currentRoleConfig();
    var totals = sumRows(rows);
    return [
      '<section class="capital-comparison-section">',
      '<div class="capital-section-heading">',
      '<div><h3>비교 선택</h3><p>같은 역할 내 최대 ' + MAX_COMPARE + '개 ' + escapeHtml(role.countLabel) + '</p></div>',
      '<button type="button" data-capital-action="clear-comparison">선택 해제</button>',
      '</div>',
      '<div class="capital-comparison-grid">',
      rows.map(function (row) {
        return '<div><button type="button" data-capital-remove-comparison="' + escapeHtml(row.resultId) + '" aria-label="' + escapeHtml(row.partyName) + ' 비교에서 제거">×</button><strong>' + escapeHtml(row.partyName) + '</strong><span>' + escapeHtml(role.currentLabel) + ' ' + escapeHtml(formatMillion(row.currentAmount)) + '백만원</span></div>';
      }).join(''),
      '</div>',
      '<div class="capital-comparison-total"><span>선택 합계</span><strong>' + escapeHtml(formatMillion(totals.current)) + '백만원</strong></div>',
      '</section>'
    ].join('');
  }

  function renderNotice() {
    if (!state.notice) return '<div id="capitalNotice" class="capital-inline-notice" hidden></div>';
    return '<div id="capitalNotice" class="capital-inline-notice ' + escapeHtml(state.notice.type || '') + '">' + escapeHtml(state.notice.text) + '</div>';
  }

  function renderCapitalResults() {
    if (state.mode !== 'capital') return;
    var host = prepareCapitalHost();
    if (!host) return;
    var role = currentRoleConfig();
    var totals = sumRows(state.filtered);
    var subtotals = classificationSubtotals(state.filtered);
    var reconciliation = reconcileSubtotals(state.filtered, subtotals);
    var duplicateNote = state.duplicateFactsSuppressed > 0
      ? '<span>중복 fact ' + formatInteger(state.duplicateFactsSuppressed) + '행 합산 제외</span>'
      : '';
    var economicDuplicateNote = state.economicDuplicatesSuppressed > 0
      ? (document.body.classList.contains('ux-v2')
        ? '<button type="button" class="capital-source-audit" data-capital-action="show-duplicate-exclusions">명칭 중복 ' + formatInteger(state.economicDuplicatesSuppressed) + '행 제외 · 근거</button>'
        : '<span>명칭 중복 ' + formatInteger(state.economicDuplicatesSuppressed) + '행 합산 제외</span>')
      : '';
    var contractNote = state.invalidContractRows > 0
      ? '<span class="capital-source-warning">party_id 누락 ' + formatInteger(state.invalidContractRows) + '행 제외</span>'
      : '';
    var activeSourceLabel = state.role === 'lender'
      ? '직접 대출관계 기준'
      : state.sourceLabel;
    host.innerHTML = [
      '<div class="analytics-container capital-analysis-root">',
      '<header class="capital-analysis-header">',
      '<div><p class="capital-eyebrow">CAPITAL RELATIONSHIPS</p><h2>' + escapeHtml(role.label) + ' 자금관계</h2>',
      '<div class="capital-source-line"><span>' + escapeHtml(activeSourceLabel) + '</span>',
      state.snapshotDate ? '<span>기준일 ' + escapeHtml(state.snapshotDate) + '</span>' : '',
      duplicateNote,
      economicDuplicateNote,
      contractNote,
      '</div></div>',
      '<div class="capital-header-actions">',
      '<button type="button" data-capital-action="refresh" title="데이터 새로고침">새로고침</button>',
      '</div>',
      '</header>',
      renderNotice(),
      renderActiveFilters(),
      renderKpis(totals),
      renderExternalInvestorCoverage(totals),
      renderHistoryChart(),
      '<div class="capital-work-surface">',
      renderComparison(),
      '<div class="capital-analysis-grid">',
      renderRankingTable(),
      renderSubtotals(subtotals, reconciliation),
      '</div>',
      '</div>',
      '</div>'
    ].join('');
    bindHistoryTooltip(host);
  }

  async function renderCapitalAnalysis() {
    if (state.mode !== 'capital' || !document.body.classList.contains('analysis-view')) return;
    if (!state.loaded) renderLoading();
    try {
      await loadCapitalRelationshipData(false);
      if (state.mode !== 'capital' || !document.body.classList.contains('analysis-view')) return;
      applyCapitalFilters({ read: false, keepPage: true });
    } catch (error) {
      console.error('Capital relationship analysis failed:', error);
      renderLoadError();
    }
  }

  function syncRoleButtons() {
    document.querySelectorAll('[data-capital-role]').forEach(function (button) {
      var active = button.dataset.capitalRole === state.role;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncModeButtons() {
    document.querySelectorAll('[data-analysis-mode]').forEach(function (button) {
      var active = button.dataset.analysisMode === state.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function activateCapitalMode() {
    state.mode = 'capital';
    document.body.classList.add('capital-relationship-mode');
    var controls = document.getElementById('capitalRelationshipControls');
    if (controls) controls.hidden = false;
    syncModeButtons();
    syncRoleButtons();
    if (!isMobile() && typeof window.setLeftPanelCollapsed === 'function') {
      var leftPanel = document.getElementById('leftPanel');
      if (leftPanel && leftPanel.classList.contains('collapsed')) window.setLeftPanelCollapsed(false);
    }
    populateFilterOptions();
    writeFilters();
    renderCapitalAnalysis();
  }

  function activatePortfolioMode() {
    state.mode = 'portfolio';
    document.body.classList.remove('capital-relationship-mode');
    var controls = document.getElementById('capitalRelationshipControls');
    if (controls) controls.hidden = true;
    var results = document.getElementById('results');
    if (results) results.classList.remove('capital-relationship-results');
    syncModeButtons();
    if (document.body.classList.contains('analysis-view') && typeof window.renderAnalytics === 'function') {
      window.renderAnalytics();
    }
  }

  function setRole(role) {
    if (!ROLE_CONFIG[role] || role === state.role) return;
    state.role = role;
    state.page = 1;
    state.selectedIds.clear();
    state.selectedHistoryDate = '';
    state.filters.roleClass = '';
    state.filters.partyOrigin = '';
    var classLabel = document.getElementById('capitalRoleClassLabel');
    var originLabel = document.getElementById('capitalPartyOriginLabel');
    if (classLabel) classLabel.textContent = role === 'lender' ? '대주 유형' : '투자자 분류';
    if (originLabel) originLabel.textContent = role === 'lender' ? '대주 권역' : '투자자 권역';
    syncRoleButtons();
    populateFilterOptions();
    writeFilters();
    applyCapitalFilters({ read: false });
  }

  function resetFilters() {
    state.filters = emptyFilters();
    state.page = 1;
    writeFilters();
    populateFilterOptions();
    applyCapitalFilters({ read: false });
  }

  function removeFilter(key) {
    if (!Object.prototype.hasOwnProperty.call(state.filters, key)) return;
    state.filters[key] = '';
    writeFilters();
    applyCapitalFilters({ read: false });
  }

  function changePage(direction) {
    var pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    state.page = direction === 'next' ? Math.min(pageCount, state.page + 1) : Math.max(1, state.page - 1);
    renderCapitalResults();
    var host = currentHost();
    var table = host && host.querySelector('.capital-ranking-section');
    if (table) table.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function setNotice(text, type) {
    state.notice = text ? { text: text, type: type || '' } : null;
    renderCapitalResults();
    if (text) {
      window.setTimeout(function () {
        state.notice = null;
        var notice = document.getElementById('capitalNotice');
        if (notice) notice.hidden = true;
      }, 3200);
    }
  }

  function toggleComparison(resultId, checked) {
    if (checked && !state.selectedIds.has(resultId) && state.selectedIds.size >= MAX_COMPARE) {
      setNotice('비교는 같은 역할의 기관을 최대 ' + MAX_COMPARE + '개까지 선택할 수 있습니다.', 'is-warning');
      return;
    }
    if (checked) state.selectedIds.add(resultId);
    else state.selectedIds.delete(resultId);
    renderCapitalResults();
  }

  function csvCell(value) {
    var text = String(value === undefined || value === null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    var role = currentRoleConfig();
    if (state.filtered.length === 0) {
      setNotice('내보낼 결과가 없습니다.', 'is-warning');
      return;
    }
    var headers = [
      '순위', '역할', state.role === 'lender' ? '대주명' : '투자자명', 'Canonical Party ID', state.role === 'lender' ? '대주 유형' : '투자자 분류', '역할 세부유형', '그룹', state.role === 'lender' ? '대주 권역' : '투자자 권역', '국가코드',
      role.committedLabel + '(백만원)', role.currentLabel + '(백만원)', role.remainingLabel + '(백만원)',
      '연결 펀드 수', '연결 자산 수', '기초자산', '지역', '전략', '개발/운영', '투자기구', '운용상태', '검토상태'
    ];
    var lines = [headers.map(csvCell).join(',')];
    state.filtered.forEach(function (row, index) {
      lines.push([
        index + 1,
        role.label,
        row.partyName,
        row.partyId,
        row.roleClass,
        row.roleSubtype,
        row.partyGroupNames.join(' | '),
        partyOriginDisplay(row.partyOrigin, row.role),
        row.domicileCountryCode,
        numberValue(row.committedAmount) / MILLION,
        numberValue(row.currentAmount) / MILLION,
        numberValue(row.remainingAmount) / MILLION,
        row.fundCount,
        row.assetCount,
        row.baseAssetClasses.join(' | '),
        row.regions.join(' | '),
        row.strategies.join(' | '),
        row.businessStages.join(' | '),
        row.vehicleTypes.join(' | '),
        row.operationalStatuses.join(' | '),
        row.reviewStatuses.map(friendlyStatus).join(' | ')
      ].map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    link.href = url;
    link.download = role.csvPrefix + '_' + date + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showBasisHelp() {
    var overlay = document.getElementById('modalOverlay');
    var content = document.getElementById('helpContent');
    if (!overlay || !content) return;
    content.innerHTML = [
      '<h2>자금관계 분석 기준</h2>',
      '<ul>',
      '<li><strong>에쿼티 투자자</strong> 약정액·투입액·미투입액을 사용합니다.</li>',
      '<li><strong>외부 투자자 합계</strong> IGIS가 운용하는 펀드·리츠·SPC의 내부 자금이동 행은 제외하며, 직접 법률관계는 DB에 보존합니다.</li>',
      '<li><strong>위탁운용 look-through</strong> One Account v1.1의 2026-09-01 수익자별 약정을 경제적 귀속 기준으로 별도 합산합니다. 직접 법률관계와 구분되며, 수익자별 투입액은 원천 미제공이므로 0 또는 약정비율로 추정하지 않습니다.</li>',
      '<li><strong>대주</strong> 약정액·실행액·미실행액을 사용합니다.</li>',
      '<li><strong>역할분류</strong> 실제 주체의 역할을 먼저 봅니다. LP와 펀드·리츠·SPC를 구분하고, 국내·해외는 별도 권역 속성으로 사용합니다.</li>',
      '<li><strong>분류별 시계열</strong> 투자자는 최초약정일, 대주는 대출인출일의 연도를 사용합니다. 원천일자가 없거나 이상하면 펀드설정일을 보정 근거로 명시해 사용합니다.</li>',
      '<li><strong>자산 속성</strong> 연결 자산이 조건에 해당하는 exposure를 선별하며, 다중 자산에 금액을 임의 배분하지 않습니다.</li>',
      '<li><strong>부분합 검증</strong> 투자자 또는 대주 유형별 약정·현재·잔여 금액의 합이 전체와 같은지 매 조회마다 확인합니다.</li>',
      '<li><strong>투자자 권역</strong> 역할분류와 분리된 소재지 축입니다. 에쿼티 투자자는 국내·해외 투자자, 대주는 국내·글로벌 대주로 표시합니다.</li>',
      '</ul>'
    ].join('');
    overlay.classList.add('active');
  }

  async function refreshData() {
    state.loaded = false;
    state.loadPromise = null;
    state.results = [];
    state.directFacts = [];
    state.facts = [];
    state.historicalFacts = [];
    state.rankings = [];
    state.facets = [];
    state.internalFundRowsExcluded = 0;
    state.internalFundPartiesExcluded = 0;
    state.internalFundCommittedExcluded = 0;
    state.internalFundCoveredParties = 0;
    state.internalFundCoveredCommitted = 0;
    state.internalFundMissingParties = 0;
    state.internalFundMissingCommitted = 0;
    state.delegatedLookthroughRows = 0;
    state.delegatedLookthroughCommitted = 0;
    state.paidInUnavailableRows = 0;
    state.selectedIds.clear();
    renderLoading();
    try {
      await loadCapitalRelationshipData(true);
      applyCapitalFilters({ read: false });
    } catch (error) {
      console.error(error);
      renderLoadError();
    }
  }

  function handleDocumentClick(event) {
    var breakdownClose = event.target.closest('[data-capital-breakdown-close]');
    if (breakdownClose) {
      closeBreakdownDialog();
      return;
    }
    var breakdownOverlay = event.target.closest('#capitalBreakdownDialog');
    if (breakdownOverlay && event.target === breakdownOverlay) {
      closeBreakdownDialog();
      return;
    }
    var partyButton = event.target.closest('[data-capital-party-id]');
    if (partyButton) {
      openPartyAssetDialog(partyButton.dataset.capitalPartyId, partyButton);
      return;
    }
    var historyAggregationButton = event.target.closest('[data-capital-history-aggregation]');
    if (historyAggregationButton) {
      state.historyAggregation = historyAggregationButton.dataset.capitalHistoryAggregation;
      renderCapitalResults();
      return;
    }
    var historyMetricButton = event.target.closest('[data-capital-history-metric]');
    if (historyMetricButton) {
      state.historyMetric = historyMetricButton.dataset.capitalHistoryMetric;
      renderCapitalResults();
      return;
    }
    var modeButton = event.target.closest('[data-analysis-mode]');
    if (modeButton) {
      if (modeButton.dataset.analysisMode === 'capital') activateCapitalMode();
      else activatePortfolioMode();
      return;
    }
    var roleButton = event.target.closest('[data-capital-role]');
    if (roleButton) {
      setRole(roleButton.dataset.capitalRole);
      return;
    }
    var removeFilterButton = event.target.closest('[data-capital-remove-filter]');
    if (removeFilterButton) {
      removeFilter(removeFilterButton.dataset.capitalRemoveFilter);
      return;
    }
    var pageButton = event.target.closest('[data-capital-page]');
    if (pageButton && !pageButton.disabled) {
      changePage(pageButton.dataset.capitalPage);
      return;
    }
    var removeComparisonButton = event.target.closest('[data-capital-remove-comparison]');
    if (removeComparisonButton) {
      state.selectedIds.delete(removeComparisonButton.dataset.capitalRemoveComparison);
      renderCapitalResults();
      return;
    }
    var actionButton = event.target.closest('[data-capital-action]');
    if (!actionButton) return;
    var action = actionButton.dataset.capitalAction;
    if (action === 'reset') resetFilters();
    else if (action === 'export') exportCsv();
    else if (action === 'refresh' || action === 'retry') refreshData();
    else if (action === 'show-internal-funds') openInternalFundCoverageDialog(actionButton);
    else if (action === 'show-duplicate-exclusions') openDuplicateCoverageDialog(actionButton);
    else if (action === 'clear-comparison') {
      state.selectedIds.clear();
      renderCapitalResults();
    } else if (action === 'help') showBasisHelp();
  }

  function handleDocumentChange(event) {
    if (event.target.matches('[data-capital-compare-id]')) {
      toggleComparison(event.target.dataset.capitalCompareId, event.target.checked);
      return;
    }
    if (event.target.matches('[data-capital-filter]')) {
      readFilters();
      applyCapitalFilters({ read: false });
    }
  }

  function bindStaticControls() {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('change', handleDocumentChange);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeBreakdownDialog();
    });
    var form = document.getElementById('capitalRelationshipFilterForm');
    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        applyCapitalFilters();
      });
    }
    var searchInput = document.getElementById('capitalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(function () { applyCapitalFilters(); }, 280);
      });
    }
    var chartButton = document.getElementById('chartViewBtn');
    var listButton = document.getElementById('listViewBtn');
    if (chartButton) {
      chartButton.addEventListener('click', function () {
        window.setTimeout(function () {
          if (state.mode === 'capital') activateCapitalMode();
        }, 0);
      });
    }
    if (listButton) {
      listButton.addEventListener('click', function () {
        document.body.classList.remove('capital-relationship-mode');
      });
    }
    window.addEventListener('resize', function () {
      if (state.mode !== 'capital' || !document.body.classList.contains('analysis-view')) return;
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(function () {
        var nextKind = isMobile() ? 'mobile' : 'desktop';
        if (nextKind !== state.hostKind) renderCapitalResults();
      }, 160);
    });
  }

  function installAnalyticsGuard() {
    var original = window.renderAnalytics;
    if (typeof original !== 'function' || original.__capitalRelationshipGuard) return;
    var guarded = function () {
      if (state.mode === 'capital' && document.body.classList.contains('analysis-view')) {
        return renderCapitalAnalysis();
      }
      return original.apply(this, arguments);
    };
    guarded.__capitalRelationshipGuard = true;
    guarded.__portfolioRenderer = original;
    window.renderAnalytics = guarded;
  }

  function initCapitalRelationshipAnalysis() {
    bindStaticControls();
    installAnalyticsGuard();
    syncModeButtons();
    syncRoleButtons();
    window.CapitalRelationshipAnalysis = {
      state: state,
      activate: activateCapitalMode,
      showPortfolio: activatePortfolioMode,
      refresh: refreshData,
      applyFilters: applyCapitalFilters,
      reconcileSubtotals: reconcileSubtotals,
      historyChartData: historyChartData
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCapitalRelationshipAnalysis);
  } else {
    initCapitalRelationshipAnalysis();
  }
})();
