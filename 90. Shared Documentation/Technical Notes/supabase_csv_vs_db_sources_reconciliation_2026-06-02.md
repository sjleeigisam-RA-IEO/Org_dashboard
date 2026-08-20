# Supabase CSV vs DB Sources 정합성 점검

작성일: 2026-06-02

## 1. 목적

이번 점검은 `01. RA Portal/output/supabase_denormalized_asset_fund_snapshot_2026-06-02.csv`가 `00. Raw Data` 원본 엑셀에서 출발한 정보와 얼마나 정합적인지 확인하기 위한 것이다.

단순히 값이 같은지 보는 작업이 아니라, 다음 세 가지를 분리해서 보았다.

1. 원본 엑셀에서 직접 온 정보
2. 정제/표준화/관계 재구성 과정에서 만들어진 정보
3. VWorld, data.go.kr 건축물대장 API 등 외부 보강으로 들어온 정보

## 2. 비교 대상

### 원본 엑셀

`00. Raw Data` 폴더에는 8개 원본 엑셀이 있다.

| 파일 | 행 x 열 | 주요 역할 |
|---|---:|---|
| `펀드 관리_20260515.xlsx` | 1,103 x 59 | 펀드 마스터, 상태, 분류, 담당부서/담당자 |
| `펀드 AUM 관리_20260515.xlsx` | 875 x 33 | 펀드별 AUM, Equity, Loan, 임대보증금 |
| `펀드별 투자 자산 조회_20260515.xlsx` | 1,032 x 42 | 펀드-자산 관계, 자산명, 주소, 사업단계 |
| `투자 자산 관리_20260515.xlsx` | 788 x 61 | 자산코드, 자산명, 주소, 물리 속성 |
| `펀드별 대주 정보 조회_20260515.xlsx` | 798 x 28 | 대주, 대출약정/인출/잔여 금액 |
| `펀드별 수익자 정보 조회_20260515.xlsx` | 1,159 x 24 | 수익자, 총약정/투입/잔여 금액 |
| `2025년 인원.xlsx` | 282 x 8 | 과거 인원 기준 |
| `2026.05 인원.xlsx` | 251 x 16 | 현재 인원/조직 기준 |

주의: 일부 원본 엑셀은 XLSX 내부 dimension metadata가 `A1`처럼 잘못 저장되어 일반 미리보기나 단순 로더에서 빈 파일처럼 보일 수 있다. 실제 행/열은 XML/worksheet 내용을 재스캔해서 확인했다.

### 비교 CSV

`supabase_denormalized_asset_fund_snapshot_2026-06-02.csv`는 1,151행 x 81열이다.

행 grain은 `asset_fund_link`이며, 실제 후보키는 `asset_id + fund_id`다. 즉 이 CSV는 원본 엑셀 전체 row dump가 아니라, Supabase의 canonical asset-fund 관계를 기준으로 여러 테이블과 view를 펼친 wide snapshot이다.

## 3. 데이터 계보

현재 계보는 다음과 같이 보는 것이 맞다.

```text
00. Raw Data Excel
  -> update_db_20260515.py / replace_supabase*_from_excel.py
  -> funds, fund_assets, lender_exposures, beneficiary_exposures
  -> build_asset_master.py
  -> asset_master, asset_aliases, asset_identifiers, asset_fund_links, asset_project_links
  -> apply_asset_relationships.py / apply_secondary_asset_links.py
  -> funds.primary_asset_id, projects.primary_asset_id, secondary asset_id
  -> fill_asset_pnu_from_address.py / fill_asset_specs_from_hub.py
  -> pnu, geocode, building ledger/API physical specs
  -> asset_aum_summary, asset_exposure_summary 등 Supabase views
  -> denormalized CSV
```

### 출처 분류

| 필드군 | 주 출처 | 해석 |
|---|---|---|
| 펀드 ID, 펀드명, 상태, 설정일, 만기일 | 원본 엑셀 `펀드 관리` | 직접 비교 가능 |
| 펀드 AUM, Equity, Loan, 임대보증금 | 원본 엑셀 `펀드 AUM 관리` | 직접 비교 가능 |
| 자산명, 주소, 기초자산, 사업단계 | 원본 엑셀 + canonical 정제 | 이름/주소는 정규화로 달라질 수 있음 |
| `asset_id`, `canonical_name`, `asset_kind`, `relation_type` | 정제 로직 | 원본 단일 컬럼이 아님 |
| `pnu`, `latitude`, `longitude` | VWorld/주소 보강 | 원본 값이 아니라 보강값 |
| `site_area`, `gross_floor_area`, `scr`, `far`, `main_usage`, `structure`, `floors_*`, `completion_date` | 원본 + 건축물대장 API | `building_ledger_source`로 API 여부 구분 필요 |
| `linked_project_names`, `risk_project_names` | Supabase 프로젝트/리스크 테이블 | 00. Raw Data 엑셀만으로 정답 비교 불가 |
| 대주/수익자 summary | 원본 exposure 엑셀 -> Supabase 상세 테이블 -> 자산 단위 summary | CSV만으로 row-level 검증 불가 |

## 4. 핵심 결과

### 4.1 펀드 마스터

결론: CSV에 포함된 linked fund 범위에서는 펀드 마스터 주요 값 왜곡이 발견되지 않았다.

| 항목 | 결과 |
|---|---:|
| 원본 펀드 수 | 1,103 |
| CSV linked fund 수 | 783 |
| CSV에 없는 원본 펀드 | 320 |
| CSV fund 중 원본에 없는 펀드 | 0 |
| 펀드명/약칭/상태/섹터/지역/일자 mismatch | 0 |

CSV에 없는 320개 펀드는 현재 CSV의 grain이 `asset_fund_links`이기 때문에, canonical asset 연결이 없는 펀드는 빠지는 구조다. 이것은 즉시 오류라기보다 coverage 차이다.

### 4.2 AUM

결론: CSV에 포함된 펀드의 AUM 숫자는 원본 AUM 엑셀과 일치했다.

| 항목 | 결과 |
|---|---:|
| 원본 AUM 펀드 수 | 875 |
| CSV linked fund 수 | 783 |
| 비교한 numeric value 수 | 3,246 |
| AUM numeric mismatch | 0 |

검증 필드:

- `fund_benchmark_aum` vs `AUM(원)`
- `fund_invested_aum` vs `AUM(원).1`
- `fund_equity_won` vs `Equity 총액(원)`
- `fund_loan_won` vs `Loan 총액(원)`
- `fund_deposit_won` vs `기준일자 임대보증금(원)`

### 4.3 펀드-자산 관계

결론: 펀드-자산 관계는 단순 복사본이 아니며, canonical merge, inferred link, synthetic/portfolio asset 처리가 많이 개입되어 있다. 이 영역이 가장 큰 검토 대상이다.

| 항목 | 결과 |
|---|---:|
| 원본 `펀드코드 + 자산명` pair | 1,031 |
| CSV `fund_id + asset_name` pair | 1,007 |
| 원본에는 있으나 CSV exact pair에는 없는 후보 | 276 |
| CSV에는 있으나 원본 exact pair에는 없는 후보 | 252 |

CSV 쪽 추가 후보 252건의 관계 유형:

| 관계 유형 | 건수 |
|---|---:|
| `inferred_underlying_asset` | 180 |
| `name_only_underlying_asset` | 37 |
| `underlying_asset` | 35 |

해석:

- `inferred_underlying_asset` 180건은 원본 행 왜곡이라기보다 정제 로직이 펀드명/자산명/기존 관계에서 추론한 링크일 가능성이 높다.
- 다만 사용자가 요구한 “왜곡 여부” 관점에서는 이 180건이 가장 먼저 리뷰되어야 한다. 추론 링크는 근거가 약하면 실제 자산 관계를 바꿔 보이게 만들 수 있다.
- 해외 포트폴리오, 태양광 다중 자산, PF/대출채권, 재간접/수익증권 성격의 자산에서 exact pair mismatch가 집중된다.

### 4.4 자산 물리 속성

결론: 자산 물리 속성은 원본 누락, 주소 정규화, API 보강이 섞여 있어 `원본과 다름 = 오류`로 보면 안 된다. 다만 원본에는 값이 있는데 CSV가 비어 있는 필드는 명확한 보강/전개 누락 후보로 보인다.

| 항목 | 결과 |
|---|---:|
| 원본 자산 수 | 788 |
| CSV distinct asset 수 | 620 |
| 원본 자산과 매칭된 CSV 자산 | 609 |
| CSV 자산 중 원본 자산과 직접 매칭 안 된 건 | 11 |
| 원본과 CSV 값이 다른 물리 필드 | 79 |
| 원본 값은 있는데 CSV가 blank인 필드 | 1,013 |

원본 값 존재 / CSV blank의 주요 필드:

| 필드 | 건수 | 해석 |
|---|---:|---|
| `portfolio_region` | 597 | 원본 `투자지역`이 denormalized CSV로 거의 전개되지 않음 |
| `business_stage` | 351 | 원본 `사업단계`가 canonical asset 쪽에 충분히 유지되지 않음 |
| `asset_type` | 51 | 기초자산/자산유형 표준화 과정에서 공란화 또는 미매핑 |
| `gross_floor_area` | 9 | 일부 면적 누락 |
| `address_text` | 3 | 주소 누락 |
| `site_area` | 2 | 토지면적 누락 |

원본과 CSV 값이 다른 79건의 필드:

| 필드 | 건수 | 해석 |
|---|---:|---|
| `address_text` | 75 | 도/특별자치도 표준화, 여러 필지 중 대표 필지 선택, 지번 정제, API/주소 보강 영향 |
| `asset_type` | 4 | 분류 체계 차이 또는 매핑 오류 후보 |

주소 차이 예시는 대체로 다음 유형이다.

- `강원도` -> `강원특별자치도`
- `경북` -> `경상북도`
- 여러 필지 주소 -> 대표 필지 주소
- `외 n필지` 또는 쉼표로 나열된 주소 -> 단일 지번
- 오타/법정동 보정 가능성이 있는 주소

따라서 주소 mismatch는 전부 오류로 볼 수 없고, `api_enrichment_status`, `building_ledger_source`, 원본 전체 필지 보존 여부를 같이 봐야 한다.

### 4.5 대주/수익자 exposure

CSV 자체는 row-level 대주/수익자 정보를 들고 있지 않고, `asset_exposure_summary`에서 온 자산 단위 summary만 들고 있다. 그래서 별도로 Supabase 상세 테이블을 조회해 원본 exposure 엑셀과 펀드별 합계를 비교했다.

결론:

- 대주 exposure는 원본과 Supabase DB 합계가 모두 일치했다.
- 수익자 exposure는 388개 펀드 중 3개 펀드에서 금액 합계 차이가 있다.

| 항목 | 원본 | Supabase DB |
|---|---:|---:|
| 대주 펀드 수 | 118 | 118 |
| 대주 row 수 | 798 | 670 |
| 수익자 펀드 수 | 388 | 388 |
| 수익자 row 수 | 1,159 | 1,118 |

대주 row 수가 줄어든 것은 collapse/aggregation이 적용된 결과로 보이며, 펀드별 합계는 일치했다.

수익자 합계 차이:

| fund_id | field | 원본 합계 | DB 합계 | 차이 |
|---|---|---:|---:|---:|
| 112690 | committed | 220,300,000,000 | 220,000,407,978 | -299,592,022 |
| 112690 | invested | 213,176,579,000 | 212,886,674,314 | -289,904,686 |
| 112690 | remaining | 7,123,421,000 | 7,113,733,664 | -9,687,336 |
| 200042 | committed | 151,610,196,000 | 151,090,983,000 | -519,213,000 |
| 200042 | invested | 80,884,000,000 | 80,607,000,000 | -277,000,000 |
| 200042 | remaining | 70,726,196,000 | 70,483,983,000 | -242,213,000 |
| 300075 | committed | 14,000,150,024 | 11,500,123,234 | -2,500,026,790 |
| 300075 | invested | 14,000,150,024 | 11,500,123,234 | -2,500,026,790 |

이 3개 펀드는 row collapse 로직, 중복 수익자 처리, 일부 class/share 제외 여부를 원본 row 단위로 재확인해야 한다.

## 5. 주요 오류/왜곡 후보

우선순위 기준으로 보면 다음과 같다.

### P0: AUM/펀드 마스터

현재 발견된 오류 없음.

- 펀드명/상태/섹터/지역/일자 mismatch: 0
- AUM numeric mismatch: 0

### P0: 자산 속성 누락

원본에는 있는데 CSV에 blank인 필드가 많다.

- `portfolio_region`: 597건
- `business_stage`: 351건
- `asset_type`: 51건

이건 현재 wide CSV 또는 canonical asset model이 원본 `투자지역`, `사업단계`, `기초자산`을 충분히 보존/전개하지 못하는 문제로 봐야 한다.

### P1: 펀드-자산 관계 추론

`inferred_underlying_asset` 180건은 검토 필요하다.

추론 자체가 잘못은 아니지만, 원본 exact pair와 다르게 보이는 자산 관계를 만들 수 있으므로 “정합성 검토 큐”로 분리해야 한다.

### P1: 수익자 exposure 합계 차이

3개 펀드, 8개 금액 항목에서 원본 합계와 Supabase DB 합계 차이가 있다.

대주 exposure는 합계 일치.

### P2: 주소/물리 정보 차이

주소 mismatch 75건은 대부분 정규화 또는 API 보강 영향으로 보인다. 다만 대표 필지 선택이 원본의 복수 필지를 잃어버린 것인지, 의도된 대표 주소인지 별도 검토가 필요하다.

## 6. 반복 가능한 비교 절차

이번에 만든 산출물은 다음 구조다.

| 산출물 | 용도 |
|---|---|
| `01. RA Portal/tools/data-reconciliation/reconcile_excel_vs_supabase_csv.py` | 원본 엑셀과 denormalized CSV를 반복 비교하는 스크립트 |
| `01. RA Portal/output/reconciliation_20260602/source_workbook_inventory.csv` | 원본 엑셀 파일/시트/컬럼 인벤토리 |
| `01. RA Portal/output/reconciliation_20260602/denorm_csv_profile.csv` | CSV 컬럼별 nonblank/distinct/top values 프로파일 |
| `01. RA Portal/output/reconciliation_20260602/reconciliation_issues.csv` | 비교 이슈 전체 목록 |
| `01. RA Portal/output/reconciliation_20260602/reconciliation_summary.json` | 비교 요약 JSON |
| `01. RA Portal/output/reconciliation_20260602/exposure_source_vs_supabase_issues.csv` | 대주/수익자 원본 vs Supabase 상세 테이블 합계 차이 |
| `01. RA Portal/output/reconciliation_20260602/exposure_source_vs_supabase_summary.json` | exposure 비교 요약 |

다음번 유사 원본 파일을 받을 때는:

1. `00. Raw Data`에 새 원본 파일을 둔다.
2. Supabase에서 denormalized CSV를 새로 생성한다.
3. `reconcile_excel_vs_supabase_csv.py`를 실행한다.
4. 먼저 `reconciliation_summary.json`으로 전체 수치를 본다.
5. 그 다음 `reconciliation_issues.csv`에서 `severity=review`만 필터링한다.
6. 특히 `source_nonblank_csv_blank`, `inferred_underlying_asset`, exposure sum mismatch를 우선 본다.

## 7. 결론

현재 CSV는 원본 엑셀의 단순 복사본이 아니라, 원본에서 만든 펀드/자산/exposure 테이블을 Supabase에서 canonical asset 중심으로 재정규화하고 API 보강까지 붙인 결과물이다.

확인된 상태는 다음과 같다.

- 펀드 마스터와 AUM 금액은 CSV에 포함된 범위에서 원본과 잘 맞는다.
- 펀드-자산 관계는 정제/추론 로직 개입이 커서 별도 리뷰 큐가 필요하다.
- 자산의 `사업단계`, `투자지역`, 일부 `기초자산`은 원본 대비 CSV에서 누락이 크다.
- 대주 exposure는 원본과 DB 합계가 일치한다.
- 수익자 exposure는 3개 펀드에서 합계 차이가 있다.
- 주소/물리 정보는 API 보강과 대표 주소 선택 때문에 원본과 달라질 수 있으므로 원본/API 출처를 분리해서 봐야 한다.

따라서 다음 정비 우선순위는 `asset_master` 또는 denormalized export에 원본 `business_stage`, `portfolio_region`, `asset_type` 보존 필드를 명확히 반영하고, `inferred_underlying_asset` 링크와 수익자 3개 펀드 차이를 검토하는 것이다.
