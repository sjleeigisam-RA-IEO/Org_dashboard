# 2020-2025 국내 LP 위탁운용 통합 QA·Coverage

- 생성시각(UTC): `2026-08-16T04:51:36.229031+00:00`
- DB: `C:\10137_WorkSpace\real-estate-market-intelligence\data\market.db`
- schema: `2.6.0`
- QA: **PASS**

## Live canonical coverage

- 승인 mandate: **12건**
- 전략 track: **12건**
- 공식 선정 manager row: **4건**
- 관계형 유력 manager claim: **6건**
- 관계형 유력 배정금액 claim: **6건**
- 추측성·검증대기 manifest: **2건**
- 구조화 guideline: **28건**
- 금액 row: **17건**
- vehicle link: **0건**
- deal deployment: **0건**
- residual source projection: **0건**

## Officially supported selections

- `KGROWTH-2021-ROLLING-INFRA` — **우리글로벌자산운용** (2021-06-28)
- `KVIC-2020-Q4-URBAN-REGEN` — **쿨리지코너인베스트먼트** (2020-11-17)
- `KVIC-2021-SEP-URBAN-REGEN` — **쿨리지코너인베스트먼트** (2021-11-01)
- `POBA-2021-GLOBAL-PRIVATE-INFRA-SMA` — **GCM Grosvenor** (2021-07-07)

## Likely reported selections pending primary verification

- `CW-2022-DOMESTIC-RE-DEBT` — **캡스톤자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `80000000000 KRW` · confidence `0.72`
- `CW-2022-DOMESTIC-RE-DEBT` — **코람코자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `70000000000 KRW` · confidence `0.72`
- `CW-2024-DOMESTIC-SENIOR-RE-DEBT` — **메테우스자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `50000000000 KRW` · confidence `0.72`
- `CW-2024-DOMESTIC-SENIOR-RE-DEBT` — **삼성SRA자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `50000000000 KRW` · confidence `0.72`
- `CW-2024-DOMESTIC-SENIOR-RE-DEBT` — **캡스톤자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `50000000000 KRW` · confidence `0.72`
- `CW-2024-DOMESTIC-SENIOR-RE-DEBT` — **하나대체투자자산운용** · `LIKELY_REPORTED_PENDING_PRIMARY` · `50000000000 KRW` · confidence `0.72`

## QA checks

- 2020~2025 범위 위반: `0`
- 미승인 live row: `0`
- source claim 없는 guideline: `0`
- source claim 없는 amount: `0`
- FK 위반: `0`
- integrity: `ok`

## Interpretation guards

- 공식 결과가 없는 mandate의 canonical manager는 비우되 best-available 조회에는 유력정보 상태로 표시함.
- 기사 기반 선정사·귀속금액은 relational verification layer에 보관하고 canonical selection·잔액·deployment에서 제외함.
- `출자요청액`은 확정 약정·납입액으로 승격하지 않음.
- `TARGET_FUND_SIZE`는 LP source balance에 포함하지 않음.
- 공식 vehicle·deal 증거가 없으므로 deployment와 residual source는 0건이 정상.

## Coverage gaps

- 국민연금·우정사업본부·군인공제회·경찰공제회·과학기술인공제회는 공식 게시판 전수 역탐색이 추가로 필요함.
- 공무원연금·교직원공제회·건설근로자공제회·우정사업본부의 일부 선정사명은 언론 근거만 있어 REVIEW_READY 또는 research-only로 유지함.
- KIC·HUG·캠코·IBK 및 도시재생 후속 연도는 공식 계획–결과 쌍을 충분히 확보하지 못함.
- 공식 fund·REIT·SPC와 특정 deal의 연결 증거가 아직 없어 deployment와 residual source를 의도적으로 생성하지 않음.
