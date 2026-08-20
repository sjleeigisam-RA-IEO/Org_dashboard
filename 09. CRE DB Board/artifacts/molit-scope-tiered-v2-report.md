# 국토부 실거래 Scope Policy V2 — 계층형 필터·거래군 복원

## 정책 코드

`MOLIT_SCOPE_TIERED_V2`

## 범위 규칙

1. 주거용 건물: `REJECTED`
2. `buildingAr <= 1,000㎡`: 자동 `REJECTED`
3. `1,000 < buildingAr <= 3,300㎡`: `REVIEW_READY`
4. `buildingAr > 3,300㎡`: `EXTRACTED`
5. 동일 거래군 합산 `buildingAr > 3,300㎡`: 구성 행이 1,000㎡ 이하라도 `REVIEW_READY`로 복원

거래군 후보 키:

- 시군구 코드
- 법정동·지번
- 거래연월일
- 거래금액
- 매수자·매도자 구분
- 거래방식
- 건축연도
- 건물유형

거래군은 법적 동일 거래 확정값이 아니므로 canonical event로 바로 승격하지 않고 검토과제로 생성합니다.

## 적용 결과

| 상태 | 건수 | 처리 |
|---|---:|---|
| 대형 비주거 거래 | 158 | `EXTRACTED` |
| 경계·거래군 검토 | 988 | `REVIEW_READY` |
| 소형 자동 제외 | 29,535 | `REJECTED` |
| **합계** | **30,681** |  |

### 검토대상 988건

- 1,000~3,300㎡ 경계행 전체: 880건
- 거래군 합산 3,300㎡ 초과로 복원된 1,000㎡ 이하 구성행: 108건
- 순수 면적 경계 reason: 777건
- 거래군 합산 reason: 211건
- 거래군 후보: 38개

거래군 구성행 211건 중 103건은 원래 1,000~3,300㎡ 경계였고, 108건은 원래 자동 제외 대상이었으나 합산 거래 가능성 때문에 복원됐습니다.

## Review task

`review_tasks.review_type = MOLIT_TRANSACTION_SCOPE`

| 우선순위 | reason | 과제 수 |
|---|---|---:|
| 2 | `SCOPE_REVIEW_GROUP_SUM_GT_3300_M2` | 211 |
| 3 | `SCOPE_REVIEW_AREA_1000_3300_M2` | 777 |

- review task ID는 policy+event mention 기반 stable ID
- 재실행 시 중복 생성 없음
- payload에 행 면적, 거래군 키, 거래군 합산면적, 구성행 수 저장
- review queue: `artifacts/molit-scope-tiered-v2-review-queue.csv`

## 향후 신규 수집

- extraction 시 행 단위 V2 classifier 자동 적용
- 1,000~3,300㎡는 즉시 `REVIEW_READY`
- 수집 후 `apply_molit_transaction_scope()` 실행 시 거래군 합산 및 review task 생성
- 승인 전에는 canonical event 및 서울 대형거래 macro에 포함하지 않음

## QA

- `EXTRACTED` 중 3,300㎡ 이하: 0
- `REJECTED` 중 1,000㎡ 초과: 0
- review task와 `REVIEW_READY` 대상 불일치: 0
- 거래군 distinct 후보: 38
- 두 번째 적용 변경 mention: 0
- 두 번째 적용 신규 review task: 0
- 전체 회귀 테스트: 21개 통과
- SQLite `integrity_check`: `ok`
- 외래키 위반: 0
- canonical event: 0

## 구현

- V2 classifier·거래군·review task: `collector/transaction_scope.py`
- 신규 extraction 상태 매핑: `collector/backfill_2025.py`
- 테스트: `tests/test_transaction_scope.py`

## 백업

- 파일: `backups/market-capital-2025-scope-tiered-v2-20260815.db`
- 크기: 166,072,320 bytes
- SHA-256: `c3d2603d39c463193bb48a44eea88f19d695a0a6caedcc5c06bda0b09992b5b5`
- Quick check: `ok`
- 외래키 위반: 0
