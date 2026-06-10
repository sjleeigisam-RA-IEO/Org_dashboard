var OPTIONAL_FUND_SEARCH_COLUMNS = [
  'project_mission_name',
  'fund_class',
  'legal_form',
  'fund_type',
  'division',
  'primary_region',
  'is_development',
  'notion_base_asset_class',
  'notion_asset_nature_class',
  'notion_holding_type_class',
  'notion_vehicle_class'
];

var ALIASES = window.ALIASES || {
  nps: ['\uAD6D\uBBFC\uC5F0\uAE08', 'nps'],
  '\uAD6D\uBBFC\uC5F0\uAE08': ['\uAD6D\uBBFC\uC5F0\uAE08', 'nps'],
  kic: ['\uD55C\uAD6D\uD22C\uC790\uACF5\uC0AC', 'kic'],
  '\uC2E0\uD55C': ['\uC2E0\uD55C', 'shinhan'],
  kb: ['\uAD6D\uBBFC', 'kb'],
  '\uD558\uB098': ['\uD558\uB098', 'hana'],
  '\uC6B0\uB9AC': ['\uC6B0\uB9AC', 'woori']
};

var portfolioBasket = [];
var latestSearchRequestId = 0;
window.OPTIONAL_FUND_SEARCH_COLUMNS = OPTIONAL_FUND_SEARCH_COLUMNS;
window.ALIASES = ALIASES;
window.portfolioBasket = portfolioBasket;
window.latestSearchRequestId = latestSearchRequestId;

function ensureFundSearchColumns() {
  return _supabase.from('v_funds_enriched').select('*').limit(1).then(function (response) {
    var sample = response.data?.[0];
    if (!sample) return;

    fundSearchColumns = [
      'fund_name', 'fund_id', 'short_name'
    ].concat(OPTIONAL_FUND_SEARCH_COLUMNS.filter(function (col) {
      return col in sample;
    }));
    window.fundSearchColumns = fundSearchColumns;
  }).catch(function (error) {
    console.error(error);
  });
}

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(function (value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
  }).map(function (value) { return String(value); })));
}

function numericIds(values) {
  return uniqueValues(values).filter(function (value) { return /^\d+$/.test(value); }).map(function (value) { return Number(value); });
}

function mergeRowsByKey(primaryRows, secondaryRows, keyName) {
  var rowsByKey = {};
  (secondaryRows || []).concat(primaryRows || []).forEach(function (row) {
    var key = row && row[keyName];
    if (!key) return;
    var merged = Object.assign({}, rowsByKey[key] || {});
    Object.keys(row).forEach(function (field) {
      var value = row[field];
      if (value === undefined || value === null) return;
      if (typeof value === 'string' && value.trim() === '') return;
      merged[field] = value;
    });
    rowsByKey[key] = merged;
  });
  return Object.values(rowsByKey);
}

function canonicalEntityId(type, row) {
  if (!row) return '';
  if (type === 'fund') return row.fund_id || row.entity_id || '';
  if (type === 'asset') return row.asset_id || row.entity_id || '';
  if (type === 'project') return row.project_id || row.entity_id || '';
  if (type === 'lender') return row.id || row.entity_id || [row.fund_id, row.lender_clean || row.lender_raw].join(':');
  if (type === 'ben') return row.id || row.entity_id || [row.fund_id, row.beneficiary_clean || row.beneficiary_raw].join(':');
  return row.entity_id || row.id || '';
}

function canonicalEntityKey(type, row) {
  return type + ':' + canonicalEntityId(type, row);
}

function primaryAssetIdsFromSearchResult(row) {
  if (!row) return [];
  var ids = [];
  if (row.primary_asset_id) ids.push(row.primary_asset_id);
  if (Array.isArray(row.primary_asset_ids)) ids = ids.concat(row.primary_asset_ids);
  if (row.related_asset_id) ids.push(row.related_asset_id);
  return uniqueValues(ids);
}

function sortByDisplay(rows, type) {
  return (rows || []).slice().sort(function (a, b) {
    var aName = canonicalDisplayTitle(type, a);
    var bName = canonicalDisplayTitle(type, b);
    return String(aName).localeCompare(String(bName), 'ko') || String(canonicalEntityId(type, a)).localeCompare(String(canonicalEntityId(type, b)));
  });
}

function entityRowScore(type, row) {
  if (!row) return 0;
  if (type === 'fund') {
    return (row.fund_name ? String(row.fund_name).length : 0)
      + (row.short_name ? 20 : 0)
      + (row.fund_id ? 10 : 0)
      + (row.status || row.fund_status ? 3 : 0);
  }
  if (type === 'asset') {
    return (row.canonical_name ? String(row.canonical_name).length : 0)
      + (row.asset_id ? 10 : 0)
      + (row.asset_code ? 5 : 0)
      + (row.review_status === 'verified' ? 20 : 0);
  }
  if (type === 'project') {
    return (row.project_name ? String(row.project_name).length : 0)
      + (row.project_id ? 10 : 0)
      + (row.project_code ? 5 : 0)
      + (row.parent_project_id ? 2 : 0);
  }
  if (type === 'lender') return (row.id ? 10 : 0) + (row.fund_id ? 5 : 0) + (row.lender_clean ? 3 : 0);
  if (type === 'ben') return (row.id ? 10 : 0) + (row.fund_id ? 5 : 0) + (row.beneficiary_clean ? 3 : 0);
  return 0;
}

function dedupeEntities(rows, type) {
  var byKey = {};
  (rows || []).forEach(function (row) {
    var key = canonicalEntityKey(type, row);
    if (!key || key.endsWith(':')) return;
    var current = byKey[key];
    if (!current || entityRowScore(type, row) > entityRowScore(type, current)) {
      byKey[key] = Object.assign({}, current || {}, row);
    } else {
      byKey[key] = Object.assign({}, row, current);
    }
  });
  return sortByDisplay(Object.values(byKey), type);
}

function canonicalDisplayTitle(type, row) {
  if (!row) return '';
  if (type === 'fund') {
    if (row.short_name && row.fund_name && row.short_name !== row.fund_name) return '[' + row.short_name + '] ' + row.fund_name;
    return row.fund_name || row.short_name || row.fund_id || '';
  }
  if (type === 'asset') {
    if (row.physical_asset_name) return cleanAssetDisplayTitle(row.physical_asset_name);
    if (row.asset_name_cleanup_action && String(row.asset_name_cleanup_action).indexOf('suppress') === 0) {
      return cleanAssetDisplayTitle(row.non_physical_asset_label || row.asset_code || row.asset_id || '');
    }
    return cleanAssetDisplayTitle(row.canonical_name || row.asset_name || row.asset_code || row.asset_id || '');
  }
  if (type === 'project') return row.project_name || row.project_mission_name || row.project_id || '';
  if (type === 'lender') return row.lender_clean || row.lender_raw || '';
  if (type === 'ben') return row.beneficiary_clean || row.beneficiary_raw || '';
  return row.display_title || row.name || row.id || '';
}

function isGenericAssetDisplayTitle(title) {
  var key = normalizeSearchGroupKey(title);
  return [
    '펀드지분',
    '브릿지론',
    '비실물자산',
    '노트채권',
    '크레딧펀드',
    '선순위대출',
    '후순위대출',
    '메자닌대출',
    '지분증권',
    '회사채',
    '전환사채',
    '공모주',
    'rcps'
  ].indexOf(key) !== -1;
}

function assetDisplayGroupKey(row) {
  if (!row) return '';
  var title = canonicalDisplayTitle('asset', row);
  var titleKey = normalizeSearchGroupKey(title);
  var assetId = canonicalEntityId('asset', row);
  if (!titleKey) return assetId;
  if (isGenericAssetDisplayTitle(title)) return titleKey + ':' + assetId;
  return titleKey;
}

function cleanAssetDisplayTitle(title) {
  return String(title || '')
    .replace(/\s*\((투자|investment)\)\s*$/i, '')
    .replace(/\s*\[(투자|investment)\]\s*$/i, '')
    .trim();
}

function assetIdsForDisplayGroup(row) {
  return uniqueValues(((row && row._merged_asset_ids) || []).concat(row && row.asset_id ? [row.asset_id] : []));
}

function assetDisplayScore(row) {
  if (!row) return 0;
  return (row.review_status === 'verified' ? 100 : 0)
    + (row.physical_asset_name ? 30 : 0)
    + (row.address_text || row.address ? 10 : 0)
    + (row.pnu ? 10 : 0)
    + (Number(row.fund_count) || 0) * 5
    + (Number(row.project_count) || 0) * 5
    + (row.non_physical_asset_label ? 2 : 0);
}

function mergeAssetDisplayRows(rows) {
  var groups = {};
  (rows || []).forEach(function (row) {
    var key = assetDisplayGroupKey(row);
    if (!key) return;
    var existing = groups[key];
    var mergedIds = uniqueValues((existing && existing._merged_asset_ids) || []).concat(row.asset_id ? [row.asset_id] : []);
    var candidate = Object.assign({}, existing || {}, row, {
      _asset_display_group_key: key,
      _merged_asset_ids: uniqueValues(mergedIds),
      _merged_asset_count: uniqueValues(mergedIds).length,
      fund_count: Math.max(Number(existing && existing.fund_count) || 0, Number(row.fund_count) || 0),
      project_count: Math.max(Number(existing && existing.project_count) || 0, Number(row.project_count) || 0)
    });
    if (!existing || assetDisplayScore(row) >= assetDisplayScore(existing)) {
      groups[key] = candidate;
    } else {
      groups[key] = Object.assign({}, row, existing, {
        _asset_display_group_key: key,
        _merged_asset_ids: uniqueValues(mergedIds),
        _merged_asset_count: uniqueValues(mergedIds).length,
        fund_count: Math.max(Number(existing.fund_count) || 0, Number(row.fund_count) || 0),
        project_count: Math.max(Number(existing.project_count) || 0, Number(row.project_count) || 0)
      });
    }
  });
  return sortByDisplay(Object.values(groups), 'asset');
}

function assetLocationKey(row) {
  if (!row) return '';
  var pnuKey = normalizeSearchGroupKey(row.pnu || row.metadata?.pnu || '');
  if (pnuKey) return 'pnu:' + pnuKey;
  var addressKey = normalizeSearchGroupKey(row.address_text || row.address || row.metadata?.address || '');
  return addressKey && addressKey.length >= 5 ? 'addr:' + addressKey : '';
}

function mergeAssetRelationshipHints(target, source) {
  if (!target || !source) return target;
  target._merged_asset_ids = uniqueValues(assetIdsForDisplayGroup(target).concat(assetIdsForDisplayGroup(source)));
  target._merged_asset_count = target._merged_asset_ids.length;
  target.fund_count = Math.max(Number(target.fund_count) || 0, Number(source.fund_count) || 0);
  target.project_count = Math.max(Number(target.project_count) || 0, Number(source.project_count) || 0);
  return target;
}

function absorbSameLocationAssets(matchingAssets, allAssets, terms) {
  var visibleRows = (matchingAssets || []).map(function (asset) { return Object.assign({}, asset); });
  var visibleByLocation = {};
  visibleRows.forEach(function (asset) {
    var key = assetLocationKey(asset);
    if (key && !visibleByLocation[key]) visibleByLocation[key] = asset;
  });
  (allAssets || []).forEach(function (asset) {
    if (titleMatchesQuery('asset', asset, terms)) return;
    var key = assetLocationKey(asset);
    if (key && visibleByLocation[key]) {
      mergeAssetRelationshipHints(visibleByLocation[key], asset);
    }
  });
  return visibleRows;
}

function assetRowsForSearchContext(rows, terms) {
  var merged = mergeAssetDisplayRows(rows || []);
  var matching = merged.filter(function (asset) {
    return titleMatchesQuery('asset', asset, terms);
  });
  return matching.length ? absorbSameLocationAssets(matching, merged, terms) : merged;
}

function indexRowsForType(rows, entityType) {
  return (rows || []).filter(function (row) { return row.entity_type === entityType; });
}

function searchTermsMatchText(terms, text) {
  var haystack = String(text || '').toLowerCase();
  return (terms || []).some(function (term) {
    return term && haystack.indexOf(String(term).toLowerCase()) !== -1;
  });
}

function shouldExpandRelatedIdsFromIndexRow(row, terms) {
  if (!row) return false;
  if (row.entity_type !== 'lender' && row.entity_type !== 'beneficiary') return true;
  return searchTermsMatchText(terms, row.display_title || '');
}

function indexDisplayTermsForType(rows, entityType, terms, options) {
  options = options || {};
  return uniqueValues(indexRowsForType(rows, entityType).map(function (row) {
    return row.display_title || row.token_text || '';
  })).filter(function (value) {
    if (!value || /^\d+$/.test(value)) return false;
    if (options.requireDisplayMatch && !searchTermsMatchText(terms, value)) return false;
    return true;
  });
}

function hydratePortfolioSearchRows(indexRows, options) {
  options = options || {};
  indexRows = indexRows || [];
  var relatedIdRows = indexRows.filter(function (row) {
    return shouldExpandRelatedIdsFromIndexRow(row, options.terms);
  });
  var fundIds = uniqueValues(indexRowsForType(indexRows, 'fund').map(function (row) { return row.entity_id; })
    .concat(relatedIdRows.map(function (row) { return row.related_fund_id; })));
  var assetIdSources = indexRowsForType(indexRows, 'asset').map(function (row) { return row.entity_id; });
  if (options.includeRelatedAssets !== false) {
    assetIdSources = assetIdSources.concat(relatedIdRows.map(function (row) { return row.related_asset_id; }));
  }
  var assetIds = uniqueValues(assetIdSources);
  var projectIds = uniqueValues(indexRowsForType(indexRows, 'project').map(function (row) { return row.entity_id; })
    .concat(relatedIdRows.map(function (row) { return row.related_project_id; })));
  var lenderIds = numericIds(indexRowsForType(indexRows, 'lender').map(function (row) { return row.entity_id; }));
  var beneficiaryIds = numericIds(indexRowsForType(indexRows, 'beneficiary').map(function (row) { return row.entity_id; }));
  var lenderDisplayTerms = indexDisplayTermsForType(indexRows, 'lender', options.terms, { requireDisplayMatch: true });
  var beneficiaryDisplayTerms = indexDisplayTermsForType(indexRows, 'beneficiary', options.terms, { requireDisplayMatch: true });
  var lenderFallbacks = indexRowsForType(indexRows, 'lender').map(function (row) {
    return {
      id: row.entity_id,
      entity_id: row.entity_id,
      lender_clean: row.display_title,
      lender_raw: row.display_title,
      fund_id: row.related_fund_id,
      asset_id: row.related_asset_id,
      _search_index_only: true
    };
  });
  var beneficiaryFallbacks = indexRowsForType(indexRows, 'beneficiary').map(function (row) {
    return {
      id: row.entity_id,
      entity_id: row.entity_id,
      beneficiary_clean: row.display_title,
      beneficiary_raw: row.display_title,
      fund_id: row.related_fund_id,
      asset_id: row.related_asset_id,
      _search_index_only: true
    };
  });

  var fundReq = fundIds.length
    ? _supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds).limit(500)
    : Promise.resolve({ data: [] });
  var assetReq = assetIds.length
    ? _supabase.from('asset_relationship_summary').select('*').in('asset_id', assetIds).limit(500)
    : Promise.resolve({ data: [] });
  var assetMasterReq = assetIds.length
    ? _supabase.from('asset_master').select('*').in('asset_id', assetIds).limit(500)
    : Promise.resolve({ data: [] });
  var projectReq = projectIds.length
    ? _supabase.from('projects').select('*').in('project_id', projectIds).limit(500)
    : Promise.resolve({ data: [] });
  var lenderReq = lenderIds.length
    ? _supabase.from('lender_exposures').select('*, funds(*)').in('id', lenderIds).limit(500)
    : Promise.resolve({ data: [] });
  var beneficiaryReq = beneficiaryIds.length
    ? _supabase.from('beneficiary_exposures').select('*, funds(*)').in('id', beneficiaryIds).limit(500)
    : Promise.resolve({ data: [] });
  var lenderNameReq = lenderDisplayTerms.length
    ? _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(['lender_clean', 'lender_raw'], lenderDisplayTerms)).limit(500)
    : Promise.resolve({ data: [] });
  var beneficiaryNameReq = beneficiaryDisplayTerms.length
    ? _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(['beneficiary_clean', 'beneficiary_raw'], beneficiaryDisplayTerms)).limit(500)
    : Promise.resolve({ data: [] });

  return Promise.all([fundReq, assetReq, assetMasterReq, projectReq, lenderReq, beneficiaryReq, lenderNameReq, beneficiaryNameReq]).then(function (responses) {
    responses.forEach(function (res) {
      if (res.error) throw res.error;
    });

    var projectFallbacksById = {};
    indexRowsForType(indexRows, 'project').forEach(function (row) {
      if (!row.entity_id) return;
      var current = projectFallbacksById[row.entity_id] || {
        project_id: row.entity_id,
        project_name: row.display_title,
        project_type: row.relation_type,
        status: row.token_type,
        primary_asset_ids: [],
        _search_index_only: true
      };
      if (row.related_asset_id && current.primary_asset_ids.indexOf(row.related_asset_id) === -1) {
        current.primary_asset_ids.push(row.related_asset_id);
      }
      if (!current.primary_asset_id && row.related_asset_id) current.primary_asset_id = row.related_asset_id;
      projectFallbacksById[row.entity_id] = current;
    });
    var projectFallbacks = Object.values(projectFallbacksById);

    var funds = responses[0].data || [];
    funds.forEach(function (f) {
      if (f.dept_resolved) f.dept = f.dept_resolved;
      if (f.manager_resolved) f.manager = f.manager_resolved;
    });

    return {
      lenders: dedupeEntities((responses[4].data || []).concat(responses[6].data || [], lenderFallbacks), 'lender'),
      beneficiaries: dedupeEntities((responses[5].data || []).concat(responses[7].data || [], beneficiaryFallbacks), 'ben'),
      funds: dedupeEntities(funds, 'fund'),
      assets: [],
      projects: dedupeEntities(mergeRowsByKey(responses[3].data || [], projectFallbacks, 'project_id'), 'project'),
      assetGroups: mergeAssetDisplayRows(dedupeEntities(mergeRowsByKey(responses[1].data || [], responses[2].data || [], 'asset_id'), 'asset')),
      _indexRows: indexRows
    };
  });
}

function performIndexedSearchOn(surface, terms, options) {
  options = options || {};
  options.terms = terms;
  var query = _supabase
    .from(surface)
    .select('*')
    .or(buildUniversalFilter(['token_text'], terms))
    .order('rank_weight', { ascending: false })
    .limit(options.limit || 300);

  if (options.entityTypes && options.entityTypes.length) {
    query = query.in('entity_type', options.entityTypes);
  }

  return query.then(function (indexRes) {
    if (indexRes.error) throw indexRes.error;
    return hydratePortfolioSearchRows(indexRes.data || [], options);
  });
}

function performIndexedSearch(query, terms) {
  var options = isShortNumericSearch(query)
    ? { entityTypes: ['fund', 'project'], includeRelatedAssets: false, limit: 200 }
    : {};

  return performIndexedSearchOn('portfolio_search_results_canonical', terms, options).catch(function (canonicalError) {
    window.searchContractMode = 'raw_token_fallback';
    console.warn('portfolio_search_results_canonical unavailable; using raw portfolio_search_index.', canonicalError);
    return performIndexedSearchOn('portfolio_search_index', terms, options);
  });
}

function performLegacySearch(query, requestId) {
  window.currentSearchQuery = query || '';
  if (!query) {
    if (requestId && requestId !== latestSearchRequestId) return Promise.resolve();
    resultsContainer.innerHTML = '<div class="no-results">\uC870\uD68C\uB97C \uC2DC\uC791\uD558\uC138\uC694.</div>';
    updateTabCounts();
    return Promise.resolve();
  }

  var terms = getSearchTerms(query);
  var shortNumeric = isShortNumericSearch(query);
  var exposureColumns = shortNumeric ? ['fund_id'] : ['lender_clean', 'fund_id'];
  var beneficiaryColumns = shortNumeric ? ['fund_id'] : ['beneficiary_clean', 'fund_id'];
  var projectColumns = shortNumeric ? ['project_code', 'project_name'] : ['project_id', 'project_code', 'project_name', 'project_type', 'status'];

  return ensureFundSearchColumns().then(function () {
    var activeFundSearchColumns = shortNumeric
      ? fundSearchColumns.filter(function (col) {
        return ['fund_id', 'fund_name', 'short_name', 'project_mission_name'].includes(col);
      })
      : fundSearchColumns;
    return Promise.all([
      _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(exposureColumns, terms)).limit(100),
      _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(beneficiaryColumns, terms)).limit(100),
      _supabase.from('v_funds_enriched').select('*').or(buildUniversalFilter(activeFundSearchColumns, terms)).limit(100),
      _supabase.from('projects').select('*').or(buildUniversalFilter(projectColumns, terms)).limit(100),
      window.AssetCanonical
        ? window.AssetCanonical.searchCanonicalAssets(terms, { shortNumeric: shortNumeric })
        : _supabase.from('fund_assets').select('*, funds(*)').or(buildUniversalFilter(['asset_name', 'fund_id'], terms)).limit(100)
    ]);
  }).then(function (responses) {
    if (requestId && requestId !== latestSearchRequestId) return;
    var lenderRes = responses[0];
    var benRes = responses[1];
    var fundRes = responses[2];
    var projectRes = responses[3];
    var assetRes = responses[4];
    var rawFunds = fundRes.data || [];
    // Map resolved names for UI compatibility
    rawFunds.forEach(f => {
      if (f.dept_resolved) f.dept = f.dept_resolved;
      if (f.manager_resolved) f.manager = f.manager_resolved;
    });

    var projects = rawFunds.filter(function (f) {
      var hasOfficialFundName = (f.fund_name && f.fund_name.trim()) || (f.short_name && f.short_name.trim());
      return !hasOfficialFundName && f.project_mission_name;
    });
    var normalFunds = rawFunds.filter(function (f) {
      var hasOfficialFundName = (f.fund_name && f.fund_name.trim()) || (f.short_name && f.short_name.trim());
      return hasOfficialFundName || !f.project_mission_name;
    });

    allResults = {
      lenders: dedupeEntities(lenderRes.data || [], 'lender'),
      beneficiaries: dedupeEntities(benRes.data || [], 'ben'),
      funds: dedupeEntities(normalFunds, 'fund'),
      assets: window.AssetCanonical ? [] : (assetRes.data || []),
      projects: dedupeEntities(projects.concat(projectRes.data || []), 'project'),
      assetGroups: window.AssetCanonical ? dedupeEntities(assetRes.data || [], 'asset') : [],
      _indexRows: []
    };
    window.allResults = allResults;

    updateTabCounts();
    renderResults();
  }).catch(function (error) {
    console.error(error);
  });
}

function performSearch(query) {
  window.currentSearchQuery = query || '';
  window.searchContractMode = 'canonical';
  latestSearchRequestId += 1;
  window.latestSearchRequestId = latestSearchRequestId;
  var requestId = latestSearchRequestId;
  if (!query) {
    resultsContainer.innerHTML = '<div class="no-results">\uC870\uD68C\uB97C \uC2DC\uC791\uD558\uC138\uC694.</div>';
    updateTabCounts();
    return Promise.resolve();
  }

  var terms = getSearchTerms(query);
  return performIndexedSearch(query, terms).then(function (hydrated) {
    if (requestId !== latestSearchRequestId) return;
    allResults = hydrated;
    window.allResults = allResults;
    updateTabCounts();
    renderResults();
  }).catch(function (error) {
    if (requestId !== latestSearchRequestId) return;
    window.searchContractMode = 'legacy_fallback';
    console.warn('portfolio_search_index unavailable; using legacy search path.', error);
    return performLegacySearch(query, requestId);
  });
}

function updateTabCounts() {
  var terms = getSearchTerms(window.currentSearchQuery || '');
  var assetRows = assetRowsForSearchContext(allResults.assetGroups && allResults.assetGroups.length ? allResults.assetGroups : allResults.assets, terms);
  var assetCount = assetRows.length;
  var entityTotal = allResults.lenders.length
    + allResults.beneficiaries.length
    + allResults.funds.length
    + assetCount
    + allResults.projects.length;
  var counts = {
    all: entityTotal,
    fund: allResults.funds.length,
    asset: assetCount,
    ben: allResults.beneficiaries.length,
    lender: allResults.lenders.length,
    project: allResults.projects.length
  };

  tabBtns.forEach(function (btn) {
    var tab = btn.dataset.tab;
    var count = counts[tab] || 0;
    // 최초 1회만 원본 라벨 저장
    if (!btn.dataset.label) {
      btn.dataset.label = btn.textContent.trim();
    }
    var label = btn.dataset.label;
    btn.innerHTML = '<span>' + label + '</span><span class="tab-count">' + count + '</span>';
  });
}

function renderResults() {
  resultsContainer.innerHTML = '';
  if (currentTab === 'all') {
    var clusters = buildRelationshipClusters(window.currentSearchQuery || '');
    window.relationshipClusters = clusters;
    if (clusters.length) {
      var summary = buildSearchSummaryText(window.currentSearchQuery || '', clusters, allResults);
      if (summary) {
        var summaryEl = document.createElement('div');
        summaryEl.className = 'search-summary-bar';
        summaryEl.textContent = summary;
        resultsContainer.appendChild(summaryEl);
      }
      clusters.forEach(renderRelationshipClusterCard);
      return;
    }
  }

  var terms = getSearchTerms(window.currentSearchQuery || '');
  var displayAssetRows = assetRowsForSearchContext(allResults.assetGroups && allResults.assetGroups.length ? allResults.assetGroups : allResults.assets, terms);
  var groupedLenders = groupEntities(allResults.lenders, 'lender');
  var groupedBens = groupEntities(allResults.beneficiaries, 'ben');
  var groupedAssets = groupEntities(displayAssetRows, 'asset');
  var groupedFunds = groupEntities(allResults.funds, 'fund');
  var groupedProjects = groupEntities(allResults.projects, 'project');

  if (currentTab === 'all' || currentTab === 'project') Object.keys(groupedProjects).forEach(function (k) { renderGroupCard('project', k, groupedProjects[k]); });
  if (currentTab === 'all' || currentTab === 'fund') Object.keys(groupedFunds).forEach(function (k) { renderGroupCard('fund', k, groupedFunds[k]); });
  if (currentTab === 'all' || currentTab === 'asset') {
    if (window.AssetCanonical && allResults.assetGroups) {
      window.AssetCanonical.renderCanonicalAssetCards(displayAssetRows, resultsContainer);
    } else {
      Object.keys(groupedAssets).forEach(function (k) { renderGroupCard('asset', k, groupedAssets[k]); });
    }
  }
  if (currentTab === 'all' || currentTab === 'lender') Object.keys(groupedLenders).forEach(function (n) { renderGroupCard('lender', n, groupedLenders[n]); });
  if (currentTab === 'all' || currentTab === 'ben') Object.keys(groupedBens).forEach(function (n) { renderGroupCard('ben', n, groupedBens[n]); });
}

function normalizeSearchGroupKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()［］\[\]{}·ㆍ\-_]/g, '');
}

function relatedAssetIdsForProjectResult(row, displayTitle) {
  var ids = primaryAssetIdsFromSearchResult(row);
  var projectKey = normalizeSearchGroupKey(displayTitle || canonicalDisplayTitle('project', row));
  if (!projectKey) return ids;
  (allResults.assetGroups || allResults.assets || []).forEach(function (asset) {
    var assetKey = normalizeSearchGroupKey(canonicalDisplayTitle('asset', asset) || getResultItemDisplayName(asset));
    if (assetKey === projectKey && asset.asset_id) ids.push(asset.asset_id);
  });
  return uniqueValues(ids);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightTerms(text, terms) {
  var result = escapeHtml(text || '');
  var patterns = uniqueValues((terms || []).map(function (term) {
    if (!term || String(term).length < 2) return '';
    return escapeRegExp(escapeHtml(term));
  }).filter(Boolean)).sort(function (a, b) {
    return b.length - a.length;
  });
  if (!patterns.length) return result;
  return result.replace(new RegExp('(' + patterns.join('|') + ')', 'gi'), '<mark class="search-highlight">$1</mark>');
}

function clusterBucketName(type) {
  return {
    fund: 'funds',
    asset: 'assets',
    project: 'projects',
    lender: 'lenders',
    ben: 'beneficiaries'
  }[type] || type;
}

function clusterTypeLabel(type) {
  return {
    fund: '\uD380\uB4DC',
    asset: '\uC790\uC0B0',
    project: '\uD504\uB85C\uC81D\uD2B8',
    lender: '\uB300\uC8FC',
    ben: '\uC218\uC775\uC790',
    party: '\uAD00\uACC4\uAE30\uAD00',
    topic: '\uD1A0\uD53D',
    numeric: '\uCF54\uB4DC'
  }[type] || type;
}

function clusterCardTypeLabel(type) {
  return {
    asset: '\uC790\uC0B0',
    project: '\uD504\uB85C\uC81D\uD2B8',
    party: '\uAE30\uAD00',
    topic: '\uD3EC\uD2B8\uD3F4\uB9AC\uC624',
    fund: '\uD380\uB4DC',
    numeric: '\uCF54\uB4DC'
  }[type] || 'RELATION';
}

function clusterCardTypeClass(type) {
  return String(type || 'relation').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function relationshipEntityRows() {
  var terms = getSearchTerms(window.currentSearchQuery || '');
  var rawAssets = allResults.assetGroups && allResults.assetGroups.length ? allResults.assetGroups : (allResults.assets || []);
  return {
    funds: allResults.funds || [],
    assets: assetRowsForSearchContext(rawAssets, terms),
    projects: allResults.projects || [],
    lenders: allResults.lenders || [],
    beneficiaries: allResults.beneficiaries || []
  };
}

function relationshipEntityLookups(rows) {
  var lookups = { fund: {}, asset: {}, project: {}, lender: {}, ben: {} };
  [
    ['fund', rows.funds],
    ['asset', rows.assets],
    ['project', rows.projects],
    ['lender', rows.lenders],
    ['ben', rows.beneficiaries]
  ].forEach(function (entry) {
    var type = entry[0];
    (entry[1] || []).forEach(function (row) {
      var id = canonicalEntityId(type, row);
      if (id) lookups[type][String(id)] = row;
      if (type === 'asset') {
        assetIdsForDisplayGroup(row).forEach(function (assetId) {
          lookups[type][String(assetId)] = row;
        });
      }
    });
  });
  return lookups;
}

function appendMapValue(map, key, value) {
  if (!key || !value) return;
  key = String(key);
  value = String(value);
  map[key] = map[key] || [];
  if (map[key].indexOf(value) === -1) map[key].push(value);
}

function appendTwoWay(leftMap, rightMap, leftId, rightId) {
  appendMapValue(leftMap, leftId, rightId);
  appendMapValue(rightMap, rightId, leftId);
}

function buildRelationshipMaps(rows) {
  var maps = {
    assetFunds: {}, fundAssets: {},
    assetProjects: {}, projectAssets: {},
    fundProjects: {}, projectFunds: {},
    lenderFunds: {}, fundLenders: {},
    lenderAssets: {}, assetLenders: {},
    benFunds: {}, fundBens: {},
    benAssets: {}, assetBens: {}
  };

  (allResults._indexRows || []).forEach(function (row) {
    var entityType = row.entity_type === 'beneficiary' ? 'ben' : row.entity_type;
    var entityId = row.entity_id;
    var assetIds = uniqueValues([(entityType === 'asset' ? entityId : null), row.related_asset_id]);
    var fundIds = uniqueValues([(entityType === 'fund' ? entityId : null), row.related_fund_id]);
    var projectIds = uniqueValues([(entityType === 'project' ? entityId : null), row.related_project_id]);

    assetIds.forEach(function (assetId) {
      fundIds.forEach(function (fundId) { appendTwoWay(maps.assetFunds, maps.fundAssets, assetId, fundId); });
      projectIds.forEach(function (projectId) { appendTwoWay(maps.assetProjects, maps.projectAssets, assetId, projectId); });
    });
    fundIds.forEach(function (fundId) {
      projectIds.forEach(function (projectId) { appendTwoWay(maps.fundProjects, maps.projectFunds, fundId, projectId); });
    });

    if (entityType === 'lender' && entityId) {
      fundIds.forEach(function (fundId) { appendTwoWay(maps.lenderFunds, maps.fundLenders, entityId, fundId); });
      assetIds.forEach(function (assetId) { appendTwoWay(maps.lenderAssets, maps.assetLenders, entityId, assetId); });
    }
    if (entityType === 'ben' && entityId) {
      fundIds.forEach(function (fundId) { appendTwoWay(maps.benFunds, maps.fundBens, entityId, fundId); });
      assetIds.forEach(function (assetId) { appendTwoWay(maps.benAssets, maps.assetBens, entityId, assetId); });
    }
  });

  (rows.funds || []).forEach(function (fund) {
    var fundId = canonicalEntityId('fund', fund);
    primaryAssetIdsFromSearchResult(fund).forEach(function (assetId) {
      appendTwoWay(maps.assetFunds, maps.fundAssets, assetId, fundId);
    });
  });

  (rows.projects || []).forEach(function (project) {
    var projectId = canonicalEntityId('project', project);
    primaryAssetIdsFromSearchResult(project).forEach(function (assetId) {
      appendTwoWay(maps.assetProjects, maps.projectAssets, assetId, projectId);
    });
  });

  (rows.lenders || []).forEach(function (row) {
    var lenderId = canonicalEntityId('lender', row);
    appendTwoWay(maps.lenderFunds, maps.fundLenders, lenderId, row.fund_id || row.related_fund_id);
    appendTwoWay(maps.lenderAssets, maps.assetLenders, lenderId, row.asset_id || row.related_asset_id);
  });

  (rows.beneficiaries || []).forEach(function (row) {
    var benId = canonicalEntityId('ben', row);
    appendTwoWay(maps.benFunds, maps.fundBens, benId, row.fund_id || row.related_fund_id);
    appendTwoWay(maps.benAssets, maps.assetBens, benId, row.asset_id || row.related_asset_id);
  });

  return maps;
}

function createRelationshipCluster(clusterId, clusterType, title, subtitle, matchedType, matchedRow) {
  return {
    cluster_id: clusterId,
    cluster_type: clusterType,
    title: title || clusterId,
    subtitle: subtitle || '',
    matched_entity: matchedType ? { type: matchedType, id: canonicalEntityId(matchedType, matchedRow) } : null,
    entities: { funds: [], assets: [], projects: [], lenders: [], beneficiaries: [] },
    relation_paths: [],
    _keys: {}
  };
}

function addClusterEntity(cluster, type, row, relationPath) {
  if (!cluster || !row) return;
  var bucket = clusterBucketName(type);
  var id = canonicalEntityId(type, row) || normalizeSearchGroupKey(canonicalDisplayTitle(type, row));
  if (!bucket || !id) return;
  var key = type + ':' + (type === 'asset' ? assetDisplayGroupKey(row) : id);
  if (cluster._keys[key]) return;
  cluster._keys[key] = true;
  cluster.entities[bucket].push(row);
  if (relationPath && cluster.relation_paths.indexOf(relationPath) === -1) cluster.relation_paths.push(relationPath);
}

function addEntityById(cluster, type, id, lookups, relationPath) {
  if (!id || !lookups[type]) return;
  addClusterEntity(cluster, type, lookups[type][String(id)], relationPath);
}

function addLinkedAssets(cluster, assetIds, maps, lookups) {
  uniqueValues(assetIds).forEach(function (assetId) {
    addEntityById(cluster, 'asset', assetId, lookups, 'asset');
    (maps.assetFunds[assetId] || []).forEach(function (fundId) {
      addEntityById(cluster, 'fund', fundId, lookups, 'asset_fund');
    });
    (maps.assetProjects[assetId] || []).forEach(function (projectId) {
      addEntityById(cluster, 'project', projectId, lookups, 'asset_project');
    });
    (maps.assetLenders[assetId] || []).forEach(function (lenderId) {
      addEntityById(cluster, 'lender', lenderId, lookups, 'asset_lender');
    });
    (maps.assetBens[assetId] || []).forEach(function (benId) {
      addEntityById(cluster, 'ben', benId, lookups, 'asset_beneficiary');
    });
  });
}

function addLinkedFunds(cluster, fundIds, maps, lookups, includeAssets) {
  uniqueValues(fundIds).forEach(function (fundId) {
    addEntityById(cluster, 'fund', fundId, lookups, 'fund');
    if (includeAssets) {
      (maps.fundAssets[fundId] || []).forEach(function (assetId) {
        addEntityById(cluster, 'asset', assetId, lookups, 'fund_asset');
      });
    }
    (maps.fundProjects[fundId] || []).forEach(function (projectId) {
      addEntityById(cluster, 'project', projectId, lookups, 'fund_project');
    });
    (maps.fundLenders[fundId] || []).forEach(function (lenderId) {
      addEntityById(cluster, 'lender', lenderId, lookups, 'fund_lender');
    });
    (maps.fundBens[fundId] || []).forEach(function (benId) {
      addEntityById(cluster, 'ben', benId, lookups, 'fund_beneficiary');
    });
  });
}

function addLinkedPartiesForClusterFunds(cluster, maps, lookups) {
  var fundIds = cluster.entities.funds.map(function (fund) { return canonicalEntityId('fund', fund); });
  addLinkedFunds(cluster, fundIds, maps, lookups, false);
}

function addLinkedProjects(cluster, projectIds, maps, lookups) {
  uniqueValues(projectIds).forEach(function (projectId) {
    addEntityById(cluster, 'project', projectId, lookups, 'project');
    addLinkedAssets(cluster, maps.projectAssets[projectId] || [], maps, lookups);
    addLinkedFunds(cluster, maps.projectFunds[projectId] || [], maps, lookups, false);
  });
}

function addSameTitleProjects(cluster, asset, rows, maps, lookups) {
  var assetKey = normalizeSearchGroupKey(canonicalDisplayTitle('asset', asset));
  if (!assetKey) return;
  (rows.projects || []).forEach(function (project) {
    var projectKey = normalizeSearchGroupKey(canonicalDisplayTitle('project', project));
    if (projectKey === assetKey) {
      addClusterEntity(cluster, 'project', project, 'same_title_project');
      addLinkedProjects(cluster, [canonicalEntityId('project', project)], maps, lookups);
    }
  });
}

function addSameTitleAssets(cluster, project, rows, maps, lookups) {
  var projectKey = normalizeSearchGroupKey(canonicalDisplayTitle('project', project));
  if (!projectKey) return;
  (rows.assets || []).forEach(function (asset) {
    var assetKey = normalizeSearchGroupKey(canonicalDisplayTitle('asset', asset));
    if (assetKey === projectKey) {
      addClusterEntity(cluster, 'asset', asset, 'same_title_asset');
      addLinkedAssets(cluster, [canonicalEntityId('asset', asset)], maps, lookups);
    }
  });
}

function clusterEntityCount(cluster) {
  return cluster.entities.funds.length
    + cluster.entities.assets.length
    + cluster.entities.projects.length
    + cluster.entities.lenders.length
    + cluster.entities.beneficiaries.length;
}

function hasRelationshipPayload(cluster) {
  return (cluster.entities.assets.length + cluster.entities.funds.length + cluster.entities.lenders.length + cluster.entities.beneficiaries.length) > 0;
}

function clusterCounts(cluster) {
  return [
    ['asset', cluster.entities.assets.length],
    ['fund', cluster.entities.funds.length],
    ['project', cluster.entities.projects.length],
    ['lender', cluster.entities.lenders.length],
    ['ben', cluster.entities.beneficiaries.length]
  ].filter(function (entry) { return entry[1] > 0; });
}

function uniqueClusterEntityCount(clusters, bucket, type) {
  var seen = {};
  (clusters || []).forEach(function (cluster) {
    ((cluster.entities && cluster.entities[bucket]) || []).forEach(function (row) {
      var key = type === 'asset'
        ? assetDisplayGroupKey(row)
        : canonicalEntityId(type, row) || normalizeSearchGroupKey(canonicalDisplayTitle(type, row));
      if (key) seen[key] = true;
    });
  });
  return Object.keys(seen).length;
}

function buildSearchSummaryText(query, clusters) {
  if (!clusters || !clusters.length) return '';
  var trimmedQuery = String(query || '').trim();
  var first = clusters[0];
  var type = first.cluster_type;
  var totalAssets = uniqueClusterEntityCount(clusters, 'assets', 'asset');
  var totalFunds = uniqueClusterEntityCount(clusters, 'funds', 'fund');
  var totalProjects = uniqueClusterEntityCount(clusters, 'projects', 'project');
  var totalLenders = uniqueClusterEntityCount(clusters, 'lenders', 'lender');
  var totalBeneficiaries = uniqueClusterEntityCount(clusters, 'beneficiaries', 'ben');
  var clusterPart = clusters.length + '\uAC1C \uBB36\uC74C\uC73C\uB85C \uD45C\uC2DC';

  if (type === 'party') {
    return first.title + '\uC774(\uAC00) \uCC38\uC5EC\uD55C \uC790\uC0B0 ' + totalAssets + '\uAC1C, \uD380\uB4DC ' + totalFunds + '\uAC1C';
  }
  if (type === 'project') {
    return '"' + trimmedQuery + '" \uD504\uB85C\uC81D\uD2B8\uC640 \uC5F0\uACB0\uB41C \uC790\uC0B0 ' + totalAssets + '\uAC1C, \uD380\uB4DC ' + totalFunds + '\uAC1C';
  }
  if (type === 'fund') {
    return '"' + trimmedQuery + '"\uC774(\uAC00) \uD3EC\uD568\uB41C \uD380\uB4DC ' + totalFunds + '\uAC1C';
  }
  if (clusters.length === 1) {
    return '\uC790\uC0B0 ' + totalAssets + '\uAC1C \u00B7 \uD380\uB4DC ' + totalFunds + '\uAC1C \u00B7 \uD504\uB85C\uC81D\uD2B8 ' + totalProjects + '\uAC1C';
  }
  var partyText = (totalLenders || totalBeneficiaries)
    ? ', \uAE30\uAD00 ' + (totalLenders + totalBeneficiaries) + '\uAC1C'
    : '';
  return '"' + trimmedQuery + '" \uAD00\uB828 \uC790\uC0B0 ' + totalAssets + '\uAC1C, \uD380\uB4DC ' + totalFunds + '\uAC1C, \uD504\uB85C\uC81D\uD2B8 ' + totalProjects + '\uAC1C' + partyText + ' · ' + clusterPart;
}

function titleMatchesQuery(type, row, terms) {
  return searchTermsMatchText(terms, canonicalDisplayTitle(type, row));
}

function projectRootId(project, projectLookup) {
  if (!project) return '';
  var parentId = project.parent_project_id || '';
  if (parentId && projectLookup[String(parentId)]) return String(parentId);
  return String(parentId || project.project_id || '');
}

function buildPartyClusters(query, rows, maps, lookups, terms) {
  var partyGroups = {};
  function appendParty(type, row) {
    if (!titleMatchesQuery(type, row, terms)) return;
    var title = canonicalDisplayTitle(type, row);
    var key = normalizeSearchGroupKey(title);
    if (!key) return;
    partyGroups[key] = partyGroups[key] || createRelationshipCluster('party:' + key, 'party', title, '\uAE30\uAD00\uBA85 \uAE30\uBC18 \uAD00\uACC4 \uBB36\uC74C', type, row);
    addClusterEntity(partyGroups[key], type, row, 'matched_party');
  }

  (rows.lenders || []).forEach(function (row) { appendParty('lender', row); });
  (rows.beneficiaries || []).forEach(function (row) { appendParty('ben', row); });

  Object.values(partyGroups).forEach(function (cluster) {
    cluster.entities.lenders.forEach(function (row) {
      var id = canonicalEntityId('lender', row);
      addLinkedFunds(cluster, maps.lenderFunds[id] || [], maps, lookups, true);
      addLinkedAssets(cluster, maps.lenderAssets[id] || [], maps, lookups);
    });
    cluster.entities.beneficiaries.forEach(function (row) {
      var id = canonicalEntityId('ben', row);
      addLinkedFunds(cluster, maps.benFunds[id] || [], maps, lookups, true);
      addLinkedAssets(cluster, maps.benAssets[id] || [], maps, lookups);
    });
    addLinkedAssets(cluster, cluster.entities.assets.map(function (asset) { return canonicalEntityId('asset', asset); }), maps, lookups);
  });

  return Object.values(partyGroups).filter(function (cluster) { return clusterEntityCount(cluster) > 0; });
}

function buildProjectClusters(query, rows, maps, lookups, terms) {
  var matchingProjects = (rows.projects || []).filter(function (project) {
    return titleMatchesQuery('project', project, terms);
  });
  var projectGroups = {};
  var projectLookup = lookups.project;

  matchingProjects.forEach(function (project) {
    var rootId = projectRootId(project, projectLookup);
    var rootProject = projectLookup[rootId] || project;
    var title = canonicalDisplayTitle('project', rootProject) || canonicalDisplayTitle('project', project);
    var cluster = projectGroups[rootId] || createRelationshipCluster('project:' + rootId, 'project', title, '\uD504\uB85C\uC81D\uD2B8 \uBC94\uC704 \uAD00\uACC4 \uBB36\uC74C', 'project', rootProject);
    projectGroups[rootId] = cluster;

    (rows.projects || []).forEach(function (candidate) {
      if (candidate.project_id === rootId || candidate.parent_project_id === rootId || candidate.project_id === project.project_id) {
        addClusterEntity(cluster, 'project', candidate, candidate.project_id === rootId ? 'project_root' : 'project_child');
        var projectAssetIds = primaryAssetIdsFromSearchResult(candidate).concat(maps.projectAssets[candidate.project_id] || []);
        addLinkedAssets(cluster, projectAssetIds, maps, lookups);
        addLinkedFunds(cluster, maps.projectFunds[candidate.project_id] || [], maps, lookups, false);
        addSameTitleAssets(cluster, candidate, rows, maps, lookups);
        addLinkedPartiesForClusterFunds(cluster, maps, lookups);
      }
    });
  });

  return Object.values(projectGroups).filter(function (cluster) { return clusterEntityCount(cluster) > 0; });
}

function hasProjectDominance(query, rows, lookups, terms) {
  var matchingProjects = (rows.projects || []).filter(function (project) {
    return titleMatchesQuery('project', project, terms);
  });
  if (!matchingProjects.length) return false;
  if ((rows.projects || []).length > 1 || (rows.assets || []).length > 1) return true;
  return matchingProjects.some(function (project) {
    return !project.parent_project_id && (rows.projects || []).some(function (candidate) {
      return candidate.parent_project_id === project.project_id;
    });
  });
}

function buildAssetClusters(query, rows, maps, lookups, terms) {
  return (rows.assets || []).filter(function (asset) {
    return titleMatchesQuery('asset', asset, terms);
  }).map(function (asset) {
    var assetId = canonicalEntityId('asset', asset);
    var cluster = createRelationshipCluster('asset:' + assetId, 'asset', canonicalDisplayTitle('asset', asset), '\uC790\uC0B0 \uAE30\uBC18 \uAD00\uACC4 \uBB36\uC74C', 'asset', asset);
    addClusterEntity(cluster, 'asset', asset, titleMatchesQuery('asset', asset, terms) ? 'matched_asset' : 'related_asset');
    addLinkedAssets(cluster, assetIdsForDisplayGroup(asset), maps, lookups);
    addSameTitleProjects(cluster, asset, rows, maps, lookups);
    addLinkedPartiesForClusterFunds(cluster, maps, lookups);
    return cluster;
  }).filter(function (cluster) { return clusterEntityCount(cluster) > 0; });
}

function buildFundClusters(query, rows, maps, lookups, terms, onlyUnclusteredKeys) {
  return (rows.funds || []).filter(function (fund) {
    return !onlyUnclusteredKeys || !onlyUnclusteredKeys[canonicalEntityKey('fund', fund)];
  }).map(function (fund) {
    var fundId = canonicalEntityId('fund', fund);
    var cluster = createRelationshipCluster('fund:' + fundId, 'fund', canonicalDisplayTitle('fund', fund), '\uD380\uB4DC \uAE30\uBC18 \uAD00\uACC4 \uBB36\uC74C', 'fund', fund);
    addClusterEntity(cluster, 'fund', fund, titleMatchesQuery('fund', fund, terms) ? 'matched_fund' : 'related_fund');
    addLinkedFunds(cluster, [fundId], maps, lookups, true);
    return cluster;
  }).filter(function (cluster) { return clusterEntityCount(cluster) > 0; });
}

function buildBroadTopicCluster(query, rows, maps, lookups, terms) {
  var matchingAssets = (rows.assets || []).filter(function (asset) {
    return titleMatchesQuery('asset', asset, terms);
  });
  if (matchingAssets.length < 2) return null;

  var title = String(query || '').trim() || canonicalDisplayTitle('asset', matchingAssets[0]);
  var cluster = createRelationshipCluster('topic:' + normalizeSearchGroupKey(title), 'topic', title, '\uAC80\uC0C9\uC5B4 \uAE30\uBC18 \uAD00\uACC4 \uBB36\uC74C', 'asset', matchingAssets[0]);

  matchingAssets.forEach(function (asset) {
    addClusterEntity(cluster, 'asset', asset, 'matched_topic_asset');
    addLinkedAssets(cluster, [canonicalEntityId('asset', asset)], maps, lookups);
    addSameTitleProjects(cluster, asset, rows, maps, lookups);
  });
  (rows.funds || []).forEach(function (fund) {
    addClusterEntity(cluster, 'fund', fund, titleMatchesQuery('fund', fund, terms) ? 'matched_topic_fund' : 'topic_related_fund');
  });
  (rows.projects || []).forEach(function (project) {
    addClusterEntity(cluster, 'project', project, titleMatchesQuery('project', project, terms) ? 'matched_topic_project' : 'topic_related_project');
    addLinkedProjects(cluster, [canonicalEntityId('project', project)], maps, lookups);
  });
  addLinkedPartiesForClusterFunds(cluster, maps, lookups);
  (rows.lenders || []).forEach(function (lender) {
    if (titleMatchesQuery('lender', lender, terms)) addClusterEntity(cluster, 'lender', lender, 'matched_topic_lender');
  });
  (rows.beneficiaries || []).forEach(function (ben) {
    if (titleMatchesQuery('ben', ben, terms)) addClusterEntity(cluster, 'ben', ben, 'matched_topic_beneficiary');
  });
  return clusterEntityCount(cluster) ? cluster : null;
}

function collectClusterKeys(clusters) {
  var keys = {};
  (clusters || []).forEach(function (cluster) {
    Object.keys(cluster._keys || {}).forEach(function (key) { keys[key] = true; });
  });
  return keys;
}

function clusterSortScore(cluster, query, terms) {
  var score = 0;
  if (searchTermsMatchText(terms, cluster.title)) score += 1000;
  if (cluster.cluster_type === 'party') score += 60;
  if (cluster.cluster_type === 'project') score += 50;
  if (cluster.cluster_type === 'asset') score += 40;
  if (cluster.cluster_type === 'fund') score += 30;
  score += cluster.entities.assets.length * 8;
  score += cluster.entities.funds.length * 5;
  score += cluster.entities.projects.length * 4;
  score += cluster.entities.lenders.length + cluster.entities.beneficiaries.length;
  return score;
}

function buildRelationshipClusters(query) {
  var rows = relationshipEntityRows();
  var terms = getSearchTerms(query || '');
  var lookups = relationshipEntityLookups(rows);
  var maps = buildRelationshipMaps(rows);
  var clusters = [];

  if (isShortNumericSearch(query)) {
    clusters = buildFundClusters(query, rows, maps, lookups, terms, null).concat(buildProjectClusters(query, rows, maps, lookups, terms));
    return clusters.sort(function (a, b) {
      return clusterSortScore(b, query, terms) - clusterSortScore(a, query, terms)
        || String(a.title).localeCompare(String(b.title), 'ko');
    });
  }

  var partyClusters = buildPartyClusters(query, rows, maps, lookups, terms);
  var assetClusters = buildAssetClusters(query, rows, maps, lookups, terms);
  if (partyClusters.length) {
    clusters = partyClusters;
  } else if (assetClusters.length) {
    clusters = assetClusters;
  } else if (hasProjectDominance(query, rows, lookups, terms)) {
    clusters = buildProjectClusters(query, rows, maps, lookups, terms);
    var relationalProjectClusters = clusters.filter(hasRelationshipPayload);
    if (relationalProjectClusters.length) clusters = relationalProjectClusters;
  } else {
    clusters = buildAssetClusters(query, rows, maps, lookups, terms);
    var clusteredKeys = collectClusterKeys(clusters);
    clusters = clusters.concat(buildProjectClusters(query, rows, maps, lookups, terms).filter(function (cluster) {
      if (clusters.length && !hasRelationshipPayload(cluster)) return false;
      return !cluster.entities.projects.every(function (project) {
        return clusteredKeys[canonicalEntityKey('project', project)];
      });
    }));
    clusteredKeys = collectClusterKeys(clusters);
    clusters = clusters.concat(buildFundClusters(query, rows, maps, lookups, terms, clusteredKeys));
  }

  if (!clusters.length) {
    clusters = buildFundClusters(query, rows, maps, lookups, terms, null)
      .concat(buildProjectClusters(query, rows, maps, lookups, terms));
  }

  return clusters.filter(function (cluster) { return clusterEntityCount(cluster) > 0; }).sort(function (a, b) {
    return clusterSortScore(b, query, terms) - clusterSortScore(a, query, terms)
      || String(a.title).localeCompare(String(b.title), 'ko');
  });
}

function groupEntities(list, type) {
  return (list || []).reduce(function (acc, obj) {
    const displayName = canonicalDisplayTitle(type, obj) || getResultItemDisplayName(obj);
    const stableKey = (type === 'lender' || type === 'ben')
      ? (normalizeSearchGroupKey(displayName) || displayName)
      : (type === 'asset')
        ? (assetDisplayGroupKey(obj) || canonicalEntityId(type, obj) || normalizeSearchGroupKey(displayName) || displayName)
      : (canonicalEntityId(type, obj) || normalizeSearchGroupKey(displayName) || displayName);
    acc[stableKey] = acc[stableKey] || [];
    acc[stableKey].push(obj);
    return acc;
  }, {});
}

function getResultItemDisplayName(item) {
  return item.funds?.fund_name
    || item.fund_name
    || item.project_name
    || item.project_mission_name
    || item.short_name
    || item.fund_id
    || item.project_id
    || '';
}

function getResultItemId(item) {
  return item.fund_id || item.project_id || '';
}

function dedupeResultItems(items) {
  const seen = {};
  return (items || []).filter(function (item) {
    const key = normalizeSearchGroupKey(getResultItemDisplayName(item)) || getResultItemId(item);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function clusterPreviewItems(cluster) {
  var entries = [];
  [
    ['asset', cluster.entities.assets],
    ['fund', cluster.entities.funds],
    ['project', cluster.entities.projects],
    ['lender', cluster.entities.lenders],
    ['ben', cluster.entities.beneficiaries]
  ].forEach(function (entry) {
    var type = entry[0];
    (entry[1] || []).slice(0, 2).forEach(function (row) {
      entries.push({
        type: type,
        title: canonicalDisplayTitle(type, row),
        id: canonicalEntityId(type, row)
      });
    });
  });
  return entries.slice(0, 5);
}

function renderRelationshipClusterCard(cluster) {
  var card = document.createElement('div');
  card.className = 'group-card relationship-cluster-card';
  var terms = getSearchTerms(window.currentSearchQuery || '');
  var cardTypeClass = clusterCardTypeClass(cluster.cluster_type);
  var cardTypeLabel = clusterCardTypeLabel(cluster.cluster_type);
  var countsHtml = clusterCounts(cluster).map(function (entry) {
    return '<span class="cluster-chip cluster-chip-' + entry[0] + '">' + clusterTypeLabel(entry[0]) + ' ' + entry[1] + '</span>';
  }).join('');
  var previewHtml = clusterPreviewItems(cluster).map(function (item) {
    return '<div class="cluster-preview-row"><span>' + clusterTypeLabel(item.type) + '</span><strong>' + highlightTerms(item.title || item.id || '-', terms) + '</strong></div>';
  }).join('');

  card.innerHTML = `
    <div class="relationship-cluster-header">
      <div style="flex:1; min-width:0;">
        <span class="card-tag tag-cluster tag-cluster-${cardTypeClass}">${cardTypeLabel}</span>
        <div class="group-title cluster-title">${highlightTerms(cluster.title, terms)}</div>
        <div class="cluster-subtitle">${escapeHtml(cluster.subtitle || cluster.relation_paths.slice(0, 3).join(' / '))}</div>
      </div>
      <div class="toggle-icon">›</div>
    </div>
    <div class="cluster-chip-row">${countsHtml}</div>
    ${previewHtml ? '<div class="cluster-preview">' + previewHtml + '</div>' : ''}
  `;

  card.addEventListener('click', function () {
    openRelationshipClusterDetail(cluster);
  });
  resultsContainer.appendChild(card);
}

function clusterDetailSectionHtml(type, title, rows) {
  if (!rows || !rows.length) return '';
  var terms = getSearchTerms(window.currentSearchQuery || '');
  return `
    <div class="cluster-detail-section">
      <div class="section-title">${escapeHtml(title)} (${rows.length})</div>
      <div class="cluster-detail-list">
        ${rows.map(function (row, index) {
          var displayTitle = canonicalDisplayTitle(type, row) || canonicalEntityId(type, row);
          var subId = canonicalEntityId(type, row);
          return `
            <button type="button" class="cluster-detail-row" data-cluster-type="${type}" data-cluster-index="${index}">
              <span class="card-tag tag-${type}">${escapeHtml(clusterTypeLabel(type))}</span>
              <strong>${highlightTerms(displayTitle || '-', terms)}</strong>
              ${subId ? '<small>' + escapeHtml(subId) + '</small>' : ''}
            </button>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function openRelationshipClusterDetail(cluster) {
  var panel = document.getElementById('detailPanel');
  if (!panel) return;
  if (window.pushDetailPanelHistory) window.pushDetailPanelHistory();
  window.activeRelationshipCluster = cluster;
  var countsHtml = clusterCounts(cluster).map(function (entry) {
    return '<span class="cluster-chip cluster-chip-' + entry[0] + '">' + clusterTypeLabel(entry[0]) + ' ' + entry[1] + '</span>';
  }).join('');

  panel.innerHTML = `
    <div class="detail-header relationship-cluster-detail">
      <button type="button" class="back-to-results-btn" onclick="goBackDetailPanel()">\uC774\uC804\uC73C\uB85C</button>
      <p style="color:var(--accent); font-size:12px; font-weight:800; margin-bottom:8px; letter-spacing:1px;">RELATIONSHIP CLUSTER</p>
      <h2 style="font-size:24px; font-weight:800; line-height:1.3;">${escapeHtml(cluster.title)}</h2>
      <div class="cluster-chip-row">${countsHtml}</div>
      ${cluster.relation_paths.length ? '<div class="cluster-paths">' + escapeHtml(cluster.relation_paths.slice(0, 6).join(' / ')) + '</div>' : ''}
    </div>
    ${clusterDetailSectionHtml('asset', '\uC5F0\uACB0 \uC790\uC0B0', cluster.entities.assets)}
    ${clusterDetailSectionHtml('fund', '\uC5F0\uACB0 \uD380\uB4DC/\uBE44\uD788\uD074', cluster.entities.funds)}
    ${clusterDetailSectionHtml('project', '\uC5F0\uACB0 \uD504\uB85C\uC81D\uD2B8', cluster.entities.projects)}
    ${clusterDetailSectionHtml('lender', '\uC5F0\uACB0 \uB300\uC8FC', cluster.entities.lenders)}
    ${clusterDetailSectionHtml('ben', '\uC5F0\uACB0 \uC218\uC775\uC790', cluster.entities.beneficiaries)}
  `;

  panel.querySelectorAll('.cluster-detail-row').forEach(function (button) {
    button.addEventListener('click', function () {
      var type = button.dataset.clusterType;
      var index = Number(button.dataset.clusterIndex);
      var bucket = clusterBucketName(type);
      var row = cluster.entities[bucket] && cluster.entities[bucket][index];
      var title = canonicalDisplayTitle(type, row) || canonicalEntityId(type, row) || '';
      if (!row) return;
      if (type === 'asset' && window.AssetCanonical) {
        window.AssetCanonical.renderCanonicalAssetDetail(canonicalEntityId('asset', row), title, { inlineOnly: true });
      } else if (type === 'fund' && window.openFundRelationshipDrawer) {
        window.openFundRelationshipDrawer(canonicalEntityId('fund', row), title, { inline: true });
      } else if (type === 'project' && window.openProjectRelationshipDrawer) {
        window.openProjectRelationshipDrawer(canonicalEntityId('project', row), title, { inline: true, relatedAssetIds: relatedAssetIdsForProjectResult(row, title) });
      } else if ((type === 'lender' || type === 'ben') && window.openInstitutionRelationshipDrawer) {
        window.openInstitutionRelationshipDrawer(type, title, [row], { inline: true });
      } else {
        showDetail({ type: type, items: [row], targetName: title });
      }
    });
  });
}

function renderGroupCard(type, name, items) {
  var isSelected = portfolioBasket.some(function (i) { return i.key === type + '_' + name; });
  var displayItems = (type === 'project') ? dedupeResultItems(items) : items;
  var count = displayItems.length;
  var hasSubList = displayItems.length > 1;
  var card = document.createElement('div');
  card.className = 'group-card';
  if (isSelected) card.style.borderColor = 'var(--accent)';

  var item0 = items[0];
  var displayTitle = canonicalDisplayTitle(type, item0) || name;

  var subTitle = (type === 'asset' ? (item0.asset_code || item0.metadata?.pnu || item0.pnu) : canonicalEntityId(type, item0)) || '';

  card.innerHTML = `
    <div class="group-header">
      <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''}
        onclick="toggleBasket(event, '${type}', '${name}', ${JSON.stringify(items).replace(/"/g, '&quot;')})">
      <div style="flex:1">
        <span class="card-tag tag-${type}">${type.toUpperCase()}</span>
        <div class="group-title">${displayTitle}</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${count > 1 ? `<span style="font-size:11px; font-weight:700; color:var(--accent); background:rgba(79,70,229,0.05); padding:2px 6px; border-radius:4px;">${count}\uAC74 \uCC38\uC5EC</span>` : ''}
        <div class="toggle-icon">${hasSubList ? 'v' : '-'}</div>
      </div>
    </div>
    <div class="sub-list" style="display:none">
      ${displayItems.map(function (i) {
        const subName = canonicalDisplayTitle(type, i) || getResultItemDisplayName(i);
        const subId = canonicalEntityId(type, i) || getResultItemId(i);
        return `
    <div class="sub-item" data-id="${subId}">
          <span class="sub-item-name">${subName}</span>
          <span class="sub-item-id">${subId}</span>
        </div>`;
      }).join('')}
    </div>
  `;

  var header = card.querySelector('.group-header');
  header.addEventListener('click', function (e) {
    if (e.target.type === 'checkbox') return;
    if (hasSubList) {
      var sl = card.querySelector('.sub-list');
      sl.style.display = sl.style.display === 'none' ? 'block' : 'none';
    }
    if ((type === 'lender' || type === 'ben') && window.openInstitutionRelationshipDrawer) {
      window.openInstitutionRelationshipDrawer(type, name, items, { inline: true });
      return;
    }
    if (type === 'fund' && window.openFundRelationshipDrawer) {
      window.openFundRelationshipDrawer(item0.fund_id, displayTitle, { inline: true });
      return;
    }
    if (type === 'asset' && window.AssetCanonical) {
      window.AssetCanonical.renderCanonicalAssetDetail(canonicalEntityId('asset', item0), displayTitle, { inlineOnly: true });
      return;
    }
    if (type === 'project' && window.openProjectRelationshipDrawer) {
      window.openProjectRelationshipDrawer(item0.project_id || item0.fund_id, displayTitle, { inline: true, relatedAssetIds: relatedAssetIdsForProjectResult(item0, displayTitle) });
      return;
    }
    showDetail({ type: type, items: items, targetName: name });
  });

  var subItems = card.querySelectorAll('.sub-item');
  subItems.forEach(function (si, idx) {
    si.addEventListener('click', function (e) {
      e.stopPropagation();
      var item = displayItems[idx];
      var itemTitle = canonicalDisplayTitle(type, item) || getResultItemDisplayName(item) || canonicalEntityId(type, item) || '';
      if (type === 'fund' && window.openFundRelationshipDrawer) {
        window.openFundRelationshipDrawer(item.fund_id, itemTitle, { inline: true });
      } else if (type === 'asset' && window.AssetCanonical) {
        window.AssetCanonical.renderCanonicalAssetDetail(canonicalEntityId('asset', item), itemTitle, { inlineOnly: true });
      } else if (type === 'project' && window.openProjectRelationshipDrawer) {
        window.openProjectRelationshipDrawer(item.project_id || item.fund_id, itemTitle, { inline: true, relatedAssetIds: relatedAssetIdsForProjectResult(item, itemTitle) });
      } else {
        showDetail({ type: type, items: [item], targetName: itemTitle });
      }

      card.querySelectorAll('.sub-item').forEach(function (el) {
        el.style.background = '';
      });
      si.style.background = 'rgba(79, 70, 229, 0.1)';
    });
  });

  resultsContainer.appendChild(card);
}

function toggleBasket(event, type, name, items) {
  event.stopPropagation();
  var basketKey = type + '_' + name;
  var index = portfolioBasket.findIndex(function (i) { return i.key === basketKey; });
  if (index > -1) portfolioBasket.splice(index, 1);
  else portfolioBasket.push({ key: basketKey, name: name, type: type, items: items });
  window.portfolioBasket = portfolioBasket;
  renderBasket();
  if (currentView === 'ranking') renderAnalytics();

  // 같은 카테고리 2건 이상 선택 시 비교 차트 렌더링
  checkAndRenderComparison();
}

function renderBasket() {
  var basketEl = document.getElementById('portfolioBasket');
  var itemsEl = document.getElementById('basketItems');
  if (!basketEl || !itemsEl) return;
  if (portfolioBasket.length === 0) {
    basketEl.style.display = 'none';
    return;
  }
  basketEl.style.display = 'block';
  itemsEl.innerHTML = portfolioBasket.map(function (item) {
    var tagClass = 'tag-' + item.type;
    var typeLabel = { fund: '펀드', asset: '자산', lender: '대주', ben: '수익자', project: '프로젝트' }[item.type] || item.type;
    return '<div class="basket-chip"><span class="card-tag ' + tagClass + '" style="margin-bottom:0; font-size:9px; padding:1px 5px;">' + typeLabel + '</span> ' + item.name + '<span class="basket-remove" onclick="toggleBasket(event, \'' + item.type + '\', \'' + item.name + '\', [])">×</span></div>';
  }).join('');
}

function clearBasket() {
  portfolioBasket.length = 0;
  window.portfolioBasket = portfolioBasket;
  renderBasket();
  // 체크박스 해제
  document.querySelectorAll('.card-checkbox').forEach(function(cb) { cb.checked = false; });
  // 상세 패널 초기화
  var detailPanel = document.getElementById('detailPanel');
  if (detailPanel) {
    detailPanel.innerHTML = '<div class="detail-placeholder"><div class="placeholder-icon">📋</div><p>리스트에서 항목을 선택하면<br>상세 정보가 여기에 표시됩니다.</p></div>';
  }
}

function checkAndRenderComparison() {
  // 같은 카테고리(type)로 2건 이상 선택된 것만 필터
  var typeGroups = {};
  portfolioBasket.forEach(function(item) {
    if (!typeGroups[item.type]) typeGroups[item.type] = [];
    typeGroups[item.type].push(item);
  });

  // 가장 많이 선택된 같은 카테고리 그룹 찾기
  var bestGroup = null;
  Object.keys(typeGroups).forEach(function(t) {
    if (typeGroups[t].length >= 2) {
      if (!bestGroup || typeGroups[t].length > bestGroup.length) {
        bestGroup = typeGroups[t];
      }
    }
  });

  if (bestGroup) {
    var groupType = bestGroup[0].type;
    if (groupType === 'lender' || groupType === 'ben') {
      renderComparisonChart(bestGroup);
    } else {
      var detailPanel = document.getElementById('detailPanel');
      if (detailPanel) {
        var typeLabel = { fund: '펀드', asset: '자산', project: '프로젝트' }[groupType] || groupType;
        detailPanel.innerHTML = '<div class="detail-placeholder" style="text-align:center; padding:80px 40px;"><div style="font-size:48px; margin-bottom:20px;">🚧</div><h3 style="font-size:18px; font-weight:800; color:var(--text); margin-bottom:8px;">' + typeLabel + ' 비교 분석</h3><p style="color:var(--muted); font-size:14px; line-height:1.6;">해당 기능은 현재 개발 중입니다.<br>대주 또는 수익자 비교 분석을 먼저 이용해 주세요.</p></div>';
      }
    }
  }
}

function renderComparisonChart(selectedItems) {
  var detailPanel = document.getElementById('detailPanel');
  if (!detailPanel) return;

  var type = selectedItems[0].type;
  var isLender = (type === 'lender');
  var amountKey = isLender ? 'committed_amt' : 'invested_amt';
  var label = isLender ? '대주' : '수익자';
  var chartId = 'compare-chart-' + Math.random().toString(36).substr(2, 9);

  // 전체 연도 범위 계산
  var allYears = {};
  var minYear = 9999;
  var maxYear = 0;
  var currentYear = new Date().getFullYear();

  // 기관별 연도별 데이터 계산
  var seriesData = selectedItems.map(function(sel) {
    var yearData = {};
    sel.items.forEach(function(item) {
      var fund = item.funds || (window.allFunds || []).find(function(f) { return f.fund_id === item.fund_id; });
      var date;
      if (isLender) {
        date = item.drawdown_date || item.start_date || (fund ? fund.setup_date : null);
      } else {
        date = item.start_date || item.invested_date || (fund ? fund.setup_date : null);
      }
      if (date) {
        var year = new Date(date).getFullYear();
        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;
        yearData[year] = (yearData[year] || 0) + (item[amountKey] || 0);
      }
    });
    return { name: sel.name, yearData: yearData };
  });

  if (maxYear < currentYear) maxYear = currentYear;

  var years = [];
  for (var y = minYear; y <= maxYear; y++) years.push(y);

  // 시리즈 생성 (누적 막대)
  var series = seriesData.map(function(sd) {
    return {
      name: sd.name,
      data: years.map(function(y) { return Math.floor((sd.yearData[y] || 0) / 100000000); })
    };
  });

  // 총합 계산
  var totals = selectedItems.map(function(sel) {
    var total = sel.items.reduce(function(acc, item) { return acc + (item[amountKey] || 0); }, 0);
    return { name: sel.name, total: total };
  });

  // 색상 팔레트
  var colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

  detailPanel.innerHTML =
    '<div class="detail-header">' +
      '<span class="card-tag tag-' + type + '">' + label.toUpperCase() + ' COMPARISON</span>' +
      '<h2 style="margin-bottom:4px;">' + selectedItems.map(function(s){return s.name}).join(' vs ') + '</h2>' +
      '<div style="color:var(--muted); font-size:14px; margin-top:8px; display:flex; gap:16px; flex-wrap:wrap;">' +
        totals.map(function(t, i) {
          return '<span style="display:flex; align-items:center; gap:6px;">' +
            '<span style="width:10px;height:10px;border-radius:3px;background:' + colors[i % colors.length] + '"></span>' +
            '<strong>' + t.name + '</strong> ' + (Math.floor(t.total / 100000000)).toLocaleString() + '억' +
          '</span>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<div class="section-title">연도별 약정액 비교 (Stacked Comparison)</div>' +
      '<div id="' + chartId + '" style="min-height:400px;"></div>' +
    '</div>';

  setTimeout(function() {
    if (typeof ApexCharts === 'undefined') return;
    var options = {
      series: series,
      chart: { type: 'bar', height: 400, stacked: true, toolbar: { show: false }, fontFamily: 'Pretendard Variable' },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 4 } },
      colors: colors.slice(0, series.length),
      xaxis: { categories: years },
      yaxis: [{
        labels: { formatter: function(val) { return val.toLocaleString(); } },
        title: { text: '단위: 억원' }
      }],
      dataLabels: {
        enabled: true,
        formatter: function(val) { return val ? val.toLocaleString() : ''; },
        style: { fontSize: '11px', fontWeight: 700 }
      },
      tooltip: {
        shared: true,
        intersect: false,
        inverseOrder: true,
        y: { formatter: function(val) { return val.toLocaleString() + ' 억'; } }
      },
      legend: { position: 'bottom', fontSize: '13px', fontWeight: 600, inverseOrder: true }
    };
    var chart = new ApexCharts(document.getElementById(chartId), options);
    chart.render();
  }, 100);
}

window.ensureFundSearchColumns = ensureFundSearchColumns;
window.performSearch = performSearch;
window.updateTabCounts = updateTabCounts;
window.renderResults = renderResults;
window.buildRelationshipClusters = buildRelationshipClusters;
window.renderRelationshipClusterCard = renderRelationshipClusterCard;
window.openRelationshipClusterDetail = openRelationshipClusterDetail;
window.groupEntities = groupEntities;
window.canonicalEntityId = canonicalEntityId;
window.canonicalDisplayTitle = canonicalDisplayTitle;
window.dedupeEntities = dedupeEntities;
window.renderGroupCard = renderGroupCard;
window.toggleBasket = toggleBasket;
window.renderBasket = renderBasket;
window.clearBasket = clearBasket;
window.renderComparisonChart = renderComparisonChart;
