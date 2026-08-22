const fs = require('fs');
const path = require('path');
const vm = require('vm');

const portalRoot = path.resolve(__dirname, '..', '..');
const searchPath = path.join(portalRoot, 'portfolio-analysis', 'js', 'search-results.js');
const assetCanonicalPath = path.join(portalRoot, 'portfolio-analysis', 'js', 'asset-canonical.js');
const source = fs.readFileSync(searchPath, 'utf8');
const assetCanonicalSource = fs.readFileSync(assetCanonicalPath, 'utf8');

const context = {
  console,
  window: {},
  document: {
    querySelectorAll: () => [],
    getElementById: () => null
  },
  _supabase: {},
  resultsContainer: { innerHTML: '', appendChild: () => {} },
  tabBtns: [],
  currentTab: 'all',
  currentView: 'search',
  allResults: { lenders: [], beneficiaries: [], funds: [], assets: [], projects: [], assetGroups: [] },
  getSearchTerms: (query) => String(query || '').toLowerCase().split(/\s+/).filter(Boolean),
  isShortNumericSearch: (query) => /^\d{1,4}$/.test(String(query || '').trim()),
  buildUniversalFilter: (columns, terms) => columns.map((column) => terms.map((term) => column + '.ilike.%' + term + '%').join(',')).join(',')
};
context.window.ALIASES = {};
context.window.AssetCanonical = null;
context.window.formatNumber = (value) => String(value);

vm.createContext(context);
vm.runInContext(source, context, { filename: searchPath });

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  source.indexOf("performIndexedSearchOn('portfolio_search_results_unified_v1'") !== -1,
  'indexed search must query the unified one-row-per-result surface first'
);
assert(
  source.indexOf("performIndexedSearchOn('portfolio_search_results_canonical'") !== -1,
  'indexed search must keep canonical fallback'
);
assert(
  /card\.addEventListener\('click'[\s\S]*openUnifiedResultFinalDetail\(result\)/.test(source),
  'unified result card click must route to the final detail destination helper'
);
assert(
  /openUnifiedResultFinalDetail[\s\S]*AssetCanonical\.renderCanonicalAssetDetail/.test(source),
  'asset-root unified results must open canonical asset detail, not the relationship summary page'
);
assert(
  source.includes('renderSearchRefinementControls') &&
    source.includes('search-refinement-chip') &&
    source.includes('직접 일치만') &&
    source.includes('검색어 해석'),
  'search results must expose visible refinement controls for correcting search intent'
);
assert(
  source.includes('unifiedMatchReasonHtml') &&
    source.includes('unifiedConfidenceBadgeHtml') &&
    source.includes('일치 기준'),
  'unified result cards must explain why a result matched'
);
assert(
  source.includes('resetSearchScopeRefinement') &&
    source.includes('window.resetSearchScopeRefinement'),
  'top-level tab changes must be able to reset sub-scope refinements'
);
assert(
  assetCanonicalSource.includes('fetchPeerAssetsByFundIds') &&
    assetCanonicalSource.includes('asset-relation-navigation') &&
    assetCanonicalSource.includes('bindAssetRelationNavigation(detailPanel)'),
  'canonical asset detail must expose clickable related vehicles/assets inside the final asset page'
);

function keys(object) {
  return Object.keys(object).sort();
}

const SEARCH_V2_TABS = [
  ['all', '전체'],
  ['target', '투자대상'],
  ['beneficiary', '수익자'],
  ['lender', '대주']
];

function searchV2TabCounts(results) {
  const rows = results || [];
  return {
    all: rows.length,
    target: rows.filter((result) => (result.facets || []).includes('target')).length,
    beneficiary: rows.filter((result) => (result.facets || []).includes('beneficiary')).length,
    lender: rows.filter((result) => (result.facets || []).includes('lender')).length
  };
}

const fundRows = context.dedupeEntities([
  { fund_id: '112614', fund_name: '이지스일반사모부동산투자신탁421호(운용)', short_name: '421호' },
  { fund_id: '112614', fund_name: '421호 운용', short_name: '421호', project_mission_name: '와이디427' },
  { fund_id: '112706', fund_name: '이지스일반사모부동산투자신탁421호(A종)', short_name: '421호(A종)' }
], 'fund');
assert(fundRows.length === 2, 'fund dedupe must converge same fund_id to one row');

const groupedFunds = context.groupEntities(fundRows, 'fund');
assert(keys(groupedFunds).join(',') === '112614,112706', 'fund grouping must use fund_id');
const operatingFund = fundRows.find((row) => row.fund_id === '112614');
assert(context.canonicalDisplayTitle('fund', operatingFund).startsWith('[421호]'), 'fund display title must be canonicalized');

const assetRows = context.dedupeEntities([
  { asset_id: 'ast_cd9937cc8678', canonical_name: '와이디427피에프브이 주식회사' },
  { asset_id: 'ast_cd9937cc8678', canonical_name: 'YD427 PFV', asset_code: 'A112614001' },
  { asset_id: 'ast_aefd81e93778', canonical_name: 'Colony Distressed Credit Fund IV' }
], 'asset');
assert(assetRows.length === 2, 'asset dedupe must converge same asset_id to one row');
assert(keys(context.groupEntities(assetRows, 'asset')).length === 2, 'asset grouping must keep distinct display assets');

const mergedDisplayAssets = context.mergeAssetDisplayRows([
  { asset_id: 'ast_1', canonical_name: '롯데백화점분당점', address_text: '경기도 성남시 분당구 수내동 14' },
  { asset_id: 'ast_2', canonical_name: '롯데백화점분당점', address_text: '경기도 성남시 분당구 수내동 14', fund_count: 4, project_count: 5 },
  { asset_id: 'ast_3', canonical_name: '분당Hostway IDC', address_text: '분당구 장미로 36' },
  { asset_id: 'ast_4', canonical_name: '홈플러스죽도점' },
  { asset_id: 'ast_5', canonical_name: '홈플러스죽도점 (투자)', fund_count: 5, project_count: 2 }
]);
assert(mergedDisplayAssets.length === 3, 'same display asset should collapse to one displayed asset group');
const lotteAsset = mergedDisplayAssets.find((row) => row.canonical_name === '롯데백화점분당점');
assert(lotteAsset && lotteAsset._merged_asset_ids.length === 2, 'display asset group must retain merged asset ids for relationship lookup');
const homeplusAsset = mergedDisplayAssets.find((row) => context.canonicalDisplayTitle('asset', row) === '홈플러스죽도점');
assert(homeplusAsset && homeplusAsset._merged_asset_ids.length === 2, 'investment suffix variants must collapse into one displayed asset group');

const projectRows = context.dedupeEntities([
  { project_id: 'iota-seoul', project_name: '이오타서울 (IOTA Seoul)' },
  { project_id: 'iota-seoul', project_name: 'IOTA Seoul', status: 'active' },
  { project_id: 'iota-427', project_name: '와이디427' }
], 'project');
assert(projectRows.length === 2, 'project dedupe must converge same project_id to one row');
assert(keys(context.groupEntities(projectRows, 'project')).join(',') === 'iota-427,iota-seoul', 'project grouping must use project_id');

const lenderRows = context.dedupeEntities([
  { id: 1, fund_id: '112005', lender_clean: 'DBS Bank' },
  { id: 2, fund_id: '112006', lender_clean: 'DBS Bank' },
  { id: 2, fund_id: '112006', lender_clean: 'DBS Bank' }
], 'lender');
assert(lenderRows.length === 2, 'lender dedupe must keep distinct exposure rows and remove duplicate ids');
const groupedLenders = context.groupEntities(lenderRows, 'lender');
assert(keys(groupedLenders).length === 1, 'lender grouping must show one institution card');
assert(groupedLenders[Object.keys(groupedLenders)[0]].length === 2, 'lender card must retain relationship rows');

const benRows = context.dedupeEntities([
  { id: 10, fund_id: '112006', beneficiary_clean: '국민연금공단' },
  { id: 11, fund_id: '112008', beneficiary_clean: '국민연금공단' }
], 'ben');
assert(keys(context.groupEntities(benRows, 'ben')).length === 1, 'beneficiary grouping must show one institution card');

context.window.currentSearchQuery = '분당';
context.allResults = {
  funds: [
    { fund_id: '112490', fund_name: '이지스전문투자형사모부동산투자신탁제389호', short_name: '389호' },
    { fund_id: '190002', fund_name: '이지스부동산일반사모투자회사제543호', short_name: '543호' },
    { fund_id: '112777', fund_name: '북미DC 포트폴리오 펀드', short_name: '북미DC' }
  ],
  assetGroups: context.mergeAssetDisplayRows([
    { asset_id: 'ast_lotte_1', canonical_name: '롯데백화점분당점', address_text: '경기도 성남시 분당구 수내동 14' },
    { asset_id: 'ast_lotte_2', canonical_name: '롯데백화점분당점', address_text: '경기도 성남시 분당구 수내동 14', fund_count: 4, project_count: 5 },
    { asset_id: 'ast_yatap_1', canonical_name: '분당야탑물류센터' },
    { asset_id: 'ast_yatap_2', canonical_name: '분당야탑물류센터', address_text: '경기도 성남시 분당구 야탑동 403', fund_count: 3, project_count: 2 },
    { asset_id: 'ast_hostway_1', canonical_name: '분당Hostway IDC', address_text: '분당구 장미로 36' },
    { asset_id: 'ast_hostway_2', canonical_name: '분당Hostway IDC', address_text: '분당구 장미로 36' },
    { asset_id: 'ast_north_dc', canonical_name: '북미DC포트폴리오', address_text: '분당구 장미로 36', fund_count: 1 }
  ]),
  projects: [
    { project_id: 'prj_lotte', project_name: '롯데백화점 분당점 리모델링', primary_asset_id: 'ast_lotte_2' },
    { project_id: 'prj_yatap', project_name: '분당 야탑 물류', primary_asset_id: 'ast_yatap_2' }
  ],
  lenders: [],
  beneficiaries: [],
  assets: [],
  _indexRows: [
    { entity_type: 'asset', entity_id: 'ast_lotte_1', related_asset_id: 'ast_lotte_1' },
    { entity_type: 'asset', entity_id: 'ast_lotte_2', related_asset_id: 'ast_lotte_2', related_fund_id: '112490', related_project_id: 'prj_lotte' },
    { entity_type: 'asset', entity_id: 'ast_yatap_1', related_asset_id: 'ast_yatap_1' },
    { entity_type: 'asset', entity_id: 'ast_yatap_2', related_asset_id: 'ast_yatap_2', related_fund_id: '190002', related_project_id: 'prj_yatap' },
    { entity_type: 'asset', entity_id: 'ast_hostway_1', related_asset_id: 'ast_hostway_1', related_fund_id: '112777' },
    { entity_type: 'asset', entity_id: 'ast_north_dc', related_asset_id: 'ast_north_dc', related_fund_id: '112777' }
  ]
};
const bundangClusters = context.buildRelationshipClusters('분당');
assert(bundangClusters.length === 3, 'broad region searches must return one cluster per display asset, not one topic bucket');
assert(bundangClusters.every((cluster) => cluster.cluster_type !== 'topic'), 'broad topic cluster must not be used for region-like asset searches');
const bundangTitles = bundangClusters.map((cluster) => cluster.title).sort();
assert(bundangTitles.join('|') === '롯데백화점분당점|분당Hostway IDC|분당야탑물류센터', 'Bundang clusters must converge to the expected display assets');
assert(!bundangTitles.some((title) => title.includes('북미DC포트폴리오')), 'non-matching portfolio asset must not become a displayed root result');
const hostwayCluster = bundangClusters.find((cluster) => cluster.title === '분당Hostway IDC');
assert(hostwayCluster && hostwayCluster.entities.funds.some((fund) => fund.fund_id === '112777'), 'same-location portfolio asset relationships should be absorbed into the displayed physical asset cluster');
const summaryText = context.buildSearchSummaryText('분당', bundangClusters, context.allResults);
assert(summaryText.includes('자산 3개') && summaryText.includes('3개 묶음'), 'search summary must explain entity totals and cluster grouping separately');
const unifiedBundang = context.buildUnifiedSearchResults('분당');
assert(unifiedBundang.length === 3, 'Unified Bundang search must render three result cards');
assert(unifiedBundang.every((result) => result.rootType === 'asset'), 'Bundang unified roots must be assets');
assert(unifiedBundang.every((result) => result.facets.includes('target')), 'Bundang unified cards must appear under the search v2 target facet');
assert(unifiedBundang.some((result) => result.relationshipCounts.fund > 0), 'Bundang target cards with fund relations must retain relationship counts');
assert(!unifiedBundang.some((result) => result.title.includes('북미DC포트폴리오')), 'Unified results must not expose absorbed same-location portfolio assets as root cards');
const bundangV2Counts = searchV2TabCounts(unifiedBundang);
assert(bundangV2Counts.all === 3 && bundangV2Counts.target === 3, 'Bundang search v2 all/target tabs must count three asset-centered result cards');
assert(bundangV2Counts.beneficiary === 0 && bundangV2Counts.lender === 0, 'Bundang search v2 institution tabs must not count target cards');
const bundangAllResults = context.allResults;

context.window.currentSearchQuery = '국민연금';
context.allResults = {
  funds: [
    { fund_id: '112006', fund_name: '국민연금 수익자 연결 펀드', short_name: 'NPS Fund' }
  ],
  assetGroups: [],
  projects: [],
  lenders: [],
  beneficiaries: [
    { id: 10, fund_id: '112006', beneficiary_clean: '국민연금공단' },
    { id: 11, fund_id: '112008', beneficiary_clean: '국민연금공단' }
  ],
  assets: [],
  _indexRows: [
    { entity_type: 'beneficiary', entity_id: '10', display_title: '국민연금공단', related_fund_id: '112006' },
    { entity_type: 'beneficiary', entity_id: '11', display_title: '국민연금공단', related_fund_id: '112008' }
  ]
};
const npsUnified = context.buildUnifiedSearchResults('국민연금');
const npsV2Counts = searchV2TabCounts(npsUnified);
assert(npsV2Counts.beneficiary > 0, '국민연금 must appear in the search v2 beneficiary tab');
assert(npsV2Counts.lender === 0 && !npsUnified.some((result) => (result.facets || []).includes('lender')), '국민연금 must not appear in the search v2 lender tab');

context.window.currentSearchQuery = 'KB';
context.allResults = {
  funds: [
    { fund_id: '112005', fund_name: 'KB 대주 연결 펀드', short_name: 'KB Fund' }
  ],
  assetGroups: [],
  projects: [],
  lenders: [
    { id: 20, fund_id: '112005', lender_clean: 'KB국민은행' }
  ],
  beneficiaries: [],
  assets: [],
  _indexRows: [
    { entity_type: 'lender', entity_id: '20', display_title: 'KB국민은행', related_fund_id: '112005' }
  ]
};
const kbUnified = context.buildUnifiedSearchResults('KB');
const kbV2Counts = searchV2TabCounts(kbUnified);
assert(kbV2Counts.lender > 0, 'KB lender probe must produce search v2 lender-tab results');

context.tabBtns.length = 0;
context.window.currentSearchQuery = '분당';
context.allResults = bundangAllResults;
SEARCH_V2_TABS.forEach(([tab, label]) => {
  context.tabBtns.push({ dataset: { tab }, textContent: label, innerHTML: '' });
});
context.updateTabCounts();
function tabCount(tab) {
  const button = context.tabBtns.find((btn) => btn.dataset.tab === tab);
  const match = String(button && button.innerHTML || '').match(/tab-count">(\d+)</);
  return match ? Number(match[1]) : NaN;
}
function tabLabel(tab) {
  const button = context.tabBtns.find((btn) => btn.dataset.tab === tab);
  const match = String(button && button.innerHTML || '').match(/<span>(.*?)<\/span>/);
  return match ? match[1] : '';
}
SEARCH_V2_TABS.forEach(([tab, label]) => {
  assert(tabLabel(tab) === label, `Search v2 ${tab} tab label must be ${label}`);
});
assert(tabCount('all') === 3, 'All tab count must use displayed unified result cards');
assert(tabCount('target') === 3, 'Target tab count must use displayed asset/fund/project result cards');
assert(tabCount('beneficiary') === 0 && tabCount('lender') === 0, 'Beneficiary/lender tab counts must stay separate from target cards');
assert(context.clusterCardTypeLabel('asset') === '자산', 'relationship card tag must use cluster type label instead of hard-coded RELATION');
assert(context.highlightTerms('분당Hostway IDC', ['분당']).includes('search-highlight'), 'matched search terms should be highlighted in cluster text');

console.log(JSON.stringify({
  ok: true,
  checks: [
    'fund_id dedupe/grouping',
    'asset_id dedupe and display-asset grouping',
    'project_id dedupe/grouping',
    'institution card grouping with exposure row retention',
    'broad region search clusters by display asset',
    'search v2 tab labels and target/institution counts',
    'beneficiary-only 국민연금 institution routing',
    'KB lender probe routing',
    'unified result model roots',
    'cluster fallback summary and type labels',
    'search term highlighting',
    'canonical display title helper',
    'unified search surface first with canonical fallback',
    'unified cards route asset roots to canonical asset detail',
    'canonical asset detail exposes related vehicles/assets navigation'
  ]
}, null, 2));
