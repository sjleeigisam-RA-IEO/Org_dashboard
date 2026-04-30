# 다음 작업 계획

작성 기준: 2026-04-26  
목적: 현재 DB 적재 수준과 목표 대시보드 수준의 차이를 정리하고, 2026-04-27 이후 작업 순서를 명확히 한다.

## 1. 오늘 확인한 핵심 결론

### 1.1 총괄 원천 판단

현재 기준으로 펀드 universe와 lifecycle의 총괄 원천은 `_archive/펀드 관리_20260424.xlsx`가 가장 적합하다.

| 원천 | 고유 펀드 수 | 상태 정보 | AUM 정보 | 해석 |
|---|---:|---|---|---|
| `펀드 관리_20260424.xlsx` | 1,099 | 운용/청산/미설정/설정예정 | 없음 | 전체 펀드 universe, lifecycle 총괄 |
| `펀드 AUM 관리_20251224_all.xlsx` | 863 | 운용/청산 포함 | 있음 | 청산 포함 AUM snapshot |
| `펀드 AUM 관리_20260112.xlsx` | 377 | 운용 중심 | 있음 | 최신 운용 AUM snapshot |

`펀드 관리`에는 `설정일`, `만기일`, `해지일`, `운용상태`, `AUM합산대상여부`가 있으므로 lifecycle/runoff 분석의 기준으로 사용한다.

### 1.2 현재 DB 적재 수준

현재 Supabase `funds` 테이블은 대시보드 검색/현황 분석에는 유효하지만, lifecycle/runoff 분석의 총괄 DB로는 부족하다.

| 비교 기준 | 결과 |
|---|---:|
| DB `funds` 고유 펀드 | 580 |
| `펀드 관리` 고유 펀드 | 1,099 |
| DB와 `펀드 관리` 교집합 | 579 |
| `펀드 관리`에는 있으나 DB에는 없는 펀드 | 520 |
| DB와 최신 운용 AUM 파일 교집합 | 377 |
| 최신 운용 AUM 파일 중 DB에 없는 펀드 | 0 |

DB `funds.metadata.benchmark_aum`은 `펀드 AUM 관리_20260112.xlsx`와 정확히 일치한다.

| 항목 | 결과 |
|---|---:|
| DB benchmark AUM non-null | 377 |
| DB benchmark AUM 합계 | 72,977,731,926,291 |
| 최신 운용 AUM 파일 AUM 합계 | 72,977,731,926,291 |
| DB vs 최신 운용 AUM exact match | 377 |

따라서 현재 DB는 **최신 운용 AUM snapshot은 잘 반영되어 있으나**, 청산/미설정/설정예정 및 전체 lifecycle universe는 아직 반영되지 않았다.

### 1.3 상태 불일치 체크포인트

DB와 `펀드 관리`의 교집합 579건에서는 상태 불일치가 없다.  
다만 DB/펀드관리와 AUM 파일 간에는 기준일 차이로 보이는 상태 불일치가 있다.

| 비교 | 상태 불일치 |
|---|---:|
| 펀드관리 vs AUM all | 23 |
| DB vs AUM all | 17 |
| DB vs AUM active | 17 |

이 항목들은 내일 업데이트된 AUM 파일 수령 후 재검증한다.

## 2. 목표 대시보드 기준 데이터 보완 방향

목표 대시보드는 단순 조회 화면이 아니라 다음 분석을 지원해야 한다.

- 현재 운용 AUM 현황
- 청산 포함 누적 펀드 universe
- 설정/해지/청산 lifecycle
- 신규 프로젝트가 없을 때의 AUM runoff curve
- 연도별 만기/해지 wall
- 섹터/부서/vehicle별 잔존 AUM 및 감소 예정액
- AUM 유지에 필요한 신규 설정 필요액
- 대주/수익자 발생 기준 capital formation
- 데이터 품질 및 누락 검증

이를 위해 현재 `funds` 테이블을 직접 확장하기보다, lifecycle/snapshot 전용 테이블을 추가하는 방식이 적합하다.

## 3. 1순위 작업: `fund_lifecycle`

### 3.1 목적

펀드별 생애주기 정보를 snapshot 형태로 저장한다. 과거 상태 이력을 원천 시스템에서 직접 받을 수 없으므로, 조회시점별 최신 Excel을 계속 쌓아 lifecycle snapshot을 만든다.

### 3.2 1차 원천

- `_archive/펀드 관리_20260424.xlsx`
- 내일 이후 업데이트되는 최신 `펀드 관리_*.xlsx`

### 3.3 주요 컬럼

```text
fund_id
short_name
fund_name
status
setup_date
maturity_date
termination_date
aum_include_yn
parent_fund_id
dept
manager
source_file
snapshot_date
vintage_year
termination_year
expected_exit_date
lifecycle_state
runoff_eligible
```

### 3.4 파생 규칙

```text
expected_exit_date = termination_date if exists else maturity_date

lifecycle_state =
  liquidated       if status = 청산 or termination_date <= 기준일
  planned          if status in (미설정, 설정예정)
  active           if status = 운용 and expected_exit_date is empty or future
  future_exit      if status = 운용 and expected_exit_date is future
  unknown          otherwise
```

## 4. 2순위 작업: `fund_aum_snapshots`

### 4.1 목적

기준일별 AUM을 보존한다. 기존 AUM 파일은 덮어쓰지 않고 snapshot으로 누적한다.

### 4.2 1차 원천

- `_archive/펀드 AUM 관리_20251224_all.xlsx`
- `_archive/펀드 AUM 관리_20260112.xlsx`
- 내일 업데이트될 최신 AUM 파일

### 4.3 주요 컬럼

```text
fund_id
short_name
fund_name
status_at_source
base_date
aum
committed_equity
committed_debt
lease_deposit
source_file
snapshot_loaded_at
is_all_file
is_active_file
```

### 4.4 원칙

- `*_all` 파일은 청산 포함 AUM snapshot으로 보존한다.
- 최신 운용 AUM 파일은 active snapshot으로 보존한다.
- 같은 `fund_id + base_date + source_file_type`은 업데이트하고, 다른 기준일은 추가 적재한다.
- 청산 펀드의 과거 AUM은 runoff/청산 규모 분석을 위해 보존한다.

## 5. 3순위 작업: runoff 분석 테이블 또는 view

`fund_lifecycle`과 `fund_aum_snapshots`를 만든 뒤 파생 view로 생성한다.

```text
fund_runoff_projection
- fund_id
- group_id
- sector
- dept
- base_date
- current_aum
- expected_exit_date
- runoff_year
- runoff_quarter
- runoff_aum
- remaining_aum_after_exit
```

1차 시나리오:

- 신규 설정 0건
- 현재 운용 AUM이 expected exit date에 전액 감소
- 만기일이 `2999-12-31`, `9999-12-31` 등인 경우 장기/영구형으로 별도 분류

추후 시나리오:

- 과거 평균 신규 설정액 유지
- 목표 성장률 유지
- 부서/섹터별 목표 AUM 유지

## 6. 4순위 작업: 펀드 그룹 추론

원천 데이터에 명확한 그룹 코드가 없으므로 이름/코드/날짜/Notion 분류를 조합해 추론한다.

```text
fund_group_inference
- fund_id
- inferred_group_id
- inferred_group_name
- group_type
- basis
- confidence_score
- manual_confirmed
- note
```

추론 기준:

- 펀드코드 연속성
- 약칭 유사성
- 펀드명 유사성
- 설정일/만기일 유사성
- 자산명/PNU 유사성
- Notion Project & Mission 이름
- AUM합산대상여부

이 작업은 AUM 중복 제거와 전략 단위 runoff 분석에 필요하다.

## 7. 5순위 이후 작업 목록

### 7.1 대주/수익자 snapshot key 개선

현재 upsert key가 일부 row를 병합한다.

- 대주: 원천 683행 중 유효 682행, DB 579행
- 수익자: 원천 1,123행 중 유효 1,122행, DB 1,094행

보완 컬럼:

```text
source_file
source_row_id
base_date
tranche
raw_name
clean_name
fund_id
```

### 7.2 프로젝트/자산/펀드 연결 고도화

```text
project_id
project_mission_name
fund_id
asset_id
pnu
parent_fund_id
```

목적:

- 프로젝트 단위 AUM
- 동일 자산 투자자 구성
- 모펀드/자펀드 구조 분석

### 7.3 대시보드 개편

우선순위:

1. Executive Overview
2. Lifecycle & Runoff
3. AUM Snapshot / Bridge
4. Capital Formation
5. Asset & Sector Exposure
6. Lender Analysis
7. Beneficiary Analysis
8. Market Data
9. Data Quality

### 7.4 데이터 품질 관리

관리할 이슈:

- 펀드관리에는 있으나 DB에는 없는 펀드
- AUM 파일에는 있으나 펀드관리에는 없는 합계/오류성 row
- 상태 불일치 펀드
- 청산인데 AUM이 남아 있는 펀드
- 운용인데 해지일이 있는 펀드
- 만기일이 과거인데 운용 상태인 펀드
- PNU/좌표/건축물대장 누락 자산
- Notion 분류 누락 펀드

## 8. 내일 바로 할 작업 순서

1. 업데이트된 AUM 파일을 `_archive/`에 추가한다.
2. `scratch/compare_fund_sources.py`를 새 파일명에 맞게 업데이트하거나 자동 탐색형으로 개선한다.
3. `scratch/compare_db_to_fund_sources.py`로 DB와 신규 AUM 파일을 재대조한다.
4. Supabase에 `fund_lifecycle` 테이블을 생성한다.
5. `펀드 관리_20260424.xlsx`를 `fund_lifecycle` v1으로 적재한다.
6. Supabase에 `fund_aum_snapshots` 테이블을 생성한다.
7. 기존 AUM all/active와 신규 AUM 파일을 snapshot으로 적재한다.
8. `fund_lifecycle` + `fund_aum_snapshots`를 조인해 runoff candidate view를 만든다.
9. 신규 프로젝트 0건 가정 AUM runoff chart용 JSON/view를 생성한다.
10. 대시보드에 Lifecycle & Runoff 탭을 추가한다.

## 9. 오늘 남긴 산출물

| 파일 | 역할 |
|---|---|
| `scratch/compare_fund_sources.py` | 펀드관리/AUM 원천 파일 비교 스크립트 |
| `scratch/fund_source_comparison.json` | 원천 파일 비교 결과 |
| `scratch/fund_source_comparison.md` | 원천 파일 비교 요약 |
| `scratch/compare_db_to_fund_sources.py` | Supabase `funds`와 원천 파일 대조 스크립트 |
| `scratch/db_fund_source_reconciliation.json` | DB-원천 대조 결과 |
| `scratch/db_fund_source_reconciliation.md` | DB-원천 대조 요약 |
| `NEXT_WORK_PLAN.md` | 다음 작업 계획 |

