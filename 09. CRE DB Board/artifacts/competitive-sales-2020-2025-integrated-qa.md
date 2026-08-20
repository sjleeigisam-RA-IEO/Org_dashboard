# 2020–2025 경쟁매각 통합 QA

- 상태: **PASS**
- Schema: `2.4.0`
- Live sale processes: **16** (역사 14 + 2025 calibration 2)
- 심층조사: **47건 → 승인 14 / 비승격 33**
- 관계형 구성: round 18, participation 29, submission 22, funding 8, decision 17, milestone 20
- FK 위반: **0**
- SQLite integrity: **ok**

## 승인 gate

- Office/DC: 6건
- Hotel: 7건
- Logistics: 1건
- 승인 manifest 내 title/snippet-only source claim: **0건**
- 미공개 bidder·vehicle·lender·정확가격·정확일자 추정 없음

## Coverage

- Google News 2020–2024: **240/3420 partitions** (7.02%)
- Google 미완료: **3180** — `UPSTREAM_THROTTLED_NOT_ZERO_FILLED`
- OpenDART 2020–2024 unique sale documents: **1303/1365**, status 014: 62, retryable failure: 0
- 영업양도·양수 subset: **307/318**, status 014: 11
- News review 후보: **59**
- 영업양도·양수 review 후보: **66**
- Review pipeline canonical 자동 생성: **0**

## Process relation

현재 canonical relation edge는 **0건**이다. 양쪽 endpoint가 모두 승인된 별도 attempt pair가 아직 없기 때문이다. 크레센도 우협 변경은 동일 process 내부 round·decision으로 보존했고, 제외·향후 attempt는 승인 전 crosswalk/metadata 상태로 유지했다.

## Final backup

- 파일: `market-post-historical-sale-processes-20260816.db`
- SHA-256: `3d9918d4f61fc869ee7e545bf316422df8ef37a52e935e00a5b8f831e293145d`
- quick_check: `ok`
- FK 위반: `0`
