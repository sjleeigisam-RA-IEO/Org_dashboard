# 국토부 실거래 Scope Filter — 주거용 제외·건물면적 3,300㎡ 초과

## 정책

- 정책 코드: `MOLIT_SCOPE_GT_3300_V1`
- 대상: 국토교통부 비주거용 부동산 실거래 원천 레코드
- 거래면적 필드: 원천 `buildingAr`(건물면적, ㎡)
- 유지 조건: 비주거용이면서 `buildingAr > 3300`
- 제외 조건:
  - 아파트·공동주택·단독주택·다가구·다세대·연립·주택·주거 용도
  - `buildingAr <= 3300`
  - `buildingAr` 누락 또는 비수치
- 경계값: 3,300㎡는 “이하”이므로 제외

## 데이터 보존 원칙

원천 API 문서와 document version은 삭제하지 않았습니다. 원천은 감사·재현을 위해 보존하고, 범위 밖 레코드의 event mention을 `REJECTED`로 전환했습니다.

- 면적 제외 코드: `OUT_OF_SCOPE_AREA_LE_3300_M2`
- 주거용 제외 코드: `OUT_OF_SCOPE_RESIDENTIAL_USE`
- 면적 누락 제외 코드: `OUT_OF_SCOPE_AREA_MISSING`

향후 신규 국토부 레코드도 title extraction 시 동일 classifier가 자동 적용됩니다.

## 적용 결과

| 지역 | 원천 거래 | 유지 | 면적 기준 제외 | 주거용 제외 | 유지율 |
|---|---:|---:|---:|---:|---:|
| 서울 | 12,219 | 97 | 12,122 | 0 | 0.79% |
| 인천 | 3,385 | 14 | 3,371 | 0 | 0.41% |
| 경기 | 15,077 | 47 | 15,030 | 0 | 0.31% |
| **합계** | **30,681** | **158** | **30,523** | **0** | **0.51%** |

현재 국토부 비주거 API의 `buildingUse` 값은 제1·2종근린생활, 판매, 업무, 숙박, 기타, 교육연구로 구성돼 실제 주거용 제외 건수는 0건입니다. 주거용 차단 로직은 향후 원천 확장 및 데이터 품질 변동에 대비해 유지합니다.

## 경계 QA

- 활성 국토부 후보: 158건
- 활성 후보 최소 건물면적: 3,300.91㎡
- 활성 후보 중 `buildingAr <= 3300`: 0건
- 활성 후보 중 주거용 키워드: 0건
- 두 번째 필터 적용 변경: 0건

## Macro 재파생

기존 서울 월별 국토부 macro도 동일 정책으로 재파생했습니다.

- derivation: `MOLIT_RTMS_NRG_SEOUL_SUM_V2`
- 12개 월 release revision 생성
- 36개 관측값 revision 생성
- 취소 거래 제외 후 2025년 서울 대형 비주거 거래: 85건
- metadata 규칙: `buildingAr > 3300 m2`, 주거용 제외, 취소 거래 제외

## 전체 QA

- 전체 회귀 테스트: 19개 통과
- SQLite `integrity_check`: `ok`
- 외래키 위반: 0
- canonical event: 0
- 전체 event mention: 활성 4,560 / 거절 30,550
- 거절 중 scope 면적 기준: 30,523
- 거절 중 superseded version: 27

## 구현

- classifier·bulk 적용: `collector/transaction_scope.py`
- 신규 extraction 자동 적용: `collector/backfill_2025.py`
- 서울 macro scope V2: `collector/backfill_2025.py`
- 테스트: `tests/test_transaction_scope.py`, `tests/test_backfill_2025.py`

## 백업

- 파일: `backups/market-capital-2025-scope3300-v2.2.0-20260815.db`
- 크기: 165,634,048 bytes
- SHA-256: `310ecefd3ecadf999c242fd7697b23442df0ea60e774938a5478aefcfe7dffba`
- Quick check: `ok`
- 외래키 위반: 0
