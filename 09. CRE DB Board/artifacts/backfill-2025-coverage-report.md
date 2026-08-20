# 2025 부동산 시장 인텔리전스 백필 — 1차 Coverage Report

## 1. 실행 범위

- 기준기간: 2025-01-01 ~ 2025-12-31
- 카테고리: 매각, 임대, 신규공급, 인허가, PF, 대출, 투자
- 저장소: `data/market.db` (SQLite V2.2)
- 원칙: 문서 발견 → immutable version → event mention 검수 큐 → canonical event 승인
- 이번 단계에서 canonical event 자동 생성 금지

## 2. 수집 결과

### 소스별 문서

| 소스 | 고유 문서/레코드 | 문서 version | 범위 |
|---|---:|---:|---|
| Google News RSS | 4,098 | 4,098 | 7개 카테고리 월별 검색 + recovery |
| OpenDART | 66 | 66 | 2025 주요사항보고 8,416건 중 유형자산 양도·취득 등 66건 |
| 국토교통부 비주거 실거래 | 12,219 | 12,246 | 서울 25개 자치구 × 12개월 |
| **합계** | **16,383** | **16,410** | 2025 기준 |

### 실행 partition

- 완료 collection run: 404
- 실패 run: 0
- RSS 기본 partition: 84
- OpenDART 월 partition: 12
- 국토교통부 서울 실거래 partition: 300
- RSS 보정 partition: 6

### RSS 기본 수집

| 카테고리 | 기본 발견 건수 | 기본 신규 문서 | 월 partition |
|---|---:|---:|---:|
| 매각 | 948 | 897 | 12 |
| 임대 | 333 | 304 | 12 |
| 신규공급 | 1,024 | 1,007 | 12 |
| 인허가 | 494 | 454 | 12 |
| PF | 401 | 371 | 12 |
| 대출 | 505 | 457 | 12 |
| 투자 | 486 | 429 | 12 |

## 3. 누락 위험 보정

### 2025년 2월 매각

- 월 검색 결과가 100건 상한에 도달
- 주 단위 4개 partition으로 재검색
- 주별 발견 합계: 99
- 기존 결과에 없던 문서: 12

### 2025년 4월 투자

- 기본 검색 결과가 비정상적으로 0건
- 짧은 검색식 2개 bundle로 재검색
- 발견 합계: 139
- 기존 결과에 없던 문서: 116

### 실거래 동일필드 복수 거래

- 최초 smoke test에서 API 31건 중 27건만 신규 등록되는 문제 발견
- 원인: 원천 거래 일련번호가 없어 동일필드 복수 거래가 같은 해시로 병합
- 조치: canonical record hash + 동일 레코드 출현 순번 방식으로 변경
- 종로구 1월 누락 4건 복구
- 전체 서울 batch는 수정된 identity 정책으로 수집

## 4. Event mention 검수 큐

- 활성 event mention: 16,621
- 갱신 전 문서 version으로 판정되어 거절된 mention: 27
- 거절 코드: `SUPERSEDED_DOCUMENT_VERSION`
- canonical event: 0

### 활성 후보 카테고리

| 카테고리 | 활성 mention |
|---|---:|
| 매각 | 13,246 |
| 임대 | 333 |
| 신규공급 | 1,024 |
| 인허가 | 494 |
| PF | 401 |
| 대출 | 505 |
| 투자 | 618 |

매각 mention에는 국토교통부 서울 비주거 실거래 레코드가 포함됩니다. 동일 사건의 복수 기사 결합, 자산·프로젝트 resolution, 후속 상태 연결이 끝나기 전에는 event 수로 해석하면 안 됩니다.

## 5. Macro observation

국토교통부 서울 비주거 실거래 레코드를 사용해 다음 월별 시계열을 생성했습니다.

| Series | 기간 수 | 단위 |
|---|---:|---|
| `MOLIT_SEOUL_NRG_TRADE_COUNT` | 12 | COUNT |
| `MOLIT_SEOUL_NRG_TRADE_AMOUNT_KRW` | 12 | KRW |
| `MOLIT_SEOUL_NRG_BUILDING_AREA_M2` | 12 | M2 |

- macro series: 3
- macro release/vintage: 12
- macro observation: 36
- 취소일(`cdealDay`)이 있는 레코드 제외
- 거래금액은 원천 만원 단위를 KRW로 환산
- 입력 레코드 집합 hash와 revision lineage 보존

## 6. QA 결과

| 검사 | 결과 |
|---|---|
| SQLite `integrity_check` | `ok` |
| 외래키 위반 | 0 |
| 동일 source 내 canonical URL 중복 | 0 |
| version 없는 source document | 0 |
| collection run 연결 없는 document version | 0 |
| 완료되지 않은 collection run | 0 |
| 수집기 통합 테스트 | 9개 통과 |
| CLI 회귀 테스트 | 3개 통과 |

## 7. 현재 제한사항

1. Google News RSS는 제목·링크·발행시각·RSS snippet만 저장했으며 기사 전문은 저장하지 않았습니다.
2. RSS 검색 결과는 검색엔진 색인·랭킹·보존 정책에 영향을 받으므로 인터넷 전체 전수를 의미하지 않습니다.
3. OpenDART 1차 범위는 유형자산 양도·취득 등 매각 후보 중심입니다. PF·대출·투자 관련 공시 본문 분류는 후속 단계입니다.
4. 국토교통부 실거래 1차 범위는 서울 비주거용 부동산입니다. 전국 확장은 아직 수행하지 않았습니다.
5. canonical event, asset, project, participant resolution은 아직 수행하지 않았습니다.
6. macro는 서울 비주거 실거래 파생 시계열 3개만 완료됐습니다. 금리·공실률·임대료·인허가·공급·PF 통계는 후속 소스 연결 대상입니다.

## 8. 다음 실행 순서

1. 기사 URL family와 제목 유사도를 사용한 문서·event mention 군집화
2. 서울 실거래의 주소·용도·면적을 이용한 자산 후보 resolution
3. OpenDART 원문 본문에서 거래금액·자산명·상대방 claim 추출
4. 매각·임대·공급·인허가·PF·대출·투자별 primary evidence 보강
5. 검수 통과 cluster만 canonical event로 승인
6. 국토교통부 실거래 전국 확장과 공식 macro source 추가
7. 2025 event를 2026 후속 문서에서 보정하는 adjacent-year reconciliation
