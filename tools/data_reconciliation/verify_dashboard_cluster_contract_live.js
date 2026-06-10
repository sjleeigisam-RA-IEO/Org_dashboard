const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const configPath = path.join(root, 'CRM_base', 'portfolio-analysis', 'config.js');
const searchPath = path.join(root, 'CRM_base', 'portfolio-analysis', 'js', 'search-results.js');

const DEFAULT_QUERIES = [
  '분당',
  '홈플러스',
  'IDC',
  '물류',
  '롯데',
  '눈스퀘어',
  '이오타서울',
  '국민연금',
  'KB',
  '1120'
];

const SEARCH_V2_TABS = [
  ['all', '전체'],
  ['target', '투자대상'],
  ['beneficiary', '수익자'],
  ['lender', '대주']
];

function readConfig() {
  const config = fs.readFileSync(configPath, 'utf8');
  const url = config.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
  const key = config.match(/SUPABASE_KEY\s*=\s*"([^"]+)"/)?.[1];
  if (!url || !key) throw new Error('Could not read Supabase config.');
  return { url, key };
}

function encodeParams(params) {
  return new URLSearchParams(params)
    .toString()
    .replace(/%2A/g, '*')
    .replace(/%2C/g, ',')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%3A/g, ':');
}

async function rest(table, params) {
  const { url, key } = readConfig();
  const response = await fetch(`${url}/rest/v1/${table}?${encodeParams(params)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(String)));
}

function numericIds(values) {
  return unique(values).filter((value) => /^\d+$/.test(value));
}

function getSearchTerms(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function isShortNumericSearch(query) {
  return /^\d{1,4}$/.test(String(query || '').trim());
}

function buildUniversalFilter(columns, terms) {
  return columns.flatMap((column) => terms.map((term) => `${column}.ilike.%${term}%`)).join(',');
}

function searchTermsMatchText(terms, value) {
  const text = String(value || '').toLowerCase();
  return terms.every((term) => text.includes(term));
}

function indexRowsForType(rows, type) {
  return (rows || []).filter((row) => row.entity_type === type);
}

function indexDisplayTermsForType(rows, type, terms) {
  return unique(indexRowsForType(rows, type).map((row) => row.display_title || row.token_text || ''))
    .filter((value) => value && !/^\d+$/.test(value) && searchTermsMatchText(terms, value));
}

async function readSearchIndexRows(query, terms) {
  const surfaces = [
    ['portfolio_search_results_unified_v1', 'rank_score'],
    ['portfolio_search_results_canonical', 'rank_weight'],
    ['portfolio_search_index', 'rank_weight']
  ];
  let lastError = null;
  for (const [surface, orderColumn] of surfaces) {
    const indexParams = {
      select: '*',
      or: `(${terms.map((term) => `token_text.ilike.%${term}%`).join(',')})`,
      order: `${orderColumn}.desc`,
      limit: isShortNumericSearch(query) ? '200' : '300'
    };
    if (isShortNumericSearch(query)) {
      indexParams.entity_type = 'in.(fund,project)';
    }
    try {
      const rows = await rest(surface, indexParams);
      rows._surface = surface;
      return rows;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Could not read any search surface.');
}

function buildVmContext() {
  const source = fs.readFileSync(searchPath, 'utf8');
  const context = {
    console,
    window: {},
    document: { querySelectorAll: () => [], getElementById: () => null },
    _supabase: {},
    resultsContainer: { innerHTML: '', appendChild: () => {} },
    tabBtns: [],
    currentTab: 'all',
    currentView: 'search',
    allResults: {},
    getSearchTerms,
    isShortNumericSearch,
    buildUniversalFilter
  };
  context.window.ALIASES = {};
  context.window.AssetCanonical = null;
  context.window.formatNumber = (value) => String(value);
  vm.createContext(context);
  vm.runInContext(source, context, { filename: searchPath });
  return context;
}

async function hydrateForQuery(context, query) {
  const terms = getSearchTerms(query);
  const indexRows = await readSearchIndexRows(query, terms);
  const relatedRows = indexRows.filter((row) => {
    if (row.entity_type !== 'lender' && row.entity_type !== 'beneficiary') return true;
    const title = String(row.display_title || '').toLowerCase();
    return terms.some((term) => title.includes(term));
  });

  const fundIds = unique(
    indexRows.filter((row) => row.entity_type === 'fund').map((row) => row.entity_id)
      .concat(relatedRows.map((row) => row.related_fund_id))
  );
  const assetIds = isShortNumericSearch(query)
    ? []
    : unique(indexRows.filter((row) => row.entity_type === 'asset').map((row) => row.entity_id)
      .concat(relatedRows.map((row) => row.related_asset_id)));
  const projectIds = unique(
    indexRows.filter((row) => row.entity_type === 'project').map((row) => row.entity_id)
      .concat(relatedRows.map((row) => row.related_project_id))
  );
  const lenderIds = numericIds(indexRowsForType(indexRows, 'lender').map((row) => row.entity_id));
  const beneficiaryIds = numericIds(indexRowsForType(indexRows, 'beneficiary').map((row) => row.entity_id));
  const lenderDisplayTerms = indexDisplayTermsForType(indexRows, 'lender', terms);
  const beneficiaryDisplayTerms = indexDisplayTermsForType(indexRows, 'beneficiary', terms);
  const lenderFallbacks = indexRowsForType(indexRows, 'lender').map((row) => ({
    id: row.entity_id,
    entity_id: row.entity_id,
    lender_clean: row.display_title,
    lender_raw: row.display_title,
    fund_id: row.related_fund_id,
    asset_id: row.related_asset_id,
    _search_index_only: true
  }));
  const beneficiaryFallbacks = indexRowsForType(indexRows, 'beneficiary').map((row) => ({
    id: row.entity_id,
    entity_id: row.entity_id,
    beneficiary_clean: row.display_title,
    beneficiary_raw: row.display_title,
    fund_id: row.related_fund_id,
    asset_id: row.related_asset_id,
    _search_index_only: true
  }));

  const inFilter = (ids) => `in.(${ids.join(',')})`;
  const [funds, assetSummary, assetMaster, projects, lendersById, beneficiariesById, lendersByName, beneficiariesByName] = await Promise.all([
    fundIds.length ? rest('v_funds_enriched', { select: '*', fund_id: inFilter(fundIds), limit: '500' }) : [],
    assetIds.length ? rest('asset_relationship_summary', { select: '*', asset_id: inFilter(assetIds), limit: '500' }) : [],
    assetIds.length ? rest('asset_master', { select: '*', asset_id: inFilter(assetIds), limit: '500' }) : [],
    projectIds.length ? rest('projects', { select: '*', project_id: inFilter(projectIds), limit: '500' }) : [],
    lenderIds.length ? rest('lender_exposures', { select: '*,funds(*)', id: inFilter(lenderIds), limit: '500' }) : [],
    beneficiaryIds.length ? rest('beneficiary_exposures', { select: '*,funds(*)', id: inFilter(beneficiaryIds), limit: '500' }) : [],
    lenderDisplayTerms.length ? rest('lender_exposures', { select: '*,funds(*)', or: `(${buildUniversalFilter(['lender_clean', 'lender_raw'], lenderDisplayTerms)})`, limit: '500' }) : [],
    beneficiaryDisplayTerms.length ? rest('beneficiary_exposures', { select: '*,funds(*)', or: `(${buildUniversalFilter(['beneficiary_clean', 'beneficiary_raw'], beneficiaryDisplayTerms)})`, limit: '500' }) : []
  ]);

  context.window.currentSearchQuery = query;
  context.window.searchContractMode = indexRows._surface === 'portfolio_search_results_unified_v1' ? 'unified' : 'canonical_fallback';
  context.allResults = {
    lenders: context.dedupeEntities(lendersById.concat(lendersByName, lenderFallbacks), 'lender'),
    beneficiaries: context.dedupeEntities(beneficiariesById.concat(beneficiariesByName, beneficiaryFallbacks), 'ben'),
    funds: context.dedupeEntities(funds, 'fund'),
    assets: [],
    projects: context.dedupeEntities(projects, 'project'),
    assetGroups: context.mergeAssetDisplayRows(
      context.dedupeEntities(context.mergeRowsByKey(assetSummary, assetMaster, 'asset_id'), 'asset')
    ),
    _indexRows: indexRows,
    _unifiedRows: indexRows
  };
  const rows = context.relationshipEntityRows();
  const clusters = context.buildRelationshipClusters(query);
  const unifiedResults = context.buildUnifiedSearchResults(query);
  return { indexRows, rows, clusters, unifiedResults };
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()［］\[\]{}·ㆍ\-_]/g, '');
}

function searchV2TabCounts(results) {
  const rows = results || [];
  return {
    all: rows.length,
    target: rows.filter((result) => (result.facets || []).includes('target')).length,
    beneficiary: rows.filter((result) => (result.facets || []).includes('beneficiary')).length,
    lender: rows.filter((result) => (result.facets || []).includes('lender')).length
  };
}

function searchV2TabLabels() {
  return SEARCH_V2_TABS.reduce((labels, [key, label]) => {
    labels[key] = label;
    return labels;
  }, {});
}

function analyzeQuery(context, query, result) {
  const titleCounts = {};
  result.unifiedResults.forEach((resultRow) => {
    const key = normalizeKey(resultRow.title);
    titleCounts[key] = (titleCounts[key] || 0) + 1;
  });
  const duplicateTitles = Object.values(titleCounts).filter((count) => count > 1).length;
  const topicClusters = result.clusters.filter((cluster) => cluster.cluster_type === 'topic');
  const nonMatchingAssetRoots = result.unifiedResults.filter((resultRow) => {
    if (resultRow.rootType !== 'asset') return false;
    return !getSearchTerms(query).some((term) => String(resultRow.title || '').toLowerCase().includes(term));
  });
  const genericOneBucket = topicClusters.length > 0;
  const hasUnexpectedNumericNoise = isShortNumericSearch(query)
    && result.unifiedResults.some((resultRow) => resultRow.rootType !== 'fund' && resultRow.rootType !== 'project');
  const titles = result.unifiedResults.map((resultRow) => resultRow.title);
  const tabCounts = searchV2TabCounts(result.unifiedResults);
  const tabLabels = searchV2TabLabels();
  const scenarioStatus = {};
  if (query === '분당') {
    const expected = ['롯데백화점분당점', '분당야탑물류센터', '분당Hostway IDC'];
    scenarioStatus.bundangHasThreeAssetRoots = result.unifiedResults.length === 3
      && result.unifiedResults.every((resultRow) => resultRow.rootType === 'asset')
      && expected.every((title) => titles.includes(title))
      && !titles.some((title) => title.includes('북미DC포트폴리오'));
    scenarioStatus.bundangSearchV2AllAndTargetCountThree = tabCounts.all === 3
      && tabCounts.target === 3
      && tabCounts.beneficiary === 0
      && tabCounts.lender === 0;
  }
  if (query === '홈플러스') {
    scenarioStatus.homeplusUsesAssetRoots = result.unifiedResults.length >= 5
      && result.unifiedResults.every((resultRow) => resultRow.rootType === 'asset');
  }
  if (query === '국민연금') {
    scenarioStatus.npsAppearsInBeneficiaryNotLender = tabCounts.beneficiary > 0
      && tabCounts.lender === 0
      && result.unifiedResults.every((resultRow) => resultRow.rootSubtype !== 'lender' && !(resultRow.facets || []).includes('lender'));
  }
  if (query.toLowerCase() === 'kb') {
    scenarioStatus.kbHasLenderResults = tabCounts.lender > 0
      && result.unifiedResults.some((resultRow) => resultRow.relationshipCounts.lender > 0 || (resultRow.facets || []).includes('lender'));
  }
  if (query === '이오타서울') {
    scenarioStatus.iotaUsesProjectRoot = result.unifiedResults.length === 1
      && result.unifiedResults[0].rootType === 'project'
      && result.unifiedResults[0].relationshipCounts.asset >= 2
      && result.unifiedResults[0].relationshipCounts.fund >= 8;
  }
  if (query === '1120') {
    scenarioStatus.shortNumeric1120UsesFundProjectTargetResults = result.unifiedResults.length > 0
      && tabCounts.all === result.unifiedResults.length
      && tabCounts.target === result.unifiedResults.length
      && tabCounts.beneficiary === 0
      && tabCounts.lender === 0
      && result.unifiedResults.every((resultRow) => ['fund', 'project'].includes(resultRow.rootType));
  }

  return {
    query,
    indexRows: result.indexRows.length,
    displayAssets: result.rows.assets.map((row) => context.canonicalDisplayTitle('asset', row)),
    clusterCount: result.clusters.length,
    unifiedResultCount: result.unifiedResults.length,
    searchV2Tabs: {
      labels: tabLabels,
      counts: tabCounts
    },
    unifiedResults: result.unifiedResults.map((resultRow) => ({
      type: resultRow.rootType,
      subtype: resultRow.rootSubtype,
      title: resultRow.title,
      facets: resultRow.facets,
      assetCount: resultRow.relationshipCounts.asset,
      fundCount: resultRow.relationshipCounts.fund,
      projectCount: resultRow.relationshipCounts.project,
      lenderCount: resultRow.relationshipCounts.lender,
      beneficiaryCount: resultRow.relationshipCounts.beneficiary
    })),
    clusters: result.clusters.map((cluster) => ({
      type: cluster.cluster_type,
      title: cluster.title,
      assetCount: cluster.entities.assets.length,
      fundCount: cluster.entities.funds.length,
      projectCount: cluster.entities.projects.length,
      lenderCount: cluster.entities.lenders.length,
      beneficiaryCount: cluster.entities.beneficiaries.length
    })),
    status: {
      noTopicCluster: topicClusters.length === 0,
      noDuplicateUnifiedTitles: duplicateTitles === 0,
      noGenericOneBucketForMultipleAssets: !genericOneBucket,
      assetRootsMatchQuery: nonMatchingAssetRoots.length === 0,
      shortNumericHasNoAssetOrPartyNoise: !hasUnexpectedNumericNoise,
      searchV2TabLabels: SEARCH_V2_TABS.every(([key, label]) => tabLabels[key] === label),
      ...scenarioStatus
    }
  };
}

async function main() {
  const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_QUERIES;
  const context = buildVmContext();
  const results = [];
  for (const query of queries) {
    const hydrated = await hydrateForQuery(context, query);
    results.push(analyzeQuery(context, query, hydrated));
  }
  const failed = results.filter((result) => Object.values(result.status).some((ok) => !ok));
  console.log(JSON.stringify({ ok: failed.length === 0, failedQueries: failed.map((result) => result.query), results }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
