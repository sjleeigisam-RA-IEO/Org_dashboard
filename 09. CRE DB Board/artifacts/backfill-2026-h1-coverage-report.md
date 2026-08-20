# 2026년 상반기 부동산 시장 인텔리전스 Backfill Coverage Report

## 1. 캠페인 범위

- campaign: `BACKFILL_2026_H1`
- 기간: `2026-01-01` 이상, `2026-07-01` 미만
- 기준: 문서 발행일 기준 category discovery와 거래일 기준 MOLIT 공식 실거래
- 권위 저장소: `data/market.db`
- append 위치: 기존 2025 campaign 이후
- category: SALE, LEASE, NEW_SUPPLY, PERMIT, PF, LOAN, INVESTMENT
- 원천: Google News RSS, OpenDART, 국토교통부 비주거용 부동산 실거래 API

문서 발행일, 거래일, event effective date, macro period, release date, collected-at은 서로 다른 날짜 의미로 보존한다. RSS 문서 수는 사건 수가 아니며, canonical event 승격 전 source document와 event mention 후보로 유지한다.

## 2. 수집 결과

| 원천 | 완료 run | 실패 run | source document | document version |
|---|---:|---:|---:|---:|
| Google News RSS | 100 | 0 | 2,723 | 2,845 |
| MOLIT 비주거 실거래 | 498 | 0 | 14,713 | 14,713 |
| OpenDART | 18 | 0 | 149 | 290 |
| **합계** | **616** | **0** | **17,585** | **17,848** |

OpenDART와 RSS의 version 수가 document 수보다 많은 것은 본문 보강과 recovery 시점의 append-only versioning 때문이다.

## 3. Google News RSS category discovery

| Category | 연결된 distinct document |
|---|---:|
| SALE | 751 |
| LEASE | 239 |
| NEW_SUPPLY | 805 |
| PERMIT | 226 |
| PF | 251 |
| LOAN | 256 |
| INVESTMENT | 266 |

한 문서는 여러 category query에서 발견될 수 있으므로 category 합계는 전체 distinct document와 일치하지 않는다.

### Silent-gap 복구

- 기본 월 partition: 42개
- 기본 월 수집 distinct document: 2,327개
- near-cap 월 기준: 최초 95건, 추가로 90건까지 확대
- 주간 recovery partition: 58개
- recovery 연결 distinct document: 1,502개
- 월 수집에서 없던 recovery-only document: **396개**
- recovery 후 100건 이상 주간 partition: **0개**

월 결과가 90건 이상인 SALE·NEW_SUPPLY 월을 7일 창으로 다시 조회했다. recovery query는 별도 versioned run으로 보존하고 source identity 기준으로 중복을 합쳤다.

## 4. MOLIT 수도권 공식 실거래

- 지역 job: 83개 LAWD_CD
- 월: 6개
- 완료 partition: **498 / 498**
- API/parse mismatch: 0 — mismatch 발생 시 적재 전 runner가 실패하도록 구성
- 정상 0건 partition: 1개 — 부천시 오정구(`41196`), 2026년 1월

| 조회 권역 | API record |
|---|---:|
| 서울 (`11`) | 5,738 |
| 인천 (`28`) | 1,465 |
| 경기 (`41`) | 7,510 |
| **합계** | **14,713** |

조회 geography는 기존 공식 region manifest `2025.1`과 공식 ZIP SHA-256 `7b4b544a6302d26c4f4c89d2c1355beae82e958c786bad8cc8572db0d2e2eb33`을 재사용했다. 이는 API 조회시점의 현행 코드이며 거래시점 행정구역과 동일하다고 가정하지 않는다.

### 분석 범위 정책 적용

| 상태 | 건수 | 의미 |
|---|---:|---|
| EXTRACTED | 78 | 비주거, 건물면적 3,300㎡ 초과 |
| REVIEW_READY | 896 | 1,000~3,300㎡ 또는 동일 거래군 합계 검토 대상 |
| REJECTED | 13,739 | 건물면적 1,000㎡ 이하 |

원천 API record는 삭제하지 않았다. 범위 판정은 event mention 상태와 review task로 분리해 보존했다.

## 5. OpenDART

- 월별 공시 API scan: 4,621개 records
- 유형자산·영업 양수도 필터 문서: 149개
- 최신 version에 원문 저장 성공: **141개**
- 원문 endpoint 반복 실패: **8개**

반복 실패 receipt number:

- `20260106000306`
- `20260119000011`
- `20260130000741`
- `20260513000166`
- `20260605000640`
- `20260609000067`
- `20260630000277`
- `20260630001008`

8건은 metadata·공시 URL·실패 사실을 보존했으며, 성공하지 않은 본문을 추정하거나 합성하지 않았다. `유형자산취득`과 `영업양도/양수`를 포함하도록 full-text job을 V3로 확대했고, 기존 V2 checkpoint와 분리하여 실제 append를 검증했다.

## 6. 추출·관계·macro

- 최신 eligible document version: **17,585개**
- `TITLE_SNIPPET_V1` 추출 완료: **17,585개 / 17,585개**
- bid-process review candidate: **90개**
- 2026년 1~6월 서울 MOLIT macro release: **6개**
- macro observation: **18개** — 건수·거래금액·건물면적 3개 series × 6개월
- 관계정합화 최종 신규 canonical relation: 0
- 기존 unresolved organization mention: 1,367

문서 수집 결과를 자동 canonical event로 승격하지 않았다. 매각 프로세스 후보도 evidence review queue에 두었다.

## 7. 2025 이후 연속성

| 월 | RSS document | OpenDART document |
|---|---:|---:|
| 2025-12 | 432 | 43 |
| 2026-01 | 448 | 23 |

2026 H1 job metadata의 campaign 값이 공통 ingester의 2025 hard-code를 상속한 문제를 발견해 `BACKFILL_YYYY[_H1|H2]` job prefix에서 파생하도록 수정했다. 기존 2026 job 95개의 metadata도 `BACKFILL_2026_H1`로 교정했으며 잔여 오류는 0개다.

## 8. QA

| 검사 | 결과 |
|---|---|
| SQLite `integrity_check` | `ok` |
| foreign-key violations | 0 |
| version 없는 source document | 0 |
| source 내 canonical URL 중복 | 0 |
| 2026 campaign failed run | 0 |
| 잘못된 2026 campaign metadata | 0 |
| 전체 test suite | 91 passed + 5 subtests |
| fresh-schema validator | PASS |
| runner syntax compile | PASS |

## 9. Backup

### Pre-campaign

- 파일: `backups/market-pre-backfill-2026-h1-20260816-162557.db`
- SHA-256: `302cca082e00c59d57a2430d72546249222f7d86b55ae52112eb60261c5c506a`

### Post-campaign

- 파일: `backups/market-post-backfill-2026-h1-20260816-171851.db`
- 크기: 290,455,552 bytes
- SHA-256: `cc692afb71172ea89cae3230e9abe3b4c26c45fdbd4497bad174dd11df2367ef`
- backup integrity: `ok`
- backup foreign-key violations: 0

## 10. 한계

1. Google News RSS는 title·publisher·link·published-at·snippet만 저장하며 기사 본문을 저장하지 않는다.
2. RSS coverage는 선언한 query partition의 완결성을 의미하며 인터넷 전체의 완전수집을 의미하지 않는다.
3. OpenDART는 유형자산·영업 양수도 키워드 필터에 한정하며 8건의 원문 endpoint가 반복 실패했다.
4. MOLIT는 비주거 실거래 수도권 83개 조회코드에 한정한다.
5. canonical asset/event/entity 승격은 별도의 보수적 resolution과 evidence review가 필요하다.
6. 1,000~3,300㎡ 및 동일 거래군 검토 대상 896건은 자동 투자대상으로 승격하지 않았다.

## 11. 산출물

- campaign manifest: `campaigns/backfill-2026-h1.json`
- RSS summary: `artifacts/backfill-2026-h1-google-news-rss-summary.json`
- RSS recovery summary: `artifacts/backfill-2026-h1-google-news-rss-recovery-summary.json`
- MOLIT 서울 summary: `artifacts/backfill-2026-h1-molit-seoul-summary.json`
- MOLIT 인천·경기 summary: `artifacts/backfill-2026-h1-molit-capital-summary.json`
- OpenDART 목록 summary: `artifacts/backfill-2026-h1-opendart-sale-v2-summary.json`
- OpenDART full-text summary: `artifacts/backfill-2026-h1-opendart-sale-document-text-v3-summary.json`
- 후처리 summary: `artifacts/backfill-2026-h1-post-processing-summary.json`
- QA JSON: `artifacts/backfill-2026-h1-qa.json`
