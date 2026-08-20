# RA Dashboard Visual System Map

작성일: 2026-06-10
목적: 레포 전체를 공유하지 않고도 RA Dashboard의 주요 DB 계약, 검색 로직, 화면 형태, 상세 조회 흐름을 설명하기 위한 시각화 아티팩트
기준 코드: `01. RA Portal/portfolio-analysis`, `01. RA Portal/migrations/2026-06-*`, `01. RA Portal/tools/data-reconciliation`

---

## 1. 한 장 요약

RA Dashboard는 지금 세 개의 층으로 나뉜다.

```mermaid
flowchart LR
    A["Supabase canonical DB<br/>master/link/fact"] --> B["Relationship interpretation<br/>entities / edges / tokens"]
    B --> C["Canonical search surface<br/>portfolio_search_results_canonical"]
    C --> D["Dashboard hydration<br/>fund / asset / project / exposure"]
    D --> E["Relationship clusters<br/>user-facing results"]
    E --> F["Detail drawers<br/>asset / fund / project / party"]
```

사용자가 보는 핵심은 개별 테이블 row가 아니라 `relationship cluster`다.

```text
검색어: 분당

예전 의도와 충돌하던 형태:
  전체: "분당"이라는 큰 관계 묶음 1개
  자산: 같은 자산명이 여러 번 반복
  일부 자산은 detail 없음

현재 목표 형태:
  전체:
    - 롯데백화점분당점
        자산 1 / 펀드 n / 프로젝트 n / 대주 n / 수익자 n
    - 분당야탑물류센터
        자산 1 / 펀드 n / 프로젝트 n / 대주 n / 수익자 n
    - 분당Hostway IDC
        자산 1 / 펀드 n / 프로젝트 n / 대주 n / 수익자 n

  자산 탭:
    전체와 같은 표시 단위의 자산 목록
```

---

## 2. 제품 화면 구조

### 2.1 데스크톱 레이아웃

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ IGIS RA Insight                                                            │
├───────────────────────────────┬────────────────────────────────────────────┤
│ Left Panel                    │ Right Detail Panel                         │
│                               │                                            │
│ [데이터 조회] [종합 분석]      │  선택 전                                  │
│                               │  ┌──────────────────────────────────────┐  │
│ 검색 및 조회 (?)              │  │ 리스트에서 항목을 선택하면             │  │
│ ┌───────────────────────────┐ │  │ 상세 정보가 여기에 표시됩니다.        │  │
│ │ 🔍 검색어 입력             │ │  └──────────────────────────────────────┘  │
│ └───────────────────────────┘ │                                            │
│                               │  선택 후                                  │
│ [전체] [펀드] [자산] [프로젝트]│  ┌──────────────────────────────────────┐  │
│ [수익자] [대주]               │  │ RELATIONSHIP CLUSTER / ASSET DETAIL   │  │
│                               │  │ 연결 자산 / 펀드 / 프로젝트 / 기관     │  │
│ 결과 카드 리스트              │  │ 상세 테이블 / 지도 / 익스포저          │  │
│ ┌───────────────────────────┐ │  └──────────────────────────────────────┘  │
│ │ RELATION / ASSET / FUND   │ │                                            │
│ └───────────────────────────┘ │                                            │
└───────────────────────────────┴────────────────────────────────────────────┘
```

### 2.2 모바일 레이아웃

```text
┌────────────────────────────┐
│ IGIS RA Insight            │
├────────────────────────────┤
│ [데이터 조회] [종합 분석]   │
├────────────────────────────┤
│ 검색창                     │
├────────────────────────────┤
│ 가로 스크롤 탭             │
│ [전체] [펀드] [자산] ...   │
├────────────────────────────┤
│ 카드 리스트                │
│ ┌────────────────────────┐ │
│ │ 자산/관계 카드          │ │
│ │ 펀드 n / 프로젝트 n     │ │
│ └────────────────────────┘ │
├────────────────────────────┤
│ 카드 선택 시 detailPanel로 │
│ inline 상세 렌더링         │
└────────────────────────────┘
```

---

## 3. Repo File Map

```mermaid
flowchart TD
    R["RA dashboard repo"] --> P["01. RA Portal/portfolio-analysis"]
    R --> M["01. RA Portal/migrations"]
    R --> T["01. RA Portal/tools/data-reconciliation"]
    R --> D["docs"]

    P --> I["index.html<br/>layout shell"]
    P --> A["app.js<br/>view toggle / input / tabs"]
    P --> C["config.js<br/>Supabase URL/key"]
    P --> Core["js/core.js<br/>client / helpers / bulk load"]
    P --> Search["js/search-results.js<br/>search + cluster rendering"]
    P --> Asset["js/asset-canonical.js<br/>asset cards/detail"]
    P --> Drawer["js/detail-drawer.js<br/>fund/project/party drawers"]
    P --> Analytics["js/analytics-dashboard.js<br/>AUM analytics"]
    P --> CSS["style.css<br/>responsive visual layer"]

    M --> M1["2026-06-09_relationship_index_v1.sql"]
    M --> M2["2026-06-09_relationship_index_search_cache.sql"]
    M --> M3["2026-06-08_relationship_contract_v1.sql"]
    M --> M4["2026-06-08_portfolio_search_index.sql"]
    M --> M5["2026-06-10_refresh_relationship_caches.sql"]

    T --> V1["verify_dashboard_search_determinism.js"]
    T --> V2["verify_dashboard_cluster_contract_live.js"]
    T --> V3["audit_dashboard_operational_contract.py"]
```

---

## 4. Supabase Relationship Model

### 4.1 Canonical truth

```mermaid
erDiagram
    funds ||--o{ asset_fund_links : "fund_id"
    asset_master ||--o{ asset_fund_links : "asset_id"
    projects ||--o{ asset_project_links : "project_id/resolved target"
    asset_master ||--o{ asset_project_links : "asset_id"
    funds ||--o{ lender_exposures : "fund_id"
    funds ||--o{ beneficiary_exposures : "fund_id"
    asset_master ||--o{ lender_exposures : "asset_id direct or derived"
    asset_master ||--o{ beneficiary_exposures : "asset_id direct or derived"
    asset_master ||--o{ asset_aliases : "asset_id"
    asset_master ||--o{ asset_fund_aum_inputs : "asset_id"
    funds ||--o{ asset_fund_aum_inputs : "fund_id"

    funds {
        text fund_id PK
        text fund_name
        text short_name
        text primary_asset_id
    }
    asset_master {
        text asset_id PK
        text asset_code
        text physical_asset_name
        text non_physical_asset_label
        text canonical_name
        text address_text
        text pnu
    }
    projects {
        text project_id PK
        text project_name
        text parent_project_id
        text primary_asset_id
    }
    asset_fund_links {
        text fund_id FK
        text asset_id FK
        text relation_type
    }
    asset_project_links {
        text project_id
        text asset_id FK
        text relation_type
    }
```

### 4.2 Relationship index layer

```mermaid
flowchart TD
    A["funds / v_funds_enriched"] --> E["relationship_index_entities"]
    B["asset_master"] --> E
    C["projects"] --> E
    D1["lender_exposures"] --> E
    D2["beneficiary_exposures"] --> E

    L1["asset_fund_links"] --> X["relationship_index_edges"]
    L2["asset_project_link_resolution"] --> X
    L3["exposure fund/asset links"] --> X
    L4["parent/child project links"] --> X

    E --> T["relationship_index_tokens"]
    X --> T
    T --> S["relationship_index_search_results"]
    S --> C1["relationship_index_search_results_cache<br/>materialized"]
    C1 --> API["portfolio_search_results_canonical<br/>dashboard API surface"]
```

### 4.3 Relation meaning

| Edge / relation | 의미 | 화면에서 쓰임 |
|---|---|---|
| `fund_asset` | 펀드와 자산의 강한 관계 | fund drawer, asset detail, search cluster |
| `project_asset` | 프로젝트와 자산의 해석된 관계 | project drawer, asset detail, project cluster |
| `project_child` | parent project와 child project | IOTA 같은 parent scope 확장 |
| `fund_lender` | 대주 exposure가 fund에 연결 | party cluster, fund drawer |
| `fund_beneficiary` | 수익자 exposure가 fund에 연결 | party cluster, fund drawer |
| `asset_lender` | exposure가 asset에 직접 또는 파생 연결 | asset detail |
| `asset_beneficiary` | exposure가 asset에 직접 또는 파생 연결 | asset detail |

---

## 5. 검색 Query Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant App as app.js
    participant S as search-results.js
    participant DB as Supabase
    participant UI as Results UI
    participant D as Detail Panel

    U->>App: 검색어 입력
    App->>S: performSearch(query), 400ms debounce
    S->>S: latestSearchRequestId 증가
    S->>S: getSearchTerms(query)
    S->>DB: portfolio_search_results_canonical token_text ilike terms
    DB-->>S: index rows
    S->>DB: hydratePortfolioSearchRows()
    Note over S,DB: v_funds_enriched / asset_relationship_summary / asset_master / projects / exposures
    DB-->>S: hydrated rows
    S->>S: assetRowsForSearchContext()
    S->>S: buildRelationshipClusters()
    S->>UI: renderResults()
    U->>UI: relationship card click
    UI->>D: openRelationshipClusterDetail()
    U->>D: linked row click
    D->>DB: entity-specific detail query
    DB-->>D: canonical detail rows
```

---

## 6. Search Result Decision Tree

```mermaid
flowchart TD
    Q["performSearch(query)"] --> Empty{"query empty?"}
    Empty -- yes --> Stop["show 조회를 시작하세요"]
    Empty -- no --> Terms["getSearchTerms(query)"]

    Terms --> Num{"1-4 digit numeric?"}
    Num -- yes --> NumSearch["Search fund/project only<br/>limit asset noise"]
    Num -- no --> Canonical["Search portfolio_search_results_canonical"]

    Canonical --> Hydrate["hydratePortfolioSearchRows()"]
    NumSearch --> Hydrate

    Hydrate --> Context["relationshipEntityRows()<br/>assetRowsForSearchContext()"]
    Context --> Party{"party name match?"}
    Party -- yes --> PartyCluster["party cluster<br/>lender/beneficiary root"]
    Party -- no --> Asset{"asset title match?"}
    Asset -- yes --> AssetCluster["asset clusters<br/>one root per display asset"]
    Asset -- no --> Project{"project dominance?"}
    Project -- yes --> ProjectCluster["project cluster<br/>parent/child scope"]
    Project -- no --> FundCluster["fund/project fallback clusters"]

    PartyCluster --> Render["renderRelationshipClusterCard()"]
    AssetCluster --> Render
    ProjectCluster --> Render
    FundCluster --> Render
```

---

## 7. Asset Display Grouping

자산 검색 결과는 `asset_id` 그대로 나열하지 않는다. 같은 실물 자산으로 보이는 row는 표시 단위로 접는다.

```mermaid
flowchart TD
    A["raw hydrated asset rows"] --> B["canonicalDisplayTitle(asset)"]
    B --> C["cleanAssetDisplayTitle()<br/>remove trailing (투자)"]
    C --> D["assetDisplayGroupKey()"]
    D --> E{"generic title?"}
    E -- yes --> F["title + asset_id<br/>over-merge 방지"]
    E -- no --> G["normalized title<br/>same display asset merge"]
    F --> H["mergeAssetDisplayRows()"]
    G --> H
    H --> I["titleMatchesQuery()?"]
    I -- yes --> J["matching roots only"]
    I -- no --> K["fallback merged assets"]
    J --> L["absorbSameLocationAssets()<br/>same address/PNU hints"]
    K --> M["asset tab cards"]
    L --> M
```

예시:

```text
검색어: 홈플러스

raw:
  홈플러스죽도점
  홈플러스죽도점 (투자)

display:
  홈플러스죽도점
```

```text
검색어: 분당

display roots:
  롯데백화점분당점
  분당야탑물류센터
  분당Hostway IDC

same-location absorbed hint:
  북미DC포트폴리오 -> 분당Hostway IDC 관계 힌트로 흡수
```

---

## 8. Cluster Object Shape

화면의 `전체` 탭은 아래 구조를 카드로 보여준다.

```mermaid
classDiagram
    class RelationshipCluster {
      string cluster_id
      string cluster_type
      string title
      string subtitle
      object matched_entity
      object entities
      string[] relation_paths
    }

    class Entities {
      funds[]
      assets[]
      projects[]
      lenders[]
      beneficiaries[]
    }

    RelationshipCluster --> Entities
```

표시 카드:

```text
┌──────────────────────────────────────┐
│ RELATION                             │
│ 롯데백화점분당점                     │
│ 자산 기반 관계 묶음                  │
│                                      │
│ [자산 1] [펀드 4] [프로젝트 5]       │
│                                      │
│ 자산      롯데백화점분당점           │
│ 펀드      [389호] ...                │
│ 프로젝트  롯데백화점 분당점 리모델링 │
└──────────────────────────────────────┘
```

---

## 9. Detail Navigation Map

```mermaid
flowchart TD
    Card["Relationship cluster card"] --> Detail["openRelationshipClusterDetail()"]
    Detail --> AssetRow["연결 자산 row"]
    Detail --> FundRow["연결 펀드 row"]
    Detail --> ProjectRow["연결 프로젝트 row"]
    Detail --> PartyRow["연결 대주/수익자 row"]

    AssetRow --> AssetDetail["AssetCanonical.renderCanonicalAssetDetail(asset_id)"]
    FundRow --> FundDrawer["openFundRelationshipDrawer(fund_id)"]
    ProjectRow --> ProjectDrawer["openProjectRelationshipDrawer(project_id)"]
    PartyRow --> PartyDrawer["openInstitutionRelationshipDrawer(type, name, rows)"]

    AssetDetail --> A1["asset_master"]
    AssetDetail --> A2["asset_building_ledger"]
    AssetDetail --> A3["fund_asset_relationships"]
    AssetDetail --> A4["project_asset_relationships"]
    AssetDetail --> A5["lender_exposures"]
    AssetDetail --> A6["beneficiary_exposures"]
    AssetDetail --> A7["asset_fund_aum_inputs"]

    FundDrawer --> F1["v_funds_enriched"]
    FundDrawer --> F2["fund_asset_relationships"]
    FundDrawer --> F3["lender_exposures"]
    FundDrawer --> F4["beneficiary_exposures"]

    ProjectDrawer --> P1["projects"]
    ProjectDrawer --> P2["child projects"]
    ProjectDrawer --> P3["project_asset_relationships"]
    ProjectDrawer --> P4["fund_asset_relationships by asset"]

    PartyDrawer --> I1["exposure rows"]
    PartyDrawer --> I2["funds by fund_id"]
    PartyDrawer --> I3["assets via fund_asset_relationships"]
```

---

## 10. Dashboard Views

```mermaid
stateDiagram-v2
    [*] --> ListView

    ListView: 데이터 조회
    ListView --> SearchInput: type query
    SearchInput --> SearchResults: canonical search
    SearchResults --> RelationshipDetail: click cluster
    RelationshipDetail --> EntityDetail: click linked row
    EntityDetail --> SearchResults: back

    ListView --> AnalysisView: 종합 분석 click
    AnalysisView: 종합 분석
    AnalysisView --> BulkLoad: ensureAllDataLoaded()
    BulkLoad --> Analytics: renderAnalytics()
    Analytics --> ListView: 데이터 조회 click
```

---

## 11. 데이터 조회 vs 종합 분석

| 영역 | 1차 데이터 소스 | 목적 | 주의점 |
|---|---|---|---|
| 데이터 조회 | `portfolio_search_results_canonical` | 사용자가 기대하는 대상을 찾고 관계를 타고 들어감 | 관계 cluster가 기본 |
| 자산 탭 | hydrated `asset_relationship_summary + asset_master` | 검색 컨텍스트에 맞는 표시 자산 목록 | 같은 표시명/같은 실물 단위 병합 |
| 펀드 탭 | `v_funds_enriched` | 검색에 걸린 fund universe 확인 | 상세은 fund drawer에서 canonical relation 우선 |
| 프로젝트 탭 | `projects` | project/parent-child scope 확인 | project_id = fund_id 혼용은 낮은 fallback |
| 수익자/대주 탭 | exposure tables | 기관 참여 row 확인 | drawer에서 fund/asset relation으로 재추적 |
| 종합 분석 | `ensureAllDataLoaded()`로 bulk `v_funds_enriched`, `fund_assets` | AUM/성장/필터 분석 | 검색 cluster 경로와 별도 |

---

## 12. 주요 함수 지도

```mermaid
flowchart TD
    subgraph App["app.js"]
      Init["initApp()"]
      Toggle["showListView() / showChartView()"]
      Tab["handleCategoryTabChange()"]
    end

    subgraph Core["core.js"]
      Client["_supabase client"]
      Terms["getSearchTerms()"]
      Bulk["ensureAllDataLoaded()"]
      FetchAll["fetchAllRows()"]
    end

    subgraph Search["search-results.js"]
      PS["performSearch()"]
      IS["performIndexedSearchOn()"]
      Hydrate["hydratePortfolioSearchRows()"]
      AssetCtx["assetRowsForSearchContext()"]
      Maps["buildRelationshipMaps()"]
      Clusters["buildRelationshipClusters()"]
      Render["renderResults()"]
      OpenCluster["openRelationshipClusterDetail()"]
    end

    subgraph Asset["asset-canonical.js"]
      AssetCards["renderCanonicalAssetCards()"]
      AssetDetail["renderCanonicalAssetDetail()"]
      Lookthrough["renderLookThroughModal()"]
    end

    subgraph Drawer["detail-drawer.js"]
      FundDrawer["openFundRelationshipDrawer()"]
      ProjectDrawer["openProjectRelationshipDrawer()"]
      PartyDrawer["openInstitutionRelationshipDrawer()"]
    end

    Init --> Toggle
    Init --> PS
    Init --> Tab
    Toggle --> Bulk
    PS --> Terms
    PS --> IS
    IS --> Hydrate
    Hydrate --> AssetCtx
    AssetCtx --> Maps
    Maps --> Clusters
    Clusters --> Render
    Render --> AssetCards
    Render --> OpenCluster
    OpenCluster --> AssetDetail
    OpenCluster --> FundDrawer
    OpenCluster --> ProjectDrawer
    OpenCluster --> PartyDrawer
```

---

## 13. 주요 SQL/View 지도

```mermaid
flowchart TD
    subgraph Source["Source / canonical tables"]
      Funds["funds / v_funds_enriched"]
      Assets["asset_master"]
      Projects["projects"]
      AFL["asset_fund_links"]
      APL["asset_project_links"]
      Lender["lender_exposures"]
      Ben["beneficiary_exposures"]
      Alias["asset_aliases"]
    end

    subgraph Contract["Contract views"]
      APLR["asset_project_link_resolution"]
      PAR["project_asset_relationships"]
      FAR["fund_asset_relationships"]
      AES["asset_exposure_summary"]
    end

    subgraph Index["Relationship index"]
      RIE["relationship_index_entities"]
      RIX["relationship_index_edges"]
      RIT["relationship_index_tokens"]
      RIS["relationship_index_search_results"]
      Cache["relationship_index_search_results_cache"]
      Canon["portfolio_search_results_canonical"]
    end

    Funds --> RIE
    Assets --> RIE
    Projects --> RIE
    Lender --> RIE
    Ben --> RIE
    AFL --> FAR
    APL --> APLR
    APLR --> PAR
    FAR --> RIX
    PAR --> RIX
    Lender --> RIX
    Ben --> RIX
    Alias --> RIT
    RIE --> RIT
    RIX --> RIT
    RIT --> RIS
    RIS --> Cache
    Cache --> Canon
    Canon --> Dashboard["Dashboard search"]
```

---

## 14. Search Scenarios

### 14.1 Asset-like query

```mermaid
flowchart LR
    Q["분당"] --> A["matched display assets"]
    A --> A1["롯데백화점분당점"]
    A --> A2["분당야탑물류센터"]
    A --> A3["분당Hostway IDC"]
    A1 --> R1["fund/project/party links"]
    A2 --> R2["fund/project/party links"]
    A3 --> R3["fund/project/party links"]
```

### 14.2 Project-like query

```mermaid
flowchart LR
    Q["이오타서울"] --> P["parent project"]
    P --> C1["child project iota-427"]
    P --> C2["child project iota-421f"]
    C1 --> A1["asset ast_cd..."]
    C2 --> A2["asset ast_ae..."]
    A1 --> F1["related funds"]
    A2 --> F2["related funds"]
```

### 14.3 Party-like query

```mermaid
flowchart LR
    Q["국민연금"] --> Party["beneficiary party cluster"]
    Party --> Exp["beneficiary_exposures"]
    Exp --> Fund["funds by fund_id"]
    Fund --> Asset["assets via fund_asset_relationships"]
```

### 14.4 Short numeric query

```mermaid
flowchart LR
    Q["1120"] --> Rule["short numeric rule"]
    Rule --> Fund["fund code/name matches"]
    Rule --> Project["project code matches"]
    Rule -. avoids .-> AssetNoise["asset noise"]
```

---

## 15. 검색 결과가 중복되지 않기 위한 규칙

| 규칙 | 구현 위치 | 효과 |
|---|---|---|
| 같은 fund는 `fund_id`로 dedupe | `dedupeEntities(..., 'fund')` | 펀드 중복 제거 |
| 같은 project는 `project_id`로 dedupe | `dedupeEntities(..., 'project')` | 프로젝트 중복 제거 |
| 같은 기관은 정규화된 기관명으로 group | `groupEntities()` | 대주/수익자 반복 제거 |
| 같은 표시 자산은 display key로 group | `assetDisplayGroupKey()` | 같은 자산명 반복 제거 |
| `(투자)` suffix 제거 | `cleanAssetDisplayTitle()` | 투자 wrapper row와 실물 row 병합 |
| 같은 위치의 비직접 asset은 힌트로 흡수 | `absorbSameLocationAssets()` | `북미DC포트폴리오` 같은 row가 별도 root로 튀지 않음 |
| 전체 탭은 topic bucket보다 entity root 우선 | `buildRelationshipClusters()` | 큰 검색어도 실제 표시 대상 단위로 출력 |

---

## 16. Verification Map

```mermaid
flowchart TD
    V1["verify_dashboard_search_determinism.js"] --> C1["sample data contract"]
    C1 --> C11["dedupe/grouping"]
    C1 --> C12["display asset grouping"]
    C1 --> C13["canonical search surface first"]

    V2["verify_dashboard_cluster_contract_live.js"] --> C2["live Supabase contract"]
    C2 --> C21["no topic-only broad bucket"]
    C2 --> C22["no duplicate cluster titles"]
    C2 --> C23["asset roots match query"]
    C2 --> C24["sample queries: 분당 / 홈플러스 / IDC / 물류 / 롯데 / 눈스퀘어 / 이오타서울 / 국민연금 / 1120"]

    V3["audit_dashboard_operational_contract.py"] --> C3["operational audit"]
    C3 --> C31["display parity"]
    C3 --> C32["cache refresh readiness"]
    C3 --> C33["hydration limit warnings"]
    C3 --> C34["party coverage"]
    C3 --> C35["cluster explainability"]
```

최근 확인된 검증 명령:

```powershell
node --check 01. RA Portal\portfolio-analysis\js\search-results.js
node 01. RA Portal\tools\data-reconciliation\verify_dashboard_search_determinism.js
node 01. RA Portal\tools\data-reconciliation\verify_dashboard_cluster_contract_live.js
python -m py_compile 01. RA Portal\tools\data-reconciliation\audit_dashboard_operational_contract.py
python 01. RA Portal\tools\data-reconciliation\audit_dashboard_operational_contract.py
```

---

## 17. 외부 공유용 최소 설명 문구

```text
RA Dashboard는 Supabase의 fund, asset, project, lender, beneficiary 원천 row를 직접 나열하지 않고,
canonical relationship index를 통해 검색어와 연결된 실제 표시 대상 단위로 결과를 재구성한다.

검색 결과의 기본 단위는 fund/asset/project 개별 row가 아니라 relationship cluster이며,
cluster 안에는 연결 자산, 펀드/비히클, 프로젝트, 대주, 수익자가 함께 들어간다.

자산 검색에서는 같은 실물 자산 또는 같은 표시명으로 판단되는 row를 하나로 접고,
비실물 wrapper나 같은 위치의 포트폴리오 row는 별도 root로 튀지 않도록 관계 힌트로 흡수한다.

상세 조회는 cluster에서 entity_type/entity_id를 따라 canonical drawer로 이동하며,
asset은 asset_id, fund는 fund_id, project는 project_id와 parent/child scope, party는 exposure row와 fund_id를 기준으로 다시 관계를 조회한다.
```

---

## 18. 현재 구조의 핵심 판단

```mermaid
mindmap
  root((RA Dashboard))
    DB Contract
      Canonical master
        funds
        asset_master
        projects
      Link tables
        asset_fund_links
        asset_project_links
      Fact tables
        lender_exposures
        beneficiary_exposures
        asset_fund_aum_inputs
    Interpretation
      asset_project_link_resolution
      relationship_index_entities
      relationship_index_edges
      relationship_index_tokens
      portfolio_search_results_canonical
    UI
      Search tabs
      Relationship clusters
      Canonical asset cards
      Detail panel
      Drawers
    Rules
      No duplicate display entities
      Same query same result
      Entity root over broad topic
      Same display method in all tabs
      Legacy fallback lower priority
    Verification
      deterministic sample tests
      live cluster contract
      operational audit
```
