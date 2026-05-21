# 자산 위치/PNU/건축물대장 병합 실행 순서

## 현재 기준 파일

- 병합 계획표: `asset_location_merge_plan.csv`
- 병합 계획 요약: `asset_location_merge_plan_summary.md`
- 검색 인덱스 후보: `portfolio_search_index_candidates.csv`
- 프로젝트명 정리 기준: `project_name_cleanup_basis.csv`
- 펀드/프로젝트명 감사: `fund_project_name_consistency_audit.csv`

## 실행 순서

### 1. 낮은 위험도 직접 업데이트

- 대상 merge_action:
  - `update_asset_name_only`
  - `update_asset_master_location`
- 대상 테이블:
  - `asset_master`
- 원칙:
  - `safe_to_update_existing_asset_master=true`인 행만 기존 asset_id에 직접 반영한다.
  - PNU/좌표가 이미 같은 asset_id의 ledger와 맞는 경우부터 처리한다.

### 2. 단일 자산 업데이트 후 건축물대장 재조회

- 대상 merge_action:
  - `update_asset_master_then_fetch_ledger`
- 대상 테이블:
  - `asset_master`
  - `asset_building_ledger`
- 원칙:
  - asset_master에는 제안 PNU/주소/좌표를 반영할 수 있다.
  - 같은 asset_id+PNU의 ledger가 없으므로 PNU 기준 건축물대장 재조회 큐를 만든다.

### 3. 기존 PNU/ledger 재사용 연결

- 대상 merge_action:
  - `link_existing_underlying_asset_by_pnu`
  - `link_existing_underlying_asset_same_asset_pnu`
- 대상 테이블:
  - `asset_master`
  - `asset_fund_links`
  - `fund_assets`
- 원칙:
  - 같은 PNU가 DB 어딘가에 이미 있으면 신규 asset 생성보다 기존 asset/ledger 연결을 우선 검토한다.
  - 같은 asset_id+PNU가 이미 있으면 관계 row만 정리한다.

### 4. 다자산 펀드 하위자산 생성 및 건축물대장 재조회

- 대상 merge_action:
  - `create_underlying_asset_then_fetch_ledger`
- 대상 테이블:
  - `asset_master`
  - `asset_fund_links`
  - `fund_assets`
  - `asset_building_ledger`
- 원칙:
  - 태양광 392호/435호처럼 여러 PNU가 있는 경우 기존 대표 asset_id에 덮어쓰지 않는다.
  - 하위자산별 새 asset_id를 만들고 fund link를 생성한 뒤 PNU로 ledger를 조회한다.

### 5. 위치 없는 이름 후보 보류/검색 반영

- 대상 merge_action:
  - `create_or_link_underlying_asset_name_only`
  - `hold_name_only_no_location`
- 대상:
  - 검색 인덱스 또는 별칭 후보
- 원칙:
  - 위치/PNU가 없으므로 asset_master 위치값 업데이트에서는 제외한다.
  - 검색 가능성은 유지하되 지도/PNU/건축물대장 UI는 숨긴다.

## 중단 후 재개 체크리스트

1. `git status -sb`로 로컬 변경 확인
2. `asset_location_merge_plan.csv`의 `merge_action`별 미처리 행 확인
3. Supabase 업데이트 전에는 항상 dry-run CSV를 먼저 생성
4. 업데이트 후에는 `asset_master`, `asset_fund_links`, `asset_building_ledger` row count와 샘플을 재검증
5. 검색 UX에는 `portfolio_search_index_candidates.csv`의 `entity_type`과 `result_behavior`를 기준으로 반영
