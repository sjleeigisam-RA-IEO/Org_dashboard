# Relationship Cache Refresh Runbook

작성일: 2026-06-10
대상: RA Dashboard relationship search/index cache
실행 위치: Supabase SQL Editor

---

## 1. 언제 실행하나

다음 변경 후 실행한다.

- `asset_master` 표시명/cleanup 관련 컬럼 변경
- `asset_fund_links`, `asset_project_links`, `project_asset_relationships` 변경
- `projects.parent_project_id`, `projects.project_name`, `projects.primary_asset_id` 변경
- `lender_exposures`, `beneficiary_exposures` 적재 또는 정리
- `relationship_index_entities`, `relationship_index_edges`, `relationship_index_tokens`를 바꾸는 migration 적용

핵심 이유:

```text
portfolio_search_results_canonical
  -> relationship_index_search_results_cache materialized view 기반

relationship_index_audit
  -> relationship_index_audit_cache materialized view 기반
```

따라서 원천 관계가 바뀌어도 cache refresh 전까지 대시보드 검색 표면은 이전 해석을 볼 수 있다.

---

## 2. 실행 SQL

파일:

```text
01. RA Portal/migrations/2026-06-10_refresh_relationship_caches.sql
```

SQL Editor에서 해당 파일 내용을 그대로 실행한다.

```sql
set statement_timeout = '5min';

refresh materialized view public.relationship_index_search_results_cache;
refresh materialized view public.relationship_index_audit_cache;

select pg_notify('pgrst', 'reload schema');
```

주의:

- 이 작업은 live DB cache를 갱신하는 DB mutation이다.
- 읽기 전용 audit 스크립트는 이 SQL을 자동 실행하지 않는다.
- 검색 결과가 이상하거나 명칭 변경 직후라면 먼저 이 refresh를 실행한 뒤 audit을 다시 돌린다.

---

## 3. 실행 후 확인 SQL

```sql
select entity_type, count(*) as rows
from public.portfolio_search_results_canonical
group by entity_type
order by entity_type;
```

```sql
select issue_type, count(*) as rows
from public.relationship_index_audit
group by issue_type
order by issue_type;
```

```sql
select entity_type, entity_id, display_title, relation_type, token_row_count
from public.portfolio_search_results_canonical
where token_text ilike '%이오타서울%'
order by rank_weight desc
limit 50;
```

```sql
select entity_type, entity_id, display_title, relation_type, token_row_count
from public.portfolio_search_results_canonical
where token_text ilike '%국민연금%'
order by rank_weight desc
limit 50;
```

---

## 4. 로컬 audit 재실행

refresh 후 로컬에서 다시 실행한다.

```powershell
python 01. RA Portal\tools\data-reconciliation\audit_dashboard_operational_contract.py
```

확인할 파일:

```text
01. RA Portal/output/dashboard_operational_contract_20260610/dashboard_operational_contract_audit.md
01. RA Portal/output/dashboard_operational_contract_20260610/display_parity.csv
01. RA Portal/output/dashboard_operational_contract_20260610/hydration_risk.csv
01. RA Portal/output/dashboard_operational_contract_20260610/party_coverage.csv
01. RA Portal/output/dashboard_operational_contract_20260610/cluster_explainability.csv
```

---

## 5. 이상 징후별 조치

| 징후 | 원인 후보 | 조치 |
|---|---|---|
| 검색 결과 명칭이 예전 값 | search cache stale | refresh SQL 실행 |
| DB에는 관계가 있는데 검색 결과에 없음 | token 생성 규칙 누락 | `relationship_index_tokens` source 보강 후 refresh |
| 검색 결과는 있는데 drawer 내용이 부족 | hydrate 대상 누락 또는 limit | `hydratePortfolioSearchRows()` 또는 drawer pagination 수정 |
| 대주/수익자 drawer 일부만 표시 | exposure hydrate cap 초과 | party drawer에서 name 기반 pagination 추가 |
| 같은 entity가 여러 카드로 표시 | canonical result/entity dedupe 실패 | `portfolio_search_results_canonical` group key와 UI `canonicalEntityId()` 확인 |
