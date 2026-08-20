# 2026-06-08 DB Sources vs Supabase 업데이트 후보 점검

작성일: 2026-06-08

## 1. 작업 범위

`00. Raw Data` 폴더에 오늘 받은 엑셀 6개를 Supabase 현재 DB와 읽기 전용으로 비교했다.

DB 수정은 하지 않았다. 이 문서는 “바로 반영할 내용”이 아니라 “수정 후보와 검토 포인트”다.

## 2. 오늘자 원본 파일

| 파일 | 행 x 열 | 비고 |
|---|---:|---|
| `펀드 관리_20260608.xlsx` | 1,111 x 59 | 펀드 마스터 |
| `펀드 AUM 관리_20260608.xlsx` | 368 x 33 | 헤더 2행 구조, 실제 header=1 |
| `투자 자산 조회_20260608.xlsx` | 693 x 42 | 펀드-자산 원천 관계 |
| `투자 자산 관리_20260608.xlsx` | 788 x 56 | 자산코드/자산 속성 |
| `대주 정보 조회_20260608.xlsx` | 688 x 28 | 대주 exposure |
| `수익자 정보 조회_20260608.xlsx` | 1,140 x 24 | 수익자 exposure |

5월 15일 원본 대비 큰 변화:

- `펀드 관리`: 1,103 -> 1,111
- `펀드 AUM`: 875 -> 368
- `투자 자산 조회`: 1,032 -> 693
- `대주`: 798 -> 688
- `수익자`: 1,159 -> 1,140
- `투자 자산 관리`: 788 유지

## 3. Supabase 현재 상태

읽기 전용 REST 조회 기준:

| 테이블/뷰 | 현재 row count | 비고 |
|---|---:|---|
| `funds` | 1,103 | `fund_id` unique |
| `asset_master` | 1,302 | `asset_code` blank/중복 존재 |
| `asset_fund_links` | 1,151 | `asset_id + fund_id` unique |
| `asset_building_ledger` | 396 | Hub API 392건 |
| `lender_exposures` | 670 | 기준일자 전부 2026-04-30 |
| `beneficiary_exposures` | 1,118 | 기준일자 전부 2026-04-30 |

중요한 기준일:

- `funds.aum_source`: 전 row `펀드 AUM 관리_20260515.xlsx`
- `funds.aum_base_date`: `2026-04-30` 826건, blank 277건
- `lender_exposures.base_date`: 전 row `2026-04-30`
- `beneficiary_exposures.base_date`: 전 row `2026-04-30`

따라서 오늘자 `2026-05-31` 원본과 다른 것은 상당 부분 정상적인 월말 업데이트 후보로 보인다.

## 4. 산출물

| 산출물 | 용도 |
|---|---|
| `01. RA Portal/output/reconciliation_20260608/update_candidate_summary.json` | 전체 비교 요약 |
| `01. RA Portal/output/reconciliation_20260608/all_update_candidates.csv` | 전체 후보 통합 CSV |
| `01. RA Portal/output/reconciliation_20260608/fund_update_candidates.csv` | 펀드 마스터 후보 |
| `01. RA Portal/output/reconciliation_20260608/fund_aum_change_candidates.csv` | AUM 기준일/금액 후보 |
| `01. RA Portal/output/reconciliation_20260608/asset_update_candidates.csv` | 자산 마스터/물리 필드 후보 |
| `01. RA Portal/output/reconciliation_20260608/fund_asset_pair_candidates.csv` | 펀드-자산 관계 후보 |
| `01. RA Portal/output/reconciliation_20260608/exposure_change_candidates.csv` | 대주/수익자 exposure 후보 |
| `01. RA Portal/tools/data-reconciliation/reconcile_20260608_excel_vs_supabase.py` | 재실행 가능한 비교 스크립트 |

## 5. 전체 후보 수

최종 보정 후 전체 후보는 4,415건이다.

| 영역 | 후보 유형 | 건수 | 해석 |
|---|---|---:|---|
| 펀드 마스터 | 필드 변경 후보 | 152 | 일부 상태/만기/해지/담당/분류 변화 |
| 펀드 마스터 | 신규 펀드 후보 | 9 | Supabase `funds`에 없는 펀드 |
| 펀드 마스터 | 오늘 원본에 없는 DB 펀드 | 1 | 삭제 금지, 범위 확인 필요 |
| AUM | 기준일자 변경 후보 | 324 | 2026-04-30 -> 2026-05-31 전환 후보 |
| AUM | 금액 변경 후보 | 480 | 월말 AUM 업데이트 후보 |
| AUM | source에는 있으나 DB fund 없음 | 3 | 신규 펀드/AUM 후보 |
| 자산 마스터 | 필드 변경 후보 | 2,517 | 원본값/API값/provenance 분리 필요 |
| 펀드-자산 관계 | source pair가 DB exact pair에 없음 | 153 | 신규/정제/추론 관계 검토 |
| 펀드-자산 관계 | DB pair가 오늘 원본에 없음 | 467 | 과거/추론/합성/범위 외 관계 가능 |
| 대주 exposure | 금액 합계 변경 후보 | 49 | 2026-05-31 기준 업데이트 후보 |
| 수익자 exposure | 금액 합계 변경 후보 | 239 | 2026-05-31 기준 업데이트 후보 |
| 대주/수익자 exposure | source에는 있고 DB에는 없음 | 2 | R00008, R00010 |
| 대주/수익자 exposure | DB에는 있고 오늘 source에는 없음 | 19 | 삭제 금지, 범위 확인 필요 |

## 6. 바로 눈에 띄는 업데이트 후보

### 6.1 신규 펀드 후보 9개

`funds`에 없는 오늘자 source fund:

| fund_id | fund_name |
|---|---|
| 120124 | 이지스부동산대출일반사모부동산투자신탁제2호(1종) |
| 120125 | 이지스부동산대출일반사모부동산투자신탁제2호(2종) |
| 120126 | 이지스 NPL 리스트럭처링일반사모부동산투자신탁 |
| 200046 | 이지스글로벌인프라일반사모투자신탁제7호 |
| 300086 | 이지스 멀티플러스 일반사모투자신탁 제3호 |
| 300087 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class A) |
| 300088 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C) |
| 300089 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C-S) |
| 300090 | 이지스그린ON 일반사모투자신탁제5호 |

이 중 AUM 원본에도 등장하는 DB 누락 fund는 3개다.

- `200046`
- `300086`
- `300090`

### 6.2 펀드 상태/일자 변경 후보

주요 상태/일자 변화 예시:

| fund_id | field | source | current DB |
|---|---|---|---|
| 112442 | status | 청산 | 운용 |
| 112474 | status | 청산 | 운용 |
| 112557 | status | 청산 | 운용 |
| 112065 | termination_date | 2026-04-30 | blank |
| 112174 | termination_date | 2026-04-30 | blank |
| 112201 | termination_date | 2026-04-30 | blank |
| 112442 | termination_date | 2026-05-22 | blank |
| 112474 | termination_date | 2026-05-28 | blank |
| 112557 | termination_date | 2026-05-28 | blank |

주의: `maturity_date=2999-12-31` 또는 `9999-12-31` 같은 값은 실제 만기라기보다 무기한/placeholder일 수 있으므로 그대로 덮어쓰기 전에 규칙 확인이 필요하다.

### 6.3 AUM 변경 후보

AUM은 DB가 아직 2026-04-30 기준이고 source가 2026-05-31 기준이라 변경 후보가 정상적으로 많이 나온다.

| field | 변경 후보 수 |
|---|---:|
| `benchmark_aum` | 155 |
| `equity_won` | 122 |
| `invested_aum` | 75 |
| `invested_equity_won` | 37 |
| `invested_loan_won` | 31 |
| `loan_won` | 28 |
| `invested_deposit_won` | 16 |
| `deposit_won` | 16 |

큰 차이 예시:

| fund_id | source benchmark_aum | DB benchmark_aum | 차이 |
|---|---:|---:|---:|
| P00040 | 103,700,000,000 | 0 | +103,700,000,000 |
| 112665 | 582,736,338 | 74,274,518,578 | -73,691,782,240 |
| R00010 | 176,872,731,464 | 126,872,731,464 | +50,000,000,000 |
| 112333 | 312,382,020,277 | 281,320,526,581 | +31,061,493,696 |
| 112587 | 232,263,947,114 | 218,126,975,278 | +14,136,971,836 |

### 6.4 Exposure 변경 후보

대주/수익자 상세 테이블은 현재 DB가 `2026-04-30`, 오늘 source가 `2026-05-31`이다.

| 영역 | 금액 합계 변경 후보 |
|---|---:|
| 대주 exposure | 49 |
| 수익자 exposure | 239 |

Source에는 있으나 DB에는 없는 exposure fund:

| 영역 | fund_id | source rows |
|---|---|---:|
| 대주 | R00008 | 1 |
| 수익자 | R00010 | 1 |

반영 전에는 fund-level 합계만 보지 말고, `fund_id + lender/beneficiary + base_date` row-level로 확인해야 한다.

## 7. 조심해야 할 후보

### 7.1 자산 마스터 2,517건

자산 변경 후보가 가장 많지만, 곧바로 update하면 위험하다.

| field | 후보 수 | 해석 |
|---|---:|---|
| `portfolio_region` | 772 | 원본에는 있으나 DB canonical layer에 미전파된 필드 성격 |
| `business_stage` | 508 | 원본 사업단계 미전파 가능성 |
| `parking` | 245 | Excel값과 API/정제값 충돌 가능 |
| `site_area` | 218 | API 보강값을 덮어쓸 위험 |
| `completion_date` | 72 | 건축물대장 기준 사용승인일과 원본 준공일 차이 가능 |
| `gross_floor_area` | 52 | API 보강값과 원본 면적 차이 가능 |
| `canonical_name` | 49 | canonical 정제명과 원본 자산명 차이 |
| `address_text` | 45 | 주소 정규화/대표필지 선택 차이 |
| `asset_type` | 40 | 원본 기초자산과 DB 분류 매핑 차이 |

특히 `site_area`, `gross_floor_area`, `completion_date`, `parking`은 `asset_building_ledger`와 `building_ledger_source=BldRgstHubService.getBrTitleInfo`를 먼저 확인해야 한다.

### 7.2 펀드-자산 관계

오늘 source에는 있는데 Supabase exact pair에는 없는 후보:

- update_candidate: 80
- review: 73

Supabase에는 있는데 오늘 source exact pair에는 없는 후보:

- info: 467

이 영역은 canonical merge, inferred link, name-only link, synthetic/portfolio asset이 섞인다. 단순히 today source에 없다고 삭제하거나, source pair가 없다고 바로 insert하면 안 된다.

## 8. 업데이트 판단 순서

추천 검토 순서:

1. 신규 펀드 9개 중 실제 생성 대상 확정
2. AUM 기준일 2026-05-31 전환 및 480개 금액 변경 후보 검토
3. 상태가 `운용 -> 청산`으로 바뀐 펀드와 termination_date 후보 검토
4. 대주/수익자 exposure는 row-level 비교 후 replace 또는 upsert 전략 결정
5. 자산의 `portfolio_region`, `business_stage`, `asset_type`은 원본 직접값 보존/전파 대상으로 검토
6. 물리/API 필드는 DB API 보강값을 덮어쓰지 않도록 별도 검토
7. 펀드-자산 관계는 canonical/inferred/synthetic provenance별로 분류 후 검토

## 9. 이번 작업에서 하지 않은 것

- Supabase DB insert/update/delete 없음
- 기존 DB 값 덮어쓰기 없음
- 원본 엑셀 수정 없음
- 후보 CSV를 실제 반영 스크립트로 변환하지 않음

이번 결과는 “수정 전 검토 큐”다.
