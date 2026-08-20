# RA Dashboard DB Read Logic Map

작성일: 2026-06-10
범위: `01. RA Portal/portfolio-analysis/js`에서 Supabase DB를 읽는 주요 로직만 정리
제외: 렌더링 CSS, chart rendering, basket/comparison UI, admin UI, 순수 formatting helper

---

## 1. 읽기 로직 한눈에 보기

```text
config.js
  -> SUPABASE_URL / SUPABASE_KEY

core.js
  -> createClient()
  -> fetchAllRows()
  -> ensureAllDataLoaded()

search-results.js
  -> performSearch()
  -> performIndexedSearch()
  -> portfolio_search_results_canonical
  -> hydratePortfolioSearchRows()
  -> relationship cluster

asset-canonical.js
  -> searchCanonicalAssets()
  -> renderCanonicalAssetDetail()

detail-drawer.js
  -> openFundRelationshipDrawer()
  -> openProjectRelationshipDrawer()
  -> openInstitutionRelationshipDrawer()
```

현재 대시보드의 핵심 DB read contract는 다음이다.

```text
검색 1차 표면:
  portfolio_search_results_canonical

검색 결과 hydrate:
  v_funds_enriched
  asset_relationship_summary
  projects
  lender_exposures
  beneficiary_exposures

상세 drawer:
  fund_asset_relationships
  project_asset_relationships
  asset_master
  asset_building_ledger
  asset_fund_aum_inputs
  lender_exposures
  beneficiary_exposures
```

---

## 2. Supabase Client 초기화

파일:

```text
01. RA Portal/portfolio-analysis/config.js
01. RA Portal/portfolio-analysis/js/core.js
```

핵심 코드:

```js
// config.js
var SUPABASE_URL = "https://qvegpozwrcmspdvjokiz.supabase.co";
var SUPABASE_KEY = "sb_publishable_...";

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
```

```js
// core.js
const { createClient } = supabase;
var _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window._supabase = _supabase;
```

모든 DB read는 전역 `_supabase`를 통해 실행된다.

---

## 3. 전체 데이터 bulk load

파일:

```text
01. RA Portal/portfolio-analysis/js/core.js
```

사용 목적:

```text
종합 분석 / 필터 / 차트 계열에서 전체 fund, legacy fund_assets를 페이지 단위로 읽는다.
검색 cluster의 주 경로는 아니다.
```

핵심 코드:

```js
async function ensureAllDataLoaded() {
  if (window.allFunds?.length === 0 || !window.allFunds) {
    var responses = await Promise.all([
      fetchAllRows('v_funds_enriched', '*'),
      fetchAllRows('fund_assets', '*')
    ]);

    allFunds = responses[0] || [];
    allFundAssets = responses[1] || [];

    window.allFunds = allFunds;
    window.allFundAssets = allFundAssets;
  }

  return { funds: window.allFunds, assets: window.allFundAssets };
}
```

페이지네이션 read:

```js
async function fetchAllRows(tableName, selectClause, pageSize) {
  var size = pageSize || 1000;
  var from = 0;
  var rows = [];

  while (true) {
    var to = from + size - 1;
    var response = await _supabase.from(tableName).select(selectClause).range(from, to);
    if (response.error) throw response.error;

    var page = response.data || [];
    rows = rows.concat(page);
    if (page.length < size) break;
    from += size;
  }

  return rows;
}
```

읽는 테이블:

| 함수 | 테이블/view | 용도 |
|---|---|---|
| `ensureAllDataLoaded()` | `v_funds_enriched` | 전체 fund universe |
| `ensureAllDataLoaded()` | `fund_assets` | legacy asset snapshot |
| `fetchAllRows()` | dynamic | 1000 row씩 `.range()` 조회 |

---

## 4. 검색 Entry Point

파일:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
```

핵심 함수:

```js
function performSearch(query) {
  window.currentSearchQuery = query || '';
  window.searchContractMode = 'canonical';
  latestSearchRequestId += 1;
  var requestId = latestSearchRequestId;

  if (!query) {
    resultsContainer.innerHTML = '<div class="no-results">조회를 시작하세요.</div>';
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
    return performLegacySearch(query, requestId);
  });
}
```

읽기 흐름:

```text
performSearch(query)
  -> getSearchTerms(query)
  -> performIndexedSearch(query, terms)
  -> hydratePortfolioSearchRows(indexRows)
  -> allResults
  -> buildRelationshipClusters()
```

중요:

`latestSearchRequestId`는 연속 검색 race condition 방지용이다. 늦게 도착한 이전 검색 응답은 버린다.

---

## 5. Canonical Search Surface 조회

파일:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
```

현재 대시보드 검색의 1차 DB read:

```js
function performIndexedSearch(query, terms) {
  var options = isShortNumericSearch(query)
    ? { entityTypes: ['fund', 'project'], includeRelatedAssets: false, limit: 200 }
    : {};

  return performIndexedSearchOn('portfolio_search_results_canonical', terms, options).catch(function (canonicalError) {
    window.searchContractMode = 'raw_token_fallback';
    return performIndexedSearchOn('portfolio_search_index', terms, options);
  });
}
```

실제 Supabase read:

```js
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
```

읽는 view:

| 우선순위 | view | 설명 |
|---:|---|---|
| 1 | `portfolio_search_results_canonical` | primary search surface. entity당 1 row |
| 2 | `portfolio_search_index` | raw token fallback |

짧은 숫자 검색:

```js
isShortNumericSearch(query)
  -> entityTypes: ['fund', 'project']
  -> includeRelatedAssets: false
```

효과:

```text
1120 같은 검색어에서 asset noise를 막는다.
```

---

## 6. 검색 결과 Hydration

파일:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
```

`portfolio_search_results_canonical`은 compact index row다. 화면 출력과 cluster 생성을 위해 실제 테이블/view에서 다시 hydrate한다.

ID 추출:

```js
var fundIds = uniqueValues(indexRowsForType(indexRows, 'fund').map(function (row) { return row.entity_id; })
  .concat(relatedIdRows.map(function (row) { return row.related_fund_id; })));

var assetIds = uniqueValues(assetIdSources);

var projectIds = uniqueValues(indexRowsForType(indexRows, 'project').map(function (row) { return row.entity_id; })
  .concat(relatedIdRows.map(function (row) { return row.related_project_id; })));

var lenderIds = numericIds(indexRowsForType(indexRows, 'lender').map(function (row) { return row.entity_id; }));
var beneficiaryIds = numericIds(indexRowsForType(indexRows, 'beneficiary').map(function (row) { return row.entity_id; }));
```

실제 DB read:

```js
var fundReq = fundIds.length
  ? _supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds).limit(500)
  : Promise.resolve({ data: [] });

var assetReq = assetIds.length
  ? _supabase.from('asset_relationship_summary').select('*').in('asset_id', assetIds).limit(500)
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
```

기관명 fallback read:

```js
var lenderNameReq = lenderDisplayTerms.length
  ? _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(['lender_clean', 'lender_raw'], lenderDisplayTerms)).limit(500)
  : Promise.resolve({ data: [] });

var beneficiaryNameReq = beneficiaryDisplayTerms.length
  ? _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(['beneficiary_clean', 'beneficiary_raw'], beneficiaryDisplayTerms)).limit(500)
  : Promise.resolve({ data: [] });
```

최종 hydrated shape:

```js
return {
  lenders: dedupeEntities(..., 'lender'),
  beneficiaries: dedupeEntities(..., 'ben'),
  funds: dedupeEntities(funds, 'fund'),
  assets: [],
  projects: dedupeEntities(..., 'project'),
  assetGroups: dedupeEntities(..., 'asset'),
  _indexRows: indexRows
};
```

Hydration source 정리:

| entity | source | filter |
|---|---|---|
| fund | `v_funds_enriched` | `.in('fund_id', fundIds)` |
| asset | `asset_relationship_summary` | `.in('asset_id', assetIds)` |
| project | `projects` | `.in('project_id', projectIds)` |
| lender | `lender_exposures` | `.in('id', lenderIds)` + name fallback |
| beneficiary | `beneficiary_exposures` | `.in('id', beneficiaryIds)` + name fallback |

---

## 7. Legacy Search Fallback

파일:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
```

실행 조건:

```text
portfolio_search_results_canonical 실패
portfolio_search_index fallback도 실패
```

핵심 read:

```js
return Promise.all([
  _supabase.from('lender_exposures').select('*, funds(*)').or(buildUniversalFilter(exposureColumns, terms)).limit(100),
  _supabase.from('beneficiary_exposures').select('*, funds(*)').or(buildUniversalFilter(beneficiaryColumns, terms)).limit(100),
  _supabase.from('v_funds_enriched').select('*').or(buildUniversalFilter(activeFundSearchColumns, terms)).limit(100),
  _supabase.from('projects').select('*').or(buildUniversalFilter(projectColumns, terms)).limit(100),
  window.AssetCanonical
    ? window.AssetCanonical.searchCanonicalAssets(terms, { shortNumeric: shortNumeric })
    : _supabase.from('fund_assets').select('*, funds(*)').or(buildUniversalFilter(['asset_name', 'fund_id'], terms)).limit(100)
]);
```

주의:

이 경로는 현재 주 경로가 아니다. contract 미적용/장애 상황의 compatibility fallback이다.

---

## 8. Relationship Cluster는 DB를 직접 읽지 않는다

파일:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
```

중요한 점:

```text
buildRelationshipClusters()는 Supabase를 직접 조회하지 않는다.
이미 hydrate된 allResults와 _indexRows만 사용한다.
```

핵심 코드:

```js
function buildRelationshipClusters(query) {
  var rows = relationshipEntityRows();
  var terms = getSearchTerms(query || '');
  var lookups = relationshipEntityLookups(rows);
  var maps = buildRelationshipMaps(rows);
  var clusters = [];

  if (isShortNumericSearch(query)) {
    clusters = buildFundClusters(query, rows, maps, lookups, terms, null)
      .concat(buildProjectClusters(query, rows, maps, lookups, terms));
    return clusters.sort(...);
  }

  var broadTopicCluster = buildBroadTopicCluster(query, rows, maps, lookups, terms);
  if (broadTopicCluster) return [broadTopicCluster];

  var partyClusters = buildPartyClusters(query, rows, maps, lookups, terms);
  if (partyClusters.length) {
    clusters = partyClusters;
  } else if (hasProjectDominance(query, rows, lookups, terms)) {
    clusters = buildProjectClusters(query, rows, maps, lookups, terms);
  } else {
    clusters = buildAssetClusters(query, rows, maps, lookups, terms);
    clusters = clusters.concat(buildProjectClusters(...));
    clusters = clusters.concat(buildFundClusters(...));
  }

  return clusters.filter(...).sort(...);
}
```

Cluster가 쓰는 입력:

```text
allResults.funds
allResults.assetGroups
allResults.projects
allResults.lenders
allResults.beneficiaries
allResults._indexRows
```

즉 cluster layer는 DB read layer가 아니라 **read 결과 해석 layer**다.

---

## 9. Asset 검색 로직

파일:

```text
01. RA Portal/portfolio-analysis/js/asset-canonical.js
```

실행 경로:

```text
legacy search fallback
또는 asset tab / asset helper
```

핵심 read:

```js
async function searchCanonicalAssets(terms, options) {
  const summaryColumns = shortNumeric
    ? ['canonical_name', 'address_text', 'asset_code']
    : ['canonical_name', 'address_text', 'pnu', 'asset_code', 'main_usage'];

  const aliasFilter = shortNumeric ? '' : buildOrFilter(['alias_name'], terms);

  const [summaryRes, aliasRes] = await Promise.all([
    _supabase.from('asset_relationship_summary').select('*').or(summaryFilter).limit(100),
    aliasFilter
      ? _supabase.from('asset_aliases').select('asset_id, alias_name, alias_type, confidence').or(aliasFilter).limit(200)
      : Promise.resolve({ data: [] })
  ]);
}
```

Alias hit 후 asset summary 재조회:

```js
async function fetchAssetSummariesByIds(assetIds) {
  const response = await _supabase
    .from('asset_relationship_summary')
    .select('*')
    .in('asset_id', ids)
    .limit(200);
  return response.data || [];
}
```

Fund-derived asset name 필터링용 read:

```js
async function fetchFundRelationshipsByAssetIds(assetIds) {
  const response = await _supabase
    .from('fund_asset_relationships')
    .select('asset_id,fund_name,short_name')
    .in('asset_id', ids)
    .limit(1000);
}
```

읽는 view/table:

| source | 용도 |
|---|---|
| `asset_relationship_summary` | canonical asset search result |
| `asset_aliases` | alias hit |
| `fund_asset_relationships` | fund-derived asset name 숨김 판단 |

---

## 10. Asset 상세 DB Read

파일:

```text
01. RA Portal/portfolio-analysis/js/asset-canonical.js
```

핵심 함수:

```js
async function renderCanonicalAssetDetail(assetId, displayName, options) {
  const [assetRes, ledgerRes, fundRelRes, projectRelRes, lenderRes, benRes] = await Promise.all([
    _supabase.from('asset_master').select('*').eq('asset_id', assetId).single(),
    _supabase.from('asset_building_ledger').select('*').eq('asset_id', assetId).maybeSingle(),
    _supabase.from('fund_asset_relationships').select('*').eq('asset_id', assetId).limit(200),
    _supabase.from('project_asset_relationships').select('*').eq('asset_id', assetId).limit(200),
    _supabase.from('lender_exposures').select('*, funds(*)').eq('asset_id', assetId).limit(200),
    _supabase.from('beneficiary_exposures').select('*, funds(*)').eq('asset_id', assetId).limit(200)
  ]);
}
```

추가 AUM read:

```js
const aumRes = await _supabase
  .from('asset_fund_aum_inputs')
  .select('*')
  .eq('asset_id', assetId)
  .limit(300);
```

Fallback read:

```js
// exposure fund id로 fund 정보 보강
_supabase.from('v_funds_enriched').select('*').in('fund_id', exposureFundIds).limit(300);

// project_asset_relationships가 비었을 때 primary_asset_id fallback
_supabase.from('projects').select('*').eq('primary_asset_id', assetId).limit(100);

// fund/project 관계 row의 id로 상세 보강
_supabase.from('v_funds_enriched').select('*').in('fund_id', uniqueFundIds);
_supabase.from('projects').select('*').in('project_id', uniqueProjectIds);
```

asset 상세 read source:

| source | 용도 |
|---|---|
| `asset_master` | asset canonical profile |
| `asset_building_ledger` | 건축물/물리 정보 |
| `fund_asset_relationships` | 연결 fund |
| `project_asset_relationships` | 연결 project |
| `asset_fund_aum_inputs` | relation-level AUM |
| `lender_exposures` | direct asset lender exposure |
| `beneficiary_exposures` | direct asset beneficiary exposure |
| `v_funds_enriched` | fallback/enrichment |
| `projects` | fallback/enrichment |

---

## 11. Fund Drawer DB Read

파일:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
```

핵심 함수:

```js
window.openFundRelationshipDrawer = async (fundId, displayName, options) => {
  const [fundRes, assetRelRes, lenderRes, benRes] = await Promise.all([
    _supabase.from('v_funds_enriched').select('*').eq('fund_id', fundId).maybeSingle(),
    _supabase.from('fund_asset_relationships').select('*').eq('fund_id', fundId).limit(300),
    _supabase.from('lender_exposures').select('*').eq('fund_id', fundId).limit(300),
    _supabase.from('beneficiary_exposures').select('*').eq('fund_id', fundId).limit(300)
  ]);
};
```

Fallback:

```js
if (!assets.length) {
  assets = dedupeAssetRelationshipRows(await fetchAssetsByIds(primaryAssetIds(fund)));
}
```

읽는 source:

| source | 용도 |
|---|---|
| `v_funds_enriched` | fund profile |
| `fund_asset_relationships` | canonical fund -> asset |
| `lender_exposures` | fund lender rows |
| `beneficiary_exposures` | fund beneficiary rows |
| `asset_master` | primary asset fallback |

---

## 12. Project Drawer DB Read

파일:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
```

핵심 함수:

```js
window.openProjectRelationshipDrawer = async (projectId, displayName, options) => {
  const [projectRes, fundRes] = await Promise.all([
    _supabase.from('projects').select('*').eq('project_id', projectId).maybeSingle(),
    _supabase.from('v_funds_enriched').select('*').eq('fund_id', projectId).maybeSingle()
  ]);

  const childProjects = projectRes.data ? await fetchChildProjects(projectId) : [];
  const projectScope = [project].concat(childProjects).filter(function (row) { return row && row.project_id; });
  const projectScopeIds = uniqueIds([projectId].concat(projectScope.map(function (row) { return row.project_id; })));

  const [projectAssetRows, fundAssetRes] = await Promise.all([
    fetchProjectAssetRelationships(projectScopeIds),
    _supabase.from('fund_asset_relationships').select('*').eq('fund_id', projectId).limit(300)
  ]);
};
```

Child project read:

```js
async function fetchChildProjects(projectId) {
  const res = await _supabase
    .from('projects')
    .select('*')
    .eq('parent_project_id', projectId)
    .limit(200);
  return res.data || [];
}
```

Project-asset read:

```js
async function fetchProjectAssetRelationships(projectIds) {
  const query = _supabase.from('project_asset_relationships').select('*').limit(500);
  const res = ids.length === 1
    ? await query.eq('project_id', ids[0])
    : await query.in('project_id', ids);
  return res.data || [];
}
```

Asset -> fund reverse lookup:

```js
async function fetchFundRelationshipsByAssetIds(assetIds) {
  const res = await _supabase
    .from('fund_asset_relationships')
    .select('*')
    .in('asset_id', ids)
    .limit(1000);
  return res.data || [];
}
```

읽는 source:

| source | 용도 |
|---|---|
| `projects` | project profile |
| `projects.parent_project_id` | child project scope |
| `project_asset_relationships` | project -> asset |
| `fund_asset_relationships` | fund_as_project fallback, asset -> fund reverse |
| `v_funds_enriched` | fund_as_project fallback |
| `asset_master` | fallback asset fetch |

Canonical project path:

```text
project_id
  -> projects.parent_project_id child scope
  -> project_asset_relationships
  -> asset_id
  -> fund_asset_relationships
  -> fund_id
```

---

## 13. Party Drawer DB Read

파일:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
```

대상:

```text
lender
beneficiary
```

핵심 함수:

```js
window.openInstitutionRelationshipDrawer = async (type, name, items, options) => {
  const sourceItems = items || [];
  const fundIds = Array.from(new Set(sourceItems.map(function (row) { return row.fund_id; }).filter(Boolean)));

  let fundRows = sourceItems.map(function (row) { return row.funds; }).filter(Boolean);
  let assetRows = [];

  if (fundIds.length > 0) {
    const [fundRes, assetRes] = await Promise.all([
      _supabase.from('v_funds_enriched').select('*').in('fund_id', fundIds).limit(500),
      _supabase.from('fund_asset_relationships').select('*').in('fund_id', fundIds).limit(1000)
    ]);
  }
};
```

Fallback:

```js
if (!assetRows.length) {
  const fallbackAssetIds = fundRows.map(function (fund) { return fund.primary_asset_id; }).filter(Boolean);
  assetRows = dedupeAssetRelationshipRows(await fetchAssetsByIds(fallbackAssetIds));
}
```

읽는 source:

| source | 용도 |
|---|---|
| `v_funds_enriched` | party가 참여한 fund |
| `fund_asset_relationships` | party fund -> asset |
| `asset_master` | primary asset fallback |

주의:

party drawer 자체는 이미 검색/hydration에서 받은 exposure rows를 `items`로 받는다. 여기서는 그 exposure rows의 `fund_id`를 기준으로 fund/asset을 보강한다.

---

## 14. 공통 Helper DB Read

파일:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
```

### 14.1 Asset id로 asset_master 조회

```js
async function fetchAssetsByIds(assetIds) {
  const res = await _supabase.from('asset_master').select('*').in('asset_id', ids).limit(500);
  return (res.data || []).map(function (asset) {
    return { ...asset, relation_type: 'primary_asset', source_table: 'asset_master' };
  });
}
```

### 14.2 Asset row 상세 보강

```js
async function enrichAssetRows(rows) {
  const ids = Array.from(new Set(baseRows.map(function (row) { return row.asset_id; }).filter(Boolean)));
  const res = await _supabase.from('asset_master').select('*').in('asset_id', ids).limit(500);
  return baseRows.map(function (row) {
    const asset = byId[row.asset_id] || {};
    return { ...asset, ...row, metadata: { ...(asset.metadata || {}), ...(row.metadata || {}) } };
  });
}
```

### 14.3 Primary asset fallback으로 fund 조회

```js
async function fetchFundsByPrimaryAsset(assetId) {
  const res = await _supabase.from('v_funds_enriched').select('*').eq('primary_asset_id', assetId).limit(300);
  return (res.data || []).map(function (fund) {
    return { ...fund, relation_type: 'primary_asset_fallback' };
  });
}
```

---

## 15. DB Read Source별 용도 정리

| source | 읽는 파일/함수 | 용도 |
|---|---|---|
| `portfolio_search_results_canonical` | `performIndexedSearch()` | primary search surface |
| `portfolio_search_index` | `performIndexedSearch()` | raw fallback |
| `v_funds_enriched` | search hydration, fund drawer, project fallback, analysis bulk | fund profile |
| `asset_relationship_summary` | search hydration, asset search | asset summary |
| `projects` | search hydration, project drawer, asset fallback | project profile/scope |
| `fund_asset_relationships` | asset detail, fund drawer, project drawer, party drawer | canonical fund-asset relation |
| `project_asset_relationships` | asset detail, project drawer | canonical project-asset relation |
| `asset_master` | asset detail, helper enrichment/fallback | asset canonical profile |
| `asset_building_ledger` | asset detail | physical building specs |
| `asset_fund_aum_inputs` | asset detail | relation-level AUM |
| `asset_aliases` | asset search fallback | alias search |
| `lender_exposures` | search hydration, asset/fund detail | lender exposure |
| `beneficiary_exposures` | search hydration, asset/fund detail | beneficiary exposure |
| `fund_assets` | legacy fallback, analysis bulk | old snapshot fallback |

---

## 16. 주요 읽기 경로별 요약

### 16.1 일반 검색

```text
performSearch()
  -> portfolio_search_results_canonical
  -> hydrate:
       v_funds_enriched
       asset_relationship_summary
       projects
       lender_exposures
       beneficiary_exposures
  -> buildRelationshipClusters()
```

### 16.2 자산 상세

```text
renderCanonicalAssetDetail(asset_id)
  -> asset_master
  -> asset_building_ledger
  -> fund_asset_relationships
  -> project_asset_relationships
  -> lender_exposures
  -> beneficiary_exposures
  -> asset_fund_aum_inputs
```

### 16.3 펀드 상세

```text
openFundRelationshipDrawer(fund_id)
  -> v_funds_enriched
  -> fund_asset_relationships
  -> lender_exposures
  -> beneficiary_exposures
  -> asset_master fallback
```

### 16.4 프로젝트 상세

```text
openProjectRelationshipDrawer(project_id)
  -> projects
  -> child projects by parent_project_id
  -> project_asset_relationships
  -> fund_asset_relationships by asset_id
  -> asset_master enrichment
  -> v_funds_enriched fallback
```

### 16.5 대주/수익자 상세

```text
openInstitutionRelationshipDrawer(type, name, exposureRows)
  -> exposureRows에서 fund_id 추출
  -> v_funds_enriched
  -> fund_asset_relationships
  -> asset_master fallback/enrichment
```

### 16.6 종합 분석 bulk load

```text
ensureAllDataLoaded()
  -> fetchAllRows(v_funds_enriched)
  -> fetchAllRows(fund_assets)
```

---

## 17. 현재 유지보수 시 가장 먼저 볼 코드

검색 결과가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/search-results.js
  performSearch()
  performIndexedSearch()
  hydratePortfolioSearchRows()
  buildRelationshipClusters()
```

자산 상세가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/asset-canonical.js
  renderCanonicalAssetDetail()
```

펀드 상세가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
  openFundRelationshipDrawer()
```

프로젝트 상세가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
  openProjectRelationshipDrawer()
  fetchChildProjects()
  fetchProjectAssetRelationships()
  fetchFundRelationshipsByAssetIds()
```

대주/수익자 상세가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/detail-drawer.js
  openInstitutionRelationshipDrawer()
```

분석 탭 전체 데이터가 이상할 때:

```text
01. RA Portal/portfolio-analysis/js/core.js
  ensureAllDataLoaded()
  fetchAllRows()
```
