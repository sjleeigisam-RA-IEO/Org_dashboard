# 모델별 업무 분담 기준

작성 기준: 2026-04-27

목적: 최근 커밋과 다음 작업 계획을 기준으로 Supabase DB 작업, 대시보드 시각화 설계, 코드 구현, 전체 관리감독 역할을 모델별로 고정한다. 이후 작업에서는 이 문서를 기준으로 업무를 배정한다.

## 1. 불러온 기준 커밋

```text
55c37ed14eab822e4ba7d43fe59de5a3ce706d49
Fix: Reconcile AUM anomaly, migrate 20260427 master data, and restore DB integrity
작성일: 2026-04-27 11:17:45 +0900
```

커밋 변경 파일:

| 파일 | 변경 | 의미 |
|---|---:|---|
| `scratch/db_gap_report.md` | 신규 | DB와 원천 데이터 간 펀드 누락 및 스키마 이슈 기록 |
| `walkthrough.md` | 신규 | 대시보드 UI/UX 및 기능 고도화 결과 보고 |

현재 작업 기준 문서:

| 파일 | 역할 |
|---|---|
| `NEXT_WORK_PLAN.md` | DB 보완, lifecycle/runoff, 대시보드 개편의 우선순위 계획 |
| `setup_schema.sql` | 현재 기본 Supabase 테이블 구조 |
| `migrations/2026-04-24_add_notion_search_fields.sql` | 기존 migration 작성 패턴 |
| `dashboard/app.js` | 현재 대시보드 검색, 분석, 차트, 드릴다운 로직 |
| `dashboard/data/aum_history.json` | 대시보드 시계열 입력 데이터 |

## 2. 역할 원칙

| 역할 | 담당 모델 | 담당 범위 | 수정 가능 영역 |
|---|---|---|---|
| 전체 관리감독 | GPT-5.5 | 작업 분해, 우선순위 조정, 산출물 통합, 최종 검수 | 전체 |
| Supabase SQL/DB 규칙 정리 | GPT-5.4-mini | DB 스키마, migration, 적재 규칙, 검증 쿼리, 데이터 품질 체크리스트 | `migrations/`, `setup_schema.sql`, `scratch/*db*`, `scratch/*source*` |
| 대시보드 시각화 로직 설계 | GPT-5.5 | Lifecycle & Runoff, AUM Snapshot Bridge, Capital Formation, drill-down 계산 로직 설계 | 설계 문서, `dashboard/` 로직 방향 |
| 대시보드 코드 구현 | GPT-5.4 | 5.5가 설계한 로직을 `dashboard/app.js`, `dashboard/style.css`, `dashboard/index.html`에 반영 | `dashboard/` |

## 3. 업무 패키지

### 3.1 Supabase SQL/DB 작업: GPT-5.4-mini

규칙 기반으로 정리할 작업:

1. `fund_lifecycle` 테이블 생성
   - 원천: `_archive/펀드 관리_*.xlsx`
   - 핵심 파생값: `expected_exit_date`, `lifecycle_state`, `runoff_eligible`
   - 검증: DB `funds`와 원천 펀드 universe 차이, 상태 불일치, 날짜 이상치

2. `fund_aum_snapshots` 테이블 생성
   - 원천: `_archive/펀드 AUM 관리_*.xlsx`
   - 핵심 키: `fund_id + base_date + source_file_type`
   - 검증: 최신 운용 AUM 합계, 청산 포함 snapshot 합계, 중복 row

3. `fund_runoff_projection` view 또는 materialized view 생성
   - 조인: `fund_lifecycle` + `fund_aum_snapshots`
   - 1차 시나리오: 신규 설정 0건, expected exit date에 전액 감소
   - 예외: `2999-12-31`, `9999-12-31` 등 장기/영구형 별도 분류

4. `fund_group_inference` 테이블 생성
   - 목적: 펀드 그룹 단위 runoff 및 AUM 중복 제거
   - 기준: 펀드코드, 약칭, 펀드명, 설정일, 만기일, 자산명/PNU, Notion 분류

5. 대주/수익자 snapshot key 개선
   - 보완 컬럼: `source_file`, `source_row_id`, `base_date`, `tranche`, `raw_name`, `clean_name`, `fund_id`
   - 목적: upsert 병합 오류 방지

권장 산출물:

| 파일 | 목적 |
|---|---|
| `migrations/2026-04-27_create_fund_lifecycle.sql` | `fund_lifecycle` 테이블 |
| `migrations/2026-04-27_create_fund_aum_snapshots.sql` | `fund_aum_snapshots` 테이블 |
| `migrations/2026-04-27_create_fund_runoff_projection_view.sql` | `fund_runoff_projection` view |
| `migrations/2026-04-27_create_fund_group_inference.sql` | `fund_group_inference` 테이블 |
| `migrations/2026-04-27_harden_snapshot_keys.sql` | 대주/수익자 snapshot key 강화 |
| `scratch/load_fund_lifecycle.py` | 펀드관리 Excel 적재 |
| `scratch/load_fund_aum_snapshots.py` | AUM Excel snapshot 적재 |
| `scratch/load_fund_group_inference.py` | 펀드 그룹 추론 적재 |
| `scratch/rebuild_snapshot_keys.py` | 기존 대주/수익자 row key 재구성 |
| `scratch/verify_fund_lifecycle.py` | lifecycle 적재 검증 |
| `scratch/verify_fund_aum_snapshots.py` | AUM snapshot 적재 검증 |
| `scratch/verify_fund_runoff_projection.py` | runoff view 검증 |
| `scratch/verify_fund_group_inference.py` | 그룹 추론 검증 |
| `scratch/verify_snapshot_keys.py` | snapshot key 중복 검증 |
| `scratch/db_lifecycle_validation.md` | 검증 결과 보고 |

DB 작업 권장 순서:

1. `fund_lifecycle` 먼저 생성한다.
2. `fund_aum_snapshots` 적재 체계를 만든다.
3. snapshot key를 강화해 중복 병합 재발을 방지한다.
4. `fund_runoff_projection` view를 생성한다.
5. `fund_group_inference`는 마지막에 규칙을 다듬어 정교화한다.

### 3.2 대시보드 시각화 로직 설계: GPT-5.5

설계할 분석 화면:

1. Executive Overview
   - 현재 운용 AUM, 청산 포함 누적 universe, runoff 위험액, 향후 12/24/36개월 감소 예정액

2. Lifecycle & Runoff
   - 연도/분기별 expected exit wall
   - 잔존 AUM curve
   - 섹터/부서/vehicle별 runoff contribution
   - 차트 클릭 시 해당 기간의 Top fund/project/lender/beneficiary drill-down

3. AUM Snapshot / Bridge
   - active snapshot vs all snapshot 비교
   - 신규 설정, 청산, 해지, 상태 변경에 따른 AUM bridge

4. Capital Formation
   - 대주/수익자 발생 기준 capital formation trend
   - 기간별 Top 5/10 플레이어 ranking
   - 특정 연도 클릭 시 대주단/수익자 상세 패널 표시

현재 대시보드에서 확인된 우선 수정 포인트:

| 항목 | 현 상태 | 수정 방향 |
|---|---|---|
| `dashboard/data/aum_history.json` | 2010-2025, 384행, `year / region / sector / aum / loan / equity` 구조 | 연도별로 지역/섹터 전체를 합산해 사용 |
| `renderHistory()` | `find()`로 첫 행만 잡아 지역/섹터 합산이 과소 계산될 수 있음 | `aggregateHistory(history, keyField, metric)` 기반 `sum by year + dimension`으로 교체 |
| `renderDrillDown()` | 랜덤 Top 5 시뮬레이션 | `drilldownContext = {view, period, category, metric}` 기반 실데이터 Top 5로 교체 |

공통 데이터 레이어:

| 항목 | 기준 |
|---|---|
| 입력 | `funds`, `fund_lifecycle`, `fund_aum_snapshots`, `lender_exposures`, `beneficiary_exposures`, `dashboard/data/aum_history.json` |
| 공통 helper | `sumBy(rows, dims, metric)`, `parseDateSafe()`, `periodKey(date, 'year|quarter')`, `latestSnapshotByFund(baseDate)`, 기존 `formatNumber()` |
| 기준 ID | `group_id = parent_fund_id || fund_id`; 그룹 추론 view 생성 후에는 `inferred_group_id` 우선 |
| 금액 단위 | 내부 원 단위 유지, 차트 표시 단계에서만 억원/조원 변환 |
| fallback | 신규 테이블/view가 없으면 기존 `funds.metadata.benchmark_aum`과 `aum_history.json`으로 Overview만 정상 렌더 |

설계 산출물은 GPT-5.4 구현자가 바로 옮길 수 있도록 다음 형식으로 작성한다.

```text
input data
calculation steps
UI sections
chart types
event/drill-down rules
empty/error states
test points
```

핵심 설계:

| 화면 | 계산 로직 | UI/이벤트 | 테스트 포인트 |
|---|---|---|---|
| Lifecycle & Runoff | 최신 active snapshot 선택, `expected_exit_date = termination_date || maturity_date`, runoff 대상만 exit quarter별 전액 감소 반영, `2999/9999` 만기는 perpetual bucket | KPI 4개, 잔존 AUM area chart, 분기별 runoff bar, 부서/섹터/vehicle별 heatmap, 만기 wall table. 분기 bar 클릭 시 exit fund list | active AUM이 최신 snapshot 합계와 일치, 누적 runoff + 최종 remaining = 시작 AUM, 만기미상은 일반 runoff 제외 |
| AUM Snapshot Bridge | 기준일 A/B outer join, `delta = end - start`, `new_setup / increase / decrease / runoff_or_liquidated / unchanged / data_adjustment` 분류 | snapshot selector, waterfall chart, 증가/감소 Top movers, 청산잔액 경고. segment 클릭 시 펀드 목록 | waterfall 최종값이 최신 snapshot 합계와 일치, 신규/청산이 increase/decrease와 중복되지 않음 |
| Capital Formation | Debt는 대주 날짜, Equity는 수익자 투자일 또는 설정일 기준 bucket, `loan / equity / total` 집계, player별 Top N 및 concentration | Total/Equity/Debt toggle, stacked area, Top 대주/수익자 ranking, player x sector/year heatmap, runoff gap card | Debt 합계 = `lender_exposures.drawn_amt`, Equity 합계 = `beneficiary_exposures.invested_amt`, 날짜 누락은 `unknown_date` bucket |

### 3.3 대시보드 코드 구현: GPT-5.4

5.5 설계 완료 후 수행한다.

구현 대상:

| 파일 | 작업 |
|---|---|
| `dashboard/app.js` | 데이터 fetch, 집계 함수, chart series 생성, drill-down 이벤트 |
| `dashboard/index.html` | Lifecycle & Runoff 탭/패널/필터 구조 |
| `dashboard/style.css` | 차트 패널, 토글, 드릴다운, 반응형 레이아웃 |
| `dashboard/data/aum_history.json` | 필요 시 임시/샘플 시계열 구조 보강 |

구현 규칙:

- DB schema 변경은 직접 하지 않는다.
- 5.5 설계 문서의 계산 규칙을 우선한다.
- 데이터가 아직 없는 영역은 mock이 아니라 빈 상태와 fallback 메시지로 처리한다.
- 기존 검색/상세 패널 기능을 깨지 않도록 변경 범위를 제한한다.
- 차트별로 직접 계산하지 않고 `runoffRows`, `bridgeRows`, `capitalRows` 중간 배열을 먼저 만든다.
- `renderHistory()`는 `aggregateHistory()` 기반으로 바꿔 `find()`로 인한 과소 계산을 제거한다.
- `renderDrillDown()`은 랜덤 시뮬레이션을 제거하고 실데이터 목록을 렌더한다.

구현 순서:

1. `renderHistory()`를 `aggregateHistory(history, keyField, metric)` 기반으로 교체한다.
2. `loadDashboardData()`를 추가해 lifecycle/snapshot/lender/beneficiary/history를 한 번에 로딩한다.
3. `buildRunoffModel()`, `buildSnapshotBridge()`, `buildCapitalFormation()` 순서로 순수 계산 함수를 작성한다.
4. 기존 `renderAnalytics()` 내부에 3개 분석 섹션을 탭 또는 segmented control로 추가한다.
5. `renderDrillDown()`을 `drilldownContext` 기반 실데이터 목록 렌더로 교체한다.

## 4. 관리감독 체크리스트: GPT-5.5

작업 통합 시 확인할 사항:

- DB migration과 dashboard fetch 컬럼명이 일치하는가
- `fund_id`, `base_date`, `source_file_type` 등 핵심 키가 중복/누락 없이 유지되는가
- lifecycle/runoff 계산이 원천 날짜 기준과 충돌하지 않는가
- 대시보드가 데이터 없음/부분 적재 상태에서도 깨지지 않는가
- 최신 AUM snapshot 합계가 `72,977,731,926,291`과 재검증되는가
- 청산/미설정/설정예정 펀드가 active AUM 분석에 섞이지 않는가
- 차트 클릭 drill-down이 같은 기준 기간과 지표를 사용하고 있는가

## 5. 다음 실행 순서

1. GPT-5.4-mini가 Supabase SQL/DB migration 및 적재/검증 규칙을 확정한다.
2. GPT-5.5가 Lifecycle & Runoff 중심의 대시보드 시각화 로직을 확정한다.
3. GPT-5.4가 5.5 설계 기준으로 `dashboard/` 코드를 수정한다.
4. GPT-5.5가 DB schema, dashboard fetch, 차트 결과, empty state를 통합 검수한다.
5. 검증 결과를 `NEXT_WORK_PLAN.md` 또는 별도 validation 문서에 반영한다.
