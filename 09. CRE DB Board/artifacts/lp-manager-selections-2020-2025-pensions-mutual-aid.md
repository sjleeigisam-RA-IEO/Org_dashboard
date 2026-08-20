# 2020~2025 1차 연기금·공제회 CRE 관련 공개 위탁운용 절차

## 범위와 판정 원칙

- 대상: 대한지방행정공제회, 공무원연금공단, 한국교직원공제회의 2020-01-01~2025-12-31 공개 위탁운용 절차.
- 공식 기관 게시물과 기관 명의 KOFIA 재배포 공고/RFP만 근거로 사용했다. 검색 snippet은 근거에서 제외했다.
- 공식 선정결과가 없는 공고는 운용사를 `UNKNOWN`으로 유지했다.
- 금액은 `PROGRAM_TOTAL`, `ALLOCATION_PER_MANAGER`, `SELECTION_LP_COMMITMENT`, `TARGET_FUND_SIZE`를 혼합하지 않았다.
- 상장 REITs/상장인프라는 원 조사 범위에는 포함하되 정책의 `PURE_LISTED_EQUITY` 제외 적용 여부를 검토 메모로 남겼다.

## 요약

- 구조화 절차: **12건** / LP **3개**
- 공식 선정결과 확인: **3건**
- 선정 운용사 UNKNOWN: **9건**

## 절차 목록

| 공고일 | LP | 공고 | 전략 | 금액 basis | 선정 운용사 | 결과 근거 |
|---|---|---|---|---|---|---|
| 2020-04-22 | 대한지방행정공제회 | 2020년도 행정공제회 해외 상장인프라 SMA 위탁운용사 선정공고 | INFRASTRUCTURE | UNKNOWN | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2020-11-26 | 대한지방행정공제회 | 국내 오피스 블라인드 펀드 위탁운용사 선정 공고 | REAL_ESTATE | PROGRAM_TOTAL: 위탁금액 : 3천억원 이내 | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2020-12-07 | 대한지방행정공제회 | 대한지방행정공제회 글로벌 REITs 위탁운용사 Pool 선정 공고 | REAL_ESTATE | ALLOCATION_PER_MANAGER: 약정 금액1)・USD 100Mil | AEW | CONFIRMED_OFFICIAL |
| 2020-12-18 | 대한지방행정공제회 | 행정공제회 글로벌 상장인프라 SMA 위탁운용사 Pool 선정공고 | INFRASTRUCTURE | UNKNOWN | DWS, First Sentier | CONFIRMED_OFFICIAL |
| 2021-05-10 | 대한지방행정공제회 | 글로벌 사모인프라 SMA 위탁운용사 선정공고 | INFRASTRUCTURE | UNKNOWN | GCM Grosvenor | CONFIRMED_OFFICIAL |
| 2025-03-17 | 대한지방행정공제회 | 2025년 행정공제회 글로벌리츠(상장REITs) 운용사 선정계획 공고 | REAL_ESTATE | ALLOCATION_PER_MANAGER: 해외 USD 150Mil; ALLOCATION_PER_MANAGER: 국내 USD 100Mil | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2025-05-12 | 대한지방행정공제회 | 2025년 행정공제회 글로벌 상장인프라 운용사 선정계획 공고 | INFRASTRUCTURE | PROGRAM_TOTAL: 총 USD 300m; ALLOCATION_PER_MANAGER: 3개사 각 USD 100m | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2023-06-29 | 공무원연금공단 | [공무원연금공단] 위탁운용사 선정계획 공고 | PRIVATE_DEBT | ALLOCATION_PER_MANAGER: 운용사당35mn이내(USD또는EUR); TARGET_FUND_SIZE: 최종 모집금액 기준 USD500mn이상 | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2024-07-12 | 공무원연금공단 | [공무원연금공단] 2024년도 글로벌 부동산 펀드 해외 위탁운용사 선정 | REAL_ESTATE | ALLOCATION_PER_MANAGER: 운용사당35mn이내(USD또는EUR); TARGET_FUND_SIZE: 최종 모집금액 기준 USD500mn이상 | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2024-07-08 | 한국교직원공제회 | [한국교직원공제회] The-K호텔서울 부지 재개발 사업 위탁 운용사 선정 공고 | REAL_ESTATE | UNKNOWN | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2025-07-07 | 한국교직원공제회 | [한국교직원공제회] 권역별 골프장 투자 사업 위탁운용사 선정 공고 | REAL_ESTATE | PROGRAM_TOTAL: 출자규모 : 5,000억원 내외 | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |
| 2025-09-09 | 공무원연금공단 | [공무원연금공단] 글로벌 인프라 펀드 해외 위탁운용사 선정 공고 | INFRASTRUCTURE | ALLOCATION_PER_MANAGER: 운용사당 50mn 이내(EUR 통화 한정); TARGET_FUND_SIZE: 최종 모집금액 기준 EUR 1bn 이상 | UNKNOWN | NO_OFFICIAL_RESULT_FOUND |

## 승인 후보

- `fixtures/lp-mandate-candidates/pensions-mutual-aid/POBA-2021-GLOBAL-PRIVATE-INFRA-SMA.json`
- 공식 공고와 공식 선정결과가 모두 있으며, 결과 원문이 GCM Grosvenor를 명시한다.
- 상태는 `REVIEW_READY`; 상위 승인 전에는 importer가 요구하는 `APPROVED`가 아니므로 import 대상이 아니다.

## 범위 제외

- 공무원연금공단 2025 해외 대체투자 국내 위탁관리운용사: 공고문이 **부동산펀드 제외**를 명시해 CRE 구조화 대상에서 제외.

## 주의사항

- 선정 결과는 투자약정·capital call·paid-in·deployment를 의미하지 않는다.
- 공고 단계 배정액을 선정 운용사별 확정 약정액(`SELECTION_LP_COMMITMENT`)으로 승격하지 않았다.
- 후보 manifest는 상위 승인 대기 상태이며 live DB를 수정하지 않았다.
