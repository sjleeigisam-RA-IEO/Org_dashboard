const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const searchPath = path.join(root, 'CRM_base', 'portfolio-analysis', 'js', 'search-results.js');
const source = fs.readFileSync(searchPath, 'utf8');

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

function keys(object) {
  return Object.keys(object).sort();
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
assert(unifiedBundang.every((result) => result.facets.includes('asset')), 'Bundang unified cards must appear under the asset facet');
assert(unifiedBundang.some((result) => result.facets.includes('fund')), 'Bundang cards with fund relations must be visible through the fund facet');
assert(!unifiedBundang.some((result) => result.title.includes('북미DC포트폴리오')), 'Unified results must not expose absorbed same-location portfolio assets as root cards');

context.tabBtns.length = 0;
[
  ['all', '전체'],
  ['asset', '자산'],
  ['fund', '펀드'],
  ['project', '프로젝트'],
  ['party', '기관']
].forEach(([tab, label]) => {
  context.tabBtns.push({ dataset: { tab }, textContent: label, innerHTML: '' });
});
context.updateTabCounts();
function tabCount(tab) {
  const button = context.tabBtns.find((btn) => btn.dataset.tab === tab);
  const match = String(button && button.innerHTML || '').match(/tab-count">(\d+)</);
  return match ? Number(match[1]) : NaN;
}
assert(tabCount('all') === 3, 'All tab count must use displayed unified result cards');
assert(tabCount('asset') === 3, 'Asset tab count must use unified asset result cards');
assert(tabCount('fund') === 3 && tabCount('project') === 2, 'Fund/project tabs must filter the same unified result cards by facets');
assert(tabCount('party') === 0, 'Institution tab must replace the old separate beneficiary/lender tabs');
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
    'unified result-card count by facet',
    'unified result model roots',
    'cluster fallback summary and type labels',
    'search term highlighting',
    'canonical display title helper',
    'unified search surface first with canonical fallback'
  ]
}, null, 2));
