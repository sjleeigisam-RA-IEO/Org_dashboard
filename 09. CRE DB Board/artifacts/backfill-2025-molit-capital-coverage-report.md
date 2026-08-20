# 2025 국토교통부 비주거 실거래 — 수도권 확장 Coverage Report

## 1. 실행 범위

- 원천: 국토교통부 비주거용 부동산 실거래 API
- 기간: 2025-01-01 ~ 2025-12-31
- 기존 범위: 서울특별시
- 추가 범위: 인천광역시·경기도
- partition: `LAWD_CD × DEAL_YMD`
- 저장소: `data/market.db`

## 2. 지역코드 기준

지역코드는 행정표준코드 관리시스템의 공식 법정동 전체자료에서 생성했습니다.

- 공식 페이지: https://www.code.go.kr/stdcode/regCodeL.do
- 전체자료 endpoint: https://www.code.go.kr/etc/codeFullDown.do
- 공식 ZIP SHA-256: `7b4b544a6302d26c4f4c89d2c1355beae82e958c786bad8cc8572db0d2e2eb33`
- manifest: `config/molit-2025-capital-region-codes.json`

### 중요: 조회지리 vintage

국토부 API는 2025년 거래도 2026년 조회시점의 현행 행정구역으로 재분류해 반환했습니다.

- 인천 신규 제물포구·영종구·서해구·검단구 코드에서 2025년 레코드 반환
- 화성시 신규 만세구·효행구·병점구·동탄구 코드에서 2025년 레코드 반환
- 과거 또는 상위 시 코드는 동일 조회에서 0건

따라서 이번 적재의 `LAWD_CD`는 거래 당시 행정구역이 아니라 `CURRENT_QUERY_GEOGRAPHY_VINTAGE_APPLIED_BY_MOLIT_TO_HISTORICAL_RECORDS`입니다. 실제 거래일과 원천 주소 필드는 별도로 보존했습니다.

## 3. 수집 결과

| 지역 | 공식 LAWD_CD 수 | 월 partition | API 레코드 | SQLite 최신 문서 | 빈 partition | API/parse 불일치 |
|---|---:|---:|---:|---:|---:|---:|
| 서울 | 25 | 300 | 12,219 | 12,219 | 0 | 0 |
| 인천 | 11 | 132 | 3,385 | 3,385 | 1 | 0 |
| 경기 | 47 | 564 | 15,077 | 15,077 | 0 | 0 |
| **수도권 합계** | **83** | **996** | **30,681** | **30,681** | **1** | **0** |

인천의 유일한 빈 partition은 옹진군 2025년 3월이며 API가 정상 응답한 `totalCount=0`입니다. 오류·누락과 구분해 정상 완료로 저장했습니다.

### 이번 확장 추가분

- 인천 신규 공식 거래 레코드: 3,385
- 경기 신규 공식 거래 레코드: 15,077
- 확장 추가 합계: 18,462
- 신규 extraction run: 18,462
- 신규 SALE event mention 후보: 18,462

## 4. 실행·재개 정책

- 완료 partition은 `collection_runs` checkpoint로 API 재호출 없이 skip
- API 요청 실패 시 bounded retry
- `totalCount > numOfRows`일 때 pagination
- API `totalCount`와 parser 결과가 다르면 적재 전 즉시 실패
- stable ID: canonical API record hash + 동일 레코드 출현 순번
- 동일 partition 재실행 시 문서 중복 생성 방지
- API key는 `.env` worker 내부에서만 사용하고 DB·artifact에 저장하지 않음

## 5. 확장 후 DB 상태

- 전체 source document: 34,845
- 전체 document version: 34,872
- 국토부 비주거 실거래 document: 30,681
- 완료 collection run: 1,100
- 완료 extraction run: 34,872
- 활성 event mention: 35,083
- superseded version으로 거절된 mention: 27
- canonical event: 0

canonical event 0건은 의도된 상태입니다. 자산·주소 resolution과 중복 사건 병합 전에는 공식 거래 레코드도 검수 후보로만 유지합니다.

## 6. QA

| 검사 | 결과 |
|---|---|
| SQLite `integrity_check` | `ok` |
| 외래키 위반 | 0 |
| source 내 canonical URL 중복 | 0 |
| version 없는 source document | 0 |
| run 연결 없는 document version | 0 |
| 인천 API/parse mismatch | 0 |
| 경기 API/parse mismatch | 0 |
| 기존 수집기 통합 테스트 | 9개 통과 |
| 법정동 leaf parser 테스트 | 1개 통과 |
| CLI 회귀 테스트 | 4개 통과 |

## 7. 산출물

- 인천 summary: `artifacts/backfill-2025-molit-incheon-summary.json`
- 경기 summary: `artifacts/backfill-2025-molit-gyeonggi-summary.json`
- 지역 manifest: `config/molit-2025-capital-region-codes.json`
- 공통 runner: `scripts/run_backfill_2025_molit_capital.py`
- 공식코드 parser: `collector/molit_regions.py`
- 백업: `backups/market-capital-2025-v2.2.0-20260815.db`
- 백업 SHA-256: `ee05917abfbd2f2186fca3e6662b818fa0aaf20a5879acb2d1880018a03e98ff`
- 백업 quick check: `ok`
- 백업 외래키 위반: 0

## 8. 후속 작업

1. 인천·경기 월별 거래건수·금액·면적 macro observation 파생
2. 주소·용도·면적 기반 asset 후보 resolution
3. 서울·인천·경기 동일 자산 거래 이력 연결
4. 뉴스 매각 event mention과 공식 실거래 레코드의 canonical event 후보 군집화
5. 조회지리 vintage와 거래 당시 행정구역 간 crosswalk 추가
