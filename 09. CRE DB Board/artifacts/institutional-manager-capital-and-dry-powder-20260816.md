# 국내 자산운용사 기관 위탁자금·Dry Powder 현황

- 기준 DB: `C:\10137_WorkSpace\00. 2025 RA 기획추진\RA dashboard\09. CRE DB Board\data\market.db`
- 생성시각(UTC): `2026-08-19T05:10:18.079907+00:00`
- schema: `2.8.0`
- 분석범위: 현재 live DB에 적재된 2020~2025 LP mandate corpus

## Executive conclusion

- 현재 DB에서 **검증 가능한 회사별 dry powder는 0원이 아니라 산정 불가**다.
- 공식 selection 4건은 확인되지만 vehicle link 0건, deployment 0건, balance projection 0건이다.
- 따라서 배정·출자요청·목표 펀드규모에서 알려진 거래액을 차감하지 않았다.
- 기사상 likely allocation 합계 3,500억원은 참고치이며 공식 위탁액·약정액·dry powder 합계에서 제외했다.

## 1. 공식 선정된 국내 자산운용사

| 회사 | 기관 LP·프로그램 | 공식 확인 금액 문맥 | 자금 추적 상태 | Dry powder |
|---|---|---:|---|---:|
| 우리글로벌자산운용 | 한국성장금융투자운용 · KGROWTH-2021-ROLLING-INFRA | 270억원 track 상한 | `OFFICIAL_SELECTED_NO_COMMITMENT` | 산정 불가 |

### 우리글로벌자산운용

- 한국성장금융 정책형 뉴딜펀드 2021년 인프라투자형 공식 선정.
- 정책출자자 위탁운용금액은 **270억원 이내**, 목표결성금액은 **900억원**.
- 270억원은 track 공고 상한이며 selection-specific commitment·납입액이 아니다.
- vehicle·capital call·집행·회수 자료가 없어 dry powder는 산정 불가.

## 2. 기사상 선정·배정 보도 — 공식 합계 제외

| 회사 | 기관 LP | 보도상 배정액 | 근거 상태 | Dry powder |
|---|---|---:|---|---:|
| 메테우스자산운용 | 건설근로자공제회 | 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 삼성SRA자산운용 | 건설근로자공제회 | 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 캡스톤자산운용 | 건설근로자공제회 | 1,300억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 코람코자산운용 | 건설근로자공제회 | 700억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 하나대체투자자산운용 | 건설근로자공제회 | 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |

보도상 합계는 캡스톤 1,300억원, 코람코 700억원, 삼성SRA·메테우스·하나대체투자자산운용 각 500억원이다. 공식 선정 결과와 약정·납입 자료가 없어 canonical total에는 포함하지 않는다.

## 3. 국내 기타 GP

### 쿨리지코너인베스트먼트 — KVIC-2020-Q4-URBAN-REGEN
- 기관 LP: 한국벤처투자
- 공식 선정일: 2020-11-17
- 결과표 출자요청액: 200억원
- 자금 추적 상태: `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY`
- 출자요청액은 확정 약정·납입액이 아니므로 dry powder 산정에서 제외.

### 쿨리지코너인베스트먼트 — KVIC-2021-SEP-URBAN-REGEN
- 기관 LP: 한국벤처투자
- 공식 선정일: 2021-11-01
- 결과표 출자요청액: 100억원
- 자금 추적 상태: `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY`
- 출자요청액은 확정 약정·납입액이 아니므로 dry powder 산정에서 제외.

## 4. 해외 manager 부록

- **GCM Grosvenor** — 대한지방행정공제회 `POBA-2021-GLOBAL-PRIVATE-INFRA-SMA` 공식 선정; 선정금액 미공개; dry powder 산정 불가.

## 5. 회사에 귀속하지 못한 공식 mandate

| Vintage | 기관 LP | 프로그램 | 공식 금액 문맥 |
|---:|---|---|---|
| 2020 | 대한지방행정공제회 | `POBA-2020-DOMESTIC-OFFICE-BLIND` | PROGRAM_TOTAL ≤3,000억원 |
| 2022 | 건설근로자공제회 | `CW-2022-DOMESTIC-RE-DEBT` | ALLOCATION_PER_MANAGER ≤1,000억원 |
| 2023 | 공무원연금공단 | `GEPS-2023-GLOBAL-RE-DEBT` | TARGET_FUND_SIZE ≥500,000,000 USD |
| 2024 | 건설근로자공제회 | `CW-2024-DOMESTIC-SENIOR-RE-DEBT` | TRACK_LP_COMMITMENT ≤2,000억원; ALLOCATION_PER_MANAGER ≤500억원 |
| 2024 | 공무원연금공단 | `GEPS-2024-GLOBAL-REAL-ESTATE` | TARGET_FUND_SIZE ≥500,000,000 USD |
| 2024 | 한국교직원공제회 | `KTCU-2024-THE-K-HOTEL-REDEVELOPMENT` | 금액 미구조화 |
| 2025 | 공무원연금공단 | `GEPS-2025-GLOBAL-INFRA` | ALLOCATION_PER_MANAGER ≤50,000,000 EUR; TARGET_FUND_SIZE ≥1,000,000,000 EUR |
| 2025 | 한국교직원공제회 | `KTCU-2025-REGIONAL-GOLF-COURSE` | PROGRAM_TOTAL 약 5,000억원 |

## 6. Dry powder 판정 기준

```text
verified available capital =
  verified committed or paid-in basis
  - verified invested/deployed
  - verified fees/costs
  - verified cancelled amount
  + verified realized/recyclable amount when reuse is explicitly allowed
```

현재 DB에는 회사별 paid-in, capital call, vehicle 연결, LP-source deployment, realization, fee, cancellation이 없다. 따라서 숫자 0을 쓰지 않고 `INSUFFICIENT_EVIDENCE`로 표시한다.

## 7. Evidence guard

- 공식 공고의 program/track 금액은 공식이지만 특정 회사 commitment와 같지 않다.
- 출자요청액은 awarded·committed·paid-in과 같지 않다.
- 기사상 allocation은 공식 결과가 확보될 때까지 likely layer에 둔다.
- target fund size에는 GP·제3자 자금이 포함될 수 있다.
- 거래 취득가를 배정액에서 차감해 dry powder를 만들지 않는다.
- vehicle·deal source가 연결되지 않은 상태에서 미공개 deployment를 0으로 가정하지 않는다.

## 8. QA

- integrity: `ok`
- FK violations: `0`
- official selections: `4`
- likely manager claims: `6`
- vehicle links: `0`
- deployments: `0`
- balance rows: `0`
- verified available 값을 임의 생성하지 않음: `PASS`

## 9. 주요 직접 근거

### 공식 선정 결과

- GCM Grosvenor — [글로벌 사모인프라 SMA 위탁운용사 선정결과](https://www.poba.or.kr/bbs/selectNttDetail?sechBbsSeq=10&sechBbstSeq=75327) · 대한지방행정공제회 · 2021-07-07
- 우리글로벌자산운용 — [정책형 뉴딜펀드 2021년 수시 위탁운용사 선정 결과](https://www.kgrowth.or.kr/notice_view.asp?idx=509&str_type=1&tab=1) · 한국성장금융투자운용 · 2021-06-28
- 쿨리지코너인베스트먼트 — [한국모태펀드 2020년 4차 정시 출자사업 선정 결과](https://www.kvic.or.kr/fileDown?boardDataNo=3163&idx=1) · 한국벤처투자 · 2020-11-17
- 쿨리지코너인베스트먼트 — [한국모태펀드 2021년 9월 수시 출자사업 선정 결과](https://www.kvic.or.kr/fileDown?boardDataNo=3390&idx=1) · 한국벤처투자 · 2021-11-01

### 기사상 likely 선정·배정

- [2024 국내 부동산 선순위 대출펀드 위탁운용사 선정](https://www.fnnews.com/news/202404290711016886) · 파이낸셜뉴스 · 2024-04-29 · 공식 결과 추가 확인 필요
- [2022 국내 부동산 대출형 블라인드 펀드 위탁운용사 선정](https://www.edaily.co.kr/News/Read?newsId=03073366632562784) · 이데일리 · 2022-12-27T18:55:59+09:00 · 공식 결과 추가 확인 필요

## 10. 다음 조사 우선순위

1. 기사상 2022·2024 건설근로자공제회 선정사의 공식 결과 원문 확보
2. 선정 운용사의 실제 fund·REIT·SPC 식별
3. LP commitment·capital call·paid-in 공시 확보
4. vehicle→deal deployment와 금액 basis 연결
5. 회수·재투자 허용·비용·취소 조건 확보
