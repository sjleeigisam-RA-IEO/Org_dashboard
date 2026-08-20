# 2026-06-08 Supabase 적용 로그

## 적용 기준

- 오늘자 source에 없어진 row나 감소분은 반영하지 않았다.
- 신규 row와 검색/조회 누락을 줄이는 관계 보강만 적용했다.
- 애매한 canonical merge, 중복 자산 후보, API 보강값 overwrite는 적용하지 않았다.

## 1. 신규 fund 반영

`funds`에 신규 9건을 upsert했다.

| fund_id | fund_name | AUM 반영 |
|---|---|---:|
| `120124` | 이지스부동산대출일반사모부동산투자신탁제2호(1종) | N |
| `120125` | 이지스부동산대출일반사모부동산투자신탁제2호(2종) | N |
| `120126` | 이지스 NPL 리스트럭처링일반사모부동산투자신탁 | N |
| `200046` | 이지스글로벌인프라일반사모투자신탁제7호 | Y |
| `300086` | 이지스 멀티플러스 일반사모투자신탁 제3호 | Y |
| `300087` | 이지스 멀티플러스 일반사모투자신탁 제3호(Class A) | N |
| `300088` | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C) | N |
| `300089` | 이지스 멀티플러스 일반사모투자신탁 제3호(Class C-S) | N |
| `300090` | 이지스그린ON 일반사모투자신탁제5호 | Y |

AUM이 있는 `200046`, `300086`, `300090`은 `aum_base_date = 2026-05-31` 및 관련 금액 필드도 같이 반영했다.

검증:

- `v_funds_enriched` 직접 조회: 9건 확인
- `멀티플러스`, `그린ON`, `NPL` 검색어 기반 `ilike` 조회 확인
- 적용 payload: `01. RA Portal/output/reconciliation_20260608_apply/new_funds_upsert_payload.json`
- 검증 결과: `01. RA Portal/output/reconciliation_20260608_apply/new_funds_upsert_verify.json`
- 검색 검증: `01. RA Portal/output/reconciliation_20260608_apply/search_text_verify.json`

## 2. fund-asset 관계 보강

오늘자 `투자 자산 조회_20260608.xlsx`에는 있는데 Supabase exact link에 없던 153건 중, `asset_master.canonical_name` 또는 `asset_aliases.alias_name`에 정확히 하나의 자산으로만 매칭되는 66건을 `asset_fund_links`에 upsert했다.

적용 규칙:

- relation_type: `underlying_asset`
- source_table: `fund_asset_source`
- source_file: `투자 자산 조회_20260608.xlsx`
- confidence: canonical exact match 기준 0.97, alias confidence는 기존 alias confidence 사용
- 중복 asset 후보가 2개 이상인 경우 적용 제외
- exact match가 없는 경우 적용 제외

검증:

- upsert 반환: 66건
- affected funds의 `fund_asset_relationships` 조회: 81행 확인
- 적용 payload: `01. RA Portal/output/reconciliation_20260608_apply/exact_asset_links_upsert_payload.json`
- 제외 목록: `01. RA Portal/output/reconciliation_20260608_apply/exact_asset_links_skipped.json`
- 관계 검증: `01. RA Portal/output/reconciliation_20260608_apply/exact_asset_links_verify.json`

## 3. 재검증 결과

DB 반영 후 관계 중심 reconciliation을 재실행했다.

| 항목 | 반영 전 | 반영 후 |
|---|---:|---:|
| 신규 fund 후보 | 9 | 0 |
| 관계 중심 update 후보 | 3,928 | 3,850 |
| AUM/exposure 관계 체크 | 23 | 20 |
| fund-asset exact pair 미해결 | 153 | 87 |

남은 fund-asset 미해결 87건:

- 55건: source pair는 있으나 DB 쪽 기존 관계/후보가 있어 review 필요
- 32건: source pair가 있으나 exact canonical/alias 매칭이 없어 update candidate 상태 유지

## 4. 아직 건드리지 않은 것

- 기존 row의 AUM 월말 업데이트 804건
- lender/beneficiary exposure row-level 업데이트
- 자산 canonical field blank fill
- API 보강 필드(`site_area`, `gross_floor_area`, `completion_date`, `parking`) overwrite
- 중복 canonical 자산 후보가 있는 fund-asset 관계
- 전역 `primary_asset_id`, `primary_asset_ids` 재계산

다음 정합성 개선은 검색 기준으로 보면 `exact_asset_links_skipped.json`의 87건 중 중복 자산 후보를 수동 병합/선택하는 것이 가장 효과적이다.
