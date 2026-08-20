# 기업·임차·이전 관계형 감사 및 2020~2025 DB Inventory

- 기준일: 2026-08-16
- 권위 DB: `data/market.db`
- schema: `2.7.0`
- 결과: `PASS WITH COLLECTION GAPS`

## 1. 정보 신뢰도 재정의

공식 결과가 없다는 이유로 구체적인 기사 정보를 빈칸으로 버리지 않는다.

- `CANONICAL_VERIFIED`: 공시·공식결과·당사자 원문 확인
- `LIKELY_REPORTED_PENDING_PRIMARY`: 공식 모집·사건 맥락과 일치하고 full-text 기사가 회사·날짜·금액 등 구체 내용을 보도하며 반증 없음
- `HIGHLY_LIKELY_REPORTED_PENDING_PRIMARY`: 위 조건에 더해 독립 source family 2개 이상 일치
- `NEWS_ONLY_PENDING_PRIMARY`: snippet·비구체 기사·맥락만 있고 핵심 claim 불충분
- `REJECTED_OR_CONTRADICTED_ARCHIVE`: 반증·철회·오탐·범위 제외

같은 보도자료·통신기사의 전재는 하나의 `document_family`로 묶는다. 반복 횟수는 노출 빈도에는 반영하지만 독립 검증 수로 세지 않는다.

## 2. LP 유력정보 관계형 소급 적재

`claims → claim_evidence → mentions → extraction_runs → document_versions → document_families`를 재사용했다.

- 관계형 유력 manager claim: 6건
- 관계형 유력 선정사별 배정금액 claim: 6건
- 공식 선정 manager: 4건
- `v_lp_manager_best_available`: 10건
- canonical `lp_mandate_selections`: 4건 유지
- 반복 import: 0건

즉 조회에는 유력정보가 보이지만 확정 선정·commitment·deployment는 오염되지 않는다.

## 3. 기존 관계형 구조 감사

기존 V2.5에는 다음 기반이 있었다.

- 기업·기관 identity: `organizations`, aliases, identifiers
- 문서 provenance: source/document/version/run/extraction/mention
- 기사 전재 관리: `document_families`, `document_family_members`
- claim과 exact evidence span: `claims`, `claim_evidence`
- 사건·참여자·자산·프로젝트: `events`, `event_participants`, `event_assets`, `event_projects`
- 부동산 사건 taxonomy: SALE, LEASE, SUPPLY, PERMIT, PF, LOAN, INVESTMENT

부족했던 구조:

- 시점별 시총 universe와 순위 이력
- 시점별 산업분류 및 taxonomy version
- 사업영역의 유효기간
- 기업–부동산 점유관계의 유효기간
- 기업 이전 전용 stage
- 사건 당시 universe와의 비교 view

## 4. V2.6 보완 구조

추가 table:

- `industry_taxonomies`
- `industry_nodes`
- `organization_industry_assignments`
- `market_universe_snapshots`
- `market_universe_members`
- `organization_business_activities`
- `organization_property_occupancies`

추가 view:

- `v_company_universe_current`
- `v_company_real_estate_timeline`
- `v_company_event_universe_context`

기업이전 stage:

`RELOCATION_REPORTED → RELOCATION_ANNOUNCED → RELOCATION_SITE_SELECTED → RELOCATION_CONTRACTED → RELOCATION_COMPLETED/CANCELLED`

## 5. 기업 universe campaign

`campaigns/company-tenant-relocation-marketcap-watch.json`

- KRX 전체 시총 상위 50
- KRX 업종별 시총 상위 10
- 당시 부각 산업군 watchlist
- 월말 마지막 거래일 snapshot
- OpenDART 공시 일간 수집
- 회사 IR·보도자료 주간 수집
- 임차·이전 기사 일간/주간 수집
- 기사일 기준 DART 비교창: -90일~+180일
- 사건일 이전 가장 가까운 universe snapshot 연결
- 현재 시총의 과거 소급 적용 금지

## 6. 신규 company intelligence baseline

V2.6 migration 직후 다음 table은 모두 0건이다.

- industry taxonomy/node: 0
- organization industry assignment: 0
- market universe snapshot/member: 0
- organization business activity: 0
- organization property occupancy: 0
- company real-estate timeline: 0

기업 master는 70건이지만 현재 identity 연결 상태는 다음과 같다.

- `organization_aliases`: 0건
- `corporate_no`: 0건
- `business_no`: 0건
- `dart_corp_code`: 0건
- `stock_code`: 0건
- `event_participants.role_code='TENANT'`: 0건

기존 INVESTMENT event는 12건이지만 참여자가 COMPANY가 아니어서 회사 timeline에 잡히지 않는다. 따라서 시총 상위 기업·임차·이전 데이터는 아직 실제 수집 전 상태다. schema와 campaign을 적재 완료로 오인하지 않는다.

## 7. DB 저장용량

- `market.db`: 207,671,296 bytes / 198.05 MiB
- SQLite allocated: 198.05 MiB
- freelist: 0 page
- `raw/`: 4.51 MiB
- `artifacts/`: 10.97 MiB
- `backups/`: 3,167.52 MiB

백업 폴더가 live DB보다 약 16배 크다. 다만 안전·감사 정책상 본 작업에서는 삭제하지 않았다.

### 물리 객체별 배분

APSW `dbstat`를 V2.6·유력금액 반영 후 DB에 read-only로 실행한 결과:

- table: **160.29 MiB** / 168,075,264 bytes
- index: **37.76 MiB** / 39,596,032 bytes
- `document_versions`: **74.02 MiB**
- `event_mentions`: **27.72 MiB**
- `run_documents`: **18.98 MiB**
- `source_documents`: **13.02 MiB**
- `extraction_runs`: **8.98 MiB**
- `review_tasks`: **8.08 MiB**
- `mentions`: **7.13 MiB**

## 8. 논리 정보량

FTS shadow 제외 논리 row: 207,527

- source documents: 37,400
- document versions: 39,289
- run_documents: 40,328
- extraction runs: 36,579
- event mentions: 36,817
- mentions: 9,448
- review tasks: 2,638
- claims: 63
- organizations: 70
- assets: 16
- projects: 0
- canonical events: 28
- sale processes: 16
- LP mandates: 12
- official LP selections: 4
- likely reported LP manager claims: 6
- likely reported LP allocation claims: 6

## 9. 2020~2025 기간 집계

기간 기준은 table별 business date를 사용하며 서로 합산하지 않는다.

- published document versions: 39,288
- distinct published documents: 37,399
- unknown published date versions: 0
- mentions from period documents: 9,448
- claims from period documents: 62
- canonical events by event date: 24
- event mentions with explicit event date: 2
- sale processes launched: 4
- LP mandates by vintage: 12
- official LP selections: 4

`event_mentions` 36,817건 중 event date가 직접 구조화된 건이 매우 적다. 문서 발견량은 크지만 사건 날짜·참여자·자산으로 구조화된 canonical 정보량은 아직 작다는 의미다.

## 10. 텍스트량

- stored text: 4,374,578 chars
- snippets: 12,291,399 chars
- event summaries: 12,302,128 chars
- claim raw values: 1,152 chars

## 11. 검증

- 전체 tests: 90 passed + 5 subtests
- LP integrated QA: PASS
- SQLite quick/integrity: ok
- FK violations: 0
- JSON parse: PASS
- verification candidate schema: 2/2 PASS

## 12. 남은 실행 과제

1. 공식 KRX 필드·산업분류 version을 확정한 snapshot collector 구현
2. DART corp code와 organization identifier 수집·연결
3. 미해결 조직 mention 1,367건의 alias·공식 식별자 보강
4. 참여자 없는 회사사건 12건 검수 및 lease/relocation/investment 관계 수집
5. 과거 월말 universe backfill
6. 회사 사건과 당시 매각·임대·공급·금융 흐름 비교 QA

## 13. V2.7 수집 후 관계정합화 적용

구조적 관계 공백을 반복 수작업으로 남기지 않도록 모든 권위 ingest·extract·manifest import 뒤에 다음 pipeline을 강제했다.

`collection commit → exact identity resolution → ambiguity queue → VERIFIED claim relation promotion → participant/occupancy/business activity upsert → gap QA`

추가 구조:

- `relationship_resolution_runs`: 실행별 입력범위·생성량·미해결량 원장
- `predicate_relationship_rules`: claim role에서 canonical relation으로 승격하는 허용 규칙
- `v_relationship_gaps`: 미해결 mention·식별자 없는 조직·참여자 없는 회사사건
- `SUBJECT_ORGANIZATION`: 사업영역 claim의 명시적 조직 subject

live 전체 데이터 최초 실행:

- 초기 unique exact canonical/alias 자동해결: 23 mention
- 초기 자동해결 조직: 한국자산관리공사 11, 캡스톤자산운용 4, 메테우스자산운용 2, 삼성SRA자산운용 2, 코람코자산운용 2, 하나대체투자자산운용 2
- ambiguous mention: 0
- unresolved organization mention: 1,367
- identifier가 하나도 없는 organization: 70
- participant가 없는 company event: 12
- 신규 participant/occupancy/business activity: 0/0/0

신규 관계 0건은 실패가 아니다. 현재 데이터에 `ACCEPTED + VERIFIED` participant claim, asset/project가 결합된 TENANT 사건, 명시적 subject·시작일을 가진 BUSINESS_DOMAIN claim이 없기 때문이다. 근거 없이 canonical relation을 생성하지 않았고 잔여량은 gap view에 남겼다.

## 14. 독립 review hardening

초기 구현 후 독립 reviewer가 신뢰경계·review queue·collection scope·migration transaction 결함을 지적했고 전 항목을 코드와 schema에서 교차검증했다.

- research candidate가 미등록 manager를 ACTIVE organization으로 생성하던 경로 차단
- candidate import 전체를 단일 transaction으로 묶고 alternate live DB guard 추가
- 열린 review task만 중복 방지, 종료 후 재발 시 새 attempt 생성
- ambiguity·MOLIT scope 조건 해소 시 stale task 자동 종료
- rule의 `minimum_verification_status`를 실제 승격 판정에 적용
- collection-scoped occupancy를 동일 collection claim으로 제한
- invalidated claim의 participant 제거 및 occupancy/business activity `SUPERSEDED`
- migration을 검증 전 commit하지 않고 필수 rule tuple 검증
- zero-insert와 existing-run 성공 경로에도 관계정합화 실행

live 정리 결과:

- candidate-origin ACTIVE organization: 4 → 0
- `INACTIVE / IDENTITY_QUARANTINED`: 4
- 격리 조직으로 향한 selected resolution: 10 → 0
- `IDENTITY_APPROVAL_REQUIRED` pending task: 5
- unresolved organization mention: 1,367
- integrity: ok
- foreign-key violations: 0

hardening 전 backup:

- `backups/market-pre-review-hardening-20260816-154544.db`
- SHA-256 `ad9e39df7b63c7d1d7d717f14f04362f68ba4a2e06f9a991c001f389e39a1081`

동일 pipeline 두 번째 실행은 자동해결·participant·occupancy·business activity 모두 0건으로 idempotency가 확인됐다.
