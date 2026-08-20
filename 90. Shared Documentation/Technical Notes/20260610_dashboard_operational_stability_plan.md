# RA Dashboard Operational Stability Plan

작성일: 2026-06-10
범위: 관계형 DB 검색 contract, dashboard read path, 운영 refresh/audit 절차
목표: 사용자가 어떤 경로로 검색하든 중복 없이 같은 canonical 결과와 같은 표시명으로 수렴하는 상태를 유지한다.

---

## 1. 목표 요약

현재 대시보드는 다음 흐름을 기준 contract로 둔다.

```text
canonical master/link/fact
  -> relationship_index_entities / relationship_index_edges / relationship_index_tokens
  -> relationship_index_search_results_cache
  -> portfolio_search_results_canonical
  -> hydratePortfolioSearchRows()
  -> buildRelationshipClusters()
  -> detail drawer
```

이번 운영 안정화 작업은 이 구조를 다시 크게 바꾸는 것이 아니라, 앞으로 DB가 바뀌거나 원천 파일이 추가되어도 contract가 흔들리지 않게 하는 5개 점검축을 고정하는 작업이다.

---

## 2. 5개 단계 목표

| 단계 | 목표 | 합격 기준 | 실행 산출물 |
|---:|---|---|---|
| 1 | Search vs Bulk Display Parity | `portfolio_search_results_canonical.display_title`과 hydrate 후 화면 표시명이 같은 entity에서 일치한다. | `display_parity.csv` |
| 2 | Materialized View Refresh Contract | canonical 관계/명칭 변경 후 어떤 cache를 refresh해야 하는지 절차가 명확하다. | refresh runbook, SQL |
| 3 | Hydration Limit Risk Audit | 검색 index 결과와 hydrate 대상 수가 app cap 안에 있고, cap 초과 위험이 CSV로 드러난다. | `hydration_risk.csv` |
| 4 | Party Drawer Coverage Check | 대주/수익자 검색 결과가 실제 exposure row 수와 hydrate limit 기준으로 잘리지 않는지 점검된다. | `party_coverage.csv` |
| 5 | Cluster Explainability | 검색된 결과마다 왜 포함됐는지 설명할 `relation_paths`, `source_table`, `token_row_count`가 남아 있다. | `cluster_explainability.csv` |

---

## 3. 수정 계획

### 3.1 Display parity

문제 가능성:

```text
검색 결과 카드: portfolio_search_results_canonical.display_title
상세/cluster hydrate: v_funds_enriched, asset_relationship_summary, projects 표시 helper
```

두 경로가 같은 fund/asset/project를 다른 이름으로 보여주면 사용자는 “검색은 됐는데 다른 데이터처럼 보이는” 느낌을 받는다.

수정 방향:

- fund 표시는 `[short_name] fund_name`으로 고정한다.
- asset 표시는 `physical_asset_name -> non_physical_asset_label -> asset_code -> asset_id` 우선순위로 고정한다.
- project 표시는 `project_name -> project_mission_name -> project_id` 우선순위로 고정한다.
- audit에서 mismatch가 나오면 우선 cache refresh 여부를 확인하고, 그래도 남으면 DB view 또는 JS 표시 helper 중 한쪽을 맞춘다.

### 3.2 Refresh contract

문제 가능성:

```text
relationship_index_search_results_cache는 materialized view라 원천 변경 후 자동 갱신되지 않는다.
```

수정 방향:

- asset 명칭 cleanup, asset/fund/project link 변경, exposure 변경 후 refresh SQL을 실행한다.
- refresh 후 대표 검색어와 surface count를 확인한다.
- SQL Editor에 붙여넣을 수 있는 BOM 없는 refresh SQL을 별도 파일로 둔다.

### 3.3 Hydration limit risk

문제 가능성:

```text
검색 index는 최대 300개, 짧은 숫자는 200개만 가져온다.
hydrate는 fund/asset/project/lender/beneficiary 각각 limit(500)이다.
```

수정 방향:

- 대표 검색어별 index total, app returned, entity type count를 기록한다.
- hydrate 대상 fund_ids, asset_ids, project_ids, exposure name expansion count를 기록한다.
- cap 초과가 확인되면 pagination, topic query limit 조정, drawer lazy-load 중 하나로 수정한다.

### 3.4 Party drawer coverage

문제 가능성:

```text
openInstitutionRelationshipDrawer()는 이미 hydrate된 exposure rows를 items로 받는다.
party exposure가 500건을 넘으면 drawer가 일부 관계만 보여줄 수 있다.
```

수정 방향:

- 검색어별 lender/beneficiary display term을 기준으로 실제 exposure count를 비교한다.
- 500건 초과 party가 생기면 drawer에서 party name 기반 추가 pagination을 수행하도록 변경한다.

### 3.5 Cluster explainability

문제 가능성:

```text
cluster builder는 DB를 직접 다시 읽지 않는다.
따라서 “왜 이 결과가 묶였는가”는 index row의 relation_paths/source_table/token_row_count에 의존한다.
```

수정 방향:

- 검색 결과마다 relation path가 있는지 audit한다.
- explainability가 약한 row는 `relationship_index_tokens` 생성 규칙을 보강한다.
- UI에 설명이 필요해질 경우 cluster detail에서 relation path preview를 노출한다.

---

## 4. 실행 방법

읽기 전용 audit:

```powershell
python 01. RA Portal\tools\data-reconciliation\audit_dashboard_operational_contract.py
```

대표 검색어를 바꾸고 싶을 때:

```powershell
python 01. RA Portal\tools\data-reconciliation\audit_dashboard_operational_contract.py `
  --query "이오타서울" `
  --query "눈스퀘어" `
  --query "국민연금" `
  --query "홈플러스" `
  --query "1120"
```

출력 위치:

```text
01. RA Portal/output/dashboard_operational_contract_20260610/
```

---

## 5. 운영 판단 기준

| 상태 | 의미 | 조치 |
|---|---|---|
| `ok` | 현재 contract를 만족한다. | 별도 수정 없음 |
| `prepared_runbook` | DB mutation은 하지 않았고 절차/SQL만 준비됐다. | SQL Editor에서 refresh 필요 시 실행 |
| `review` | 동작은 가능하지만 drift/risk가 있다. | 해당 CSV를 기준으로 view/helper/pagination 수정 |
| `count_error` | REST count가 실패했다. | SQL 적용 여부, RLS/API 노출 여부 확인 |
| `weak_explainability` | 검색 결과는 나오지만 relation evidence가 약하다. | `relationship_index_tokens` 생성 규칙 보강 |
