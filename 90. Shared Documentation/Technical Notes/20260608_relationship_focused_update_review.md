# 2026-06-08 관계 중심 업데이트 검토

작성일: 2026-06-08

## 기준 변경

이번 재검토에서는 **오늘 원본에서 줄어든 row는 삭제/축소 후보로 보지 않는다.**
사용자가 확장했던 범위를 다시 좁힌 export일 수 있으므로, Supabase에 있는데 오늘 파일에 없는 데이터는 이번 판단에서 제외한다.

초점은 세 가지다.

1. 신규 row 생성 후보
2. 기존 row의 특정 컬럼 업데이트 후보
3. 펀드-자산-AUM-exposure 사이의 관계 정합성

DB 수정은 하지 않았다. Supabase는 읽기 전용으로만 조회했다.

## 산출물

| 산출물 | 설명 |
|---|---|
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/relationship_focused_update_candidates.csv` | 감소/삭제성 후보를 제거한 신규/변경 후보 |
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/new_fund_relationship_summary.csv` | 신규 fund 후보와 AUM/자산/exposure 연결 여부 |
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/fund_aum_exposure_relationship_checks.csv` | AUM과 exposure 관계상 이상 후보 |
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/source_direct_asset_field_candidates.csv` | 원본 직접값 또는 canonical 매핑 후보 |
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/api_sensitive_asset_field_candidates.csv` | API 보강값 덮어쓰기 위험 후보 |
| `01. RA Portal/output/reconciliation_20260608_relationship_focus/relationship_focus_summary.json` | 요약 JSON |
| `01. RA Portal/tools/data-reconciliation/reconcile_20260608_relationship_focus.py` | 재실행 스크립트 |

## 요약 숫자

| 항목 | 건수 |
|---|---:|
| 관계 중심 신규/변경 후보 | 3,928 |
| 신규 fund 후보 | 9 |
| AUM/exposure 관계 체크 후보 | 23 |
| 원본 직접 자산 필드 후보 | 1,414 |
| API 민감 자산 필드 후보 | 587 |

## 1. 신규 fund 후보

Supabase `funds`에는 없고, 오늘자 `펀드 관리_20260608.xlsx`에는 있는 후보는 9개다.

| fund_id | fund_name | AUM 원본 있음 | 자산 원본 관계 | 대주/수익자 원본 |
|---|---|---:|---:|---:|
| 120124 | 이지스부동산대출일반사모부동산투자신탁제2호(1종) | N | 0 | 0 |
| 120125 | 이지스부동산대출일반사모부동산투자신탁제2호(2종) | N | 0 | 0 |
| 120126 | 이지스 NPL 리스트럭처링일반사모부동산투자신탁 | N | 0 | 0 |
| 200046 | 이지스글로벌인프라일반사모투자신탁제7호 | Y | 0 | 0 |
| 300086 | 이지스 멀티플러스 일반사모투자신탁 제3호 | Y | 0 | 0 |
| 300087 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class A) | N | 0 | 0 |
| 300088 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C) | N | 0 | 0 |
| 300089 | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C-S) | N | 0 | 0 |
| 300090 | 이지스그린ON 일반사모투자신탁제5호 | Y | 0 | 0 |

관계 해석:

- `200046`, `300086`, `300090`은 AUM 원본에도 있으므로 `funds` 생성 후 AUM까지 같이 반영할 후보다.
- 9개 모두 오늘자 투자자산 조회/대주/수익자 원본에서는 직접 연결 row가 없었다.
- 따라서 신규 fund 생성과 자산/exposure 연결은 분리해서 판단해야 한다.

## 2. AUM 업데이트 후보

DB는 아직 `2026-04-30`, 오늘자 AUM 원본은 `2026-05-31` 기준이다.
따라서 AUM 차이는 오류라기보다 월말 업데이트 후보로 보는 것이 맞다.

| 유형 | 건수 |
|---|---:|
| AUM 기준일자 변경 후보 | 324 |
| AUM 금액 변경 후보 | 480 |
| AUM 원본에는 있으나 DB fund 없음 | 3 |

큰 `benchmark_aum` 변화 예시:

| fund_id | source benchmark_aum | DB benchmark_aum | 차이 |
|---|---:|---:|---:|
| P00040 | 103,700,000,000 | 0 | +103,700,000,000 |
| 112665 | 582,736,338 | 74,274,518,578 | -73,691,782,240 |
| R00010 | 176,872,731,464 | 126,872,731,464 | +50,000,000,000 |
| 112333 | 312,382,020,277 | 281,320,526,581 | +31,061,493,696 |
| 112587 | 232,263,947,114 | 218,126,975,278 | +14,136,971,836 |

관계상 체크할 후보는 23개다. 이들은 오류 확정이 아니라 AUM과 exposure가 서로 다른 개념임을 감안한 “관계 검토 큐”다.

| 관계 flag | 건수 |
|---|---:|
| exposure는 있는데 benchmark AUM이 0 | 11 |
| beneficiary committed와 invested가 AUM 대비 큼 | 3 |
| AUM 원본 fund가 Supabase에 없음 | 3 |
| lender committed가 benchmark AUM 대비 큼 | 3 |
| beneficiary invested가 invested AUM 대비 큼 | 3 |

## 3. 대주/수익자 exposure 관계

삭제/감소 후보는 제외하고, 기존 fund의 합계 업데이트와 source-only exposure만 본다.

| 영역 | 후보 |
|---|---:|
| 대주 fund-level 합계 변경 후보 | 49 |
| 수익자 fund-level 합계 변경 후보 | 239 |
| source에는 있고 DB에는 없는 대주 exposure fund | 1 (`R00008`) |
| source에는 있고 DB에는 없는 수익자 exposure fund | 1 (`R00010`) |

반영 전 필수 확인:

- fund-level 합계만으로 replace하지 말 것
- `fund_id + lender_clean/beneficiary_clean + base_date` row-level 비교 필요
- 오늘 source는 `2026-05-31`, DB는 `2026-04-30` 기준이므로 대부분은 월말 업데이트 후보일 수 있음

## 4. 펀드-자산 관계

이번 기준에서는 Supabase에만 있고 오늘 source에 없는 관계는 무시했다.
오늘 source에 있는데 Supabase exact pair에 없는 관계만 남겼다.

| 후보 유형 | 건수 |
|---|---:|
| source pair가 Supabase exact pair에 없음, 신규성 높음 | 80 |
| source pair가 Supabase exact pair에 없음, 기존 fund 후보 검토 | 73 |

주의:

- exact pair mismatch를 곧바로 insert/delete로 판단하면 안 된다.
- Supabase에는 `underlying_asset`, `inferred_underlying_asset`, `name_only_underlying_asset`, synthetic/portfolio 성격이 섞여 있다.
- 특히 canonical asset name이 원본 asset name과 다를 수 있으므로 `asset_aliases`, `asset_identifiers`, `asset_fund_links.source_table` 확인이 필요하다.

## 5. 자산 canonical/API provenance

오늘자 `투자 자산 관리_20260608.xlsx` 기준 신규 `asset_code`는 0건이다.
따라서 자산 쪽은 신규 row 생성이 아니라 기존 자산의 필드 업데이트 후보만 검토하면 된다.

자산 변경 후보는 provenance 성격에 따라 네 그룹으로 분리했다.

| 분류 | 건수 | 해석 |
|---|---:|---|
| 원본 직접값이 DB canonical blank를 채울 후보 | 1,834 cells / 773 assets | 우선 반영 검토 가능. `source_file`, `source_column`, `load_date` provenance 필요 |
| 원본 직접값이 DB 기존값과 충돌 | 2 cells / 2 assets | 자동 반영 금지. taxonomy/manual review 필요 |
| canonical 이름/주소 차이 | 94 cells / 76 assets | 원본명과 canonical 정제명의 차이일 수 있어 별도 검토 |
| API 보강값 보호 대상 | 539 cells / 216 assets | Excel 원본으로 덮어쓰면 안 되는 영역 |
| 물리 필드 원본값이 DB blank를 채울 후보 | 48 cells / 46 assets | API 미조회/not_checked 보완 queue로 분리 |

### 5.1 원본 직접값 또는 canonical 매핑 후보

| field | 건수 |
|---|---:|
| `portfolio_region` | 772 |
| `country_code` | 516 |
| `business_stage` | 508 |
| `asset_type` | 38 |

관계 해석:

- `portfolio_region`, `business_stage`, `asset_type`은 원본에는 있는데 canonical asset layer에 비어 있는 대표 축이다.
- `country_code`는 엑셀의 `국내/해외` 값을 `KR` 등으로 변환한 rule-derived 값이므로 변환 규칙 provenance도 같이 남기는 편이 맞다.
- 이 필드들은 API 보강값이 아니라 원본 직접값/분류값 성격이므로, 별도 update 후보로 검토할 만하다.
- 단, canonical asset 하나가 여러 원본 자산/펀드에 묶인 경우 어떤 값을 대표값으로 둘지 규칙이 필요하다.

원본 직접값이 DB 기존값과 충돌하는 건은 아래 2건이다. 이 둘은 blank fill이 아니라 분류체계 충돌이므로 바로 update하지 않는다.

| asset_code | field | source | DB |
|---|---|---|---|
| `A112080001` | `asset_type` | 오피스복합 | 리테일 |
| `A112085001` | `asset_type` | 오피스복합 | 리테일 |

### 5.2 API 민감 필드

| field | 건수 |
|---|---:|
| `site_area` | 212 |
| `parking` | 203 |
| `completion_date` | 72 |
| `gross_floor_area` | 52 |

관계 해석:

- 이 필드들은 `asset_building_ledger`, `BldRgstHubService.getBrTitleInfo`, VWorld/PNU 보강과 충돌할 수 있다.
- Excel 원본값이 다르다고 바로 덮어쓰면 API로 보강한 정합성을 깨뜨릴 수 있다.
- 특히 535건은 source blank / DB API present이므로 감소/삭제 후보로 무시하되, import/upsert 시 blank overwrite를 막아야 한다.
- 반영 전 `api_enrichment_status`, `building_ledger_source`, `asset_building_ledger.raw_ledger` 확인이 필요하다.

실제 source 값이 있고 API 값과 다른 건은 아래 4건뿐이다.

| asset_code | field | source | DB/API |
|---|---|---|---|
| `A112039001` | `site_area` | 1271 | 4200 |
| `A112039001` | `parking` | 170 | 옥내 170 / 옥외 0 |
| `A190009001` | `parking` | 892대(옥내 428대, 옥외464대) | 옥내 428 / 옥외 464 |
| `A200030001` | `parking` | 1,490 | 1490 |

## 6. 우선순위

1. 신규 fund 9개 중 실제 생성 대상 확정
2. 그중 AUM도 있는 `200046`, `300086`, `300090` 우선 검토
3. AUM 기준일 2026-05-31 전환 및 480개 금액 업데이트 검토
4. `R00008`, `R00010` exposure source-only fund 확인
5. 대주/수익자 exposure는 row-level 비교 후 반영 전략 결정
6. `portfolio_region`, `business_stage`, `asset_type`, `country_code`는 blank fill 후보만 canonical direct-source bucket으로 분리
7. `asset_type` 충돌 2건과 이름/주소 94건은 manual review
8. `site_area`, `gross_floor_area`, `completion_date`, `parking`은 API-protected bucket으로 분리하고 blank overwrite 금지
9. 물리 필드 중 DB blank인 48건은 API 미조회 보완 queue로 별도 처리
10. fund-asset pair 153건은 canonical/inferred/synthetic 분류 후 관계 반영 여부 판단

## 7. 이번 검토에서 의도적으로 제외한 것

- 오늘 source에 없어진 Supabase row
- 오늘 source 범위 축소로 보이는 row 감소
- Supabase에만 남아 있는 과거 관계 삭제 후보
- DB 자동 수정

이번 보고서는 “증분 업데이트와 관계 정합성 검토 큐”다.
