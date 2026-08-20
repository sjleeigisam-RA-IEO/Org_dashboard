# 운용사별 기관 LP 위탁운용펀드·Dry Powder 통합보고서

- 기준 DB: `C:\10137_WorkSpace\00. 2025 RA 기획추진\RA dashboard\09. CRE DB Board\data\market.db`
- schema: `2.8.0`
- 범위: 현재 적재된 2020~2025 LP mandate 자료
- 금액 원칙: 펀드 목표규모·기관 공고액·출자요청액·기사상 배정액·확정 commitment를 분리

## Executive summary

현재 DB로는 각 운용사가 어떤 LP 프로그램에 선정·보도됐는지와 금액 문맥은 정리할 수 있다. 다만 현재 운용 중인 순자산이나 실제 남은 dry powder는 확인할 수 없다.

| 운용사 | LP·프로그램 | 관리규모로 참고 가능한 금액 문맥 | 근거 상태 | 확인 dry powder |
|---|---:|---|---|---:|
| 우리글로벌자산운용 | 1개 LP · 1개 프로그램 | 펀드 목표/결성예정 900억원; 기관 track 공고액 270억원 | `OFFICIAL_SELECTED_NO_COMMITMENT` | 산정 불가 |
| 캡스톤자산운용 | 1개 LP · 2개 프로그램 | 기사상 배정 1,300억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 코람코자산운용 | 1개 LP · 1개 프로그램 | 기사상 배정 700억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 삼성SRA자산운용 | 1개 LP · 1개 프로그램 | 기사상 배정 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 메테우스자산운용 | 1개 LP · 1개 프로그램 | 기사상 배정 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 하나대체투자자산운용 | 1개 LP · 1개 프로그램 | 기사상 배정 500억원 | `LIKELY_REPORTED_PENDING_PRIMARY` | 산정 불가 |
| 쿨리지코너인베스트먼트 | 1개 LP · 2개 프로그램 | 펀드 목표/결성예정 375억원; 기관 track 공고액 300억원; 출자요청·결과표 300억원 | `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY` | 산정 불가 |
| GCM Grosvenor | 1개 LP · 1개 프로그램 | 금액 미공개 | `OFFICIAL_SELECTED_NO_AMOUNT` | 산정 불가 |

### 표 읽는 법

- **펀드 목표/결성예정액**: LP 외 제3자·GP 자금을 포함할 수 있어 기관 위탁액이 아니다.
- **기관 track 공고액**: 프로그램 단계의 예산·상한이며 운용사 확정 commitment가 아니다.
- **출자요청액**: 선정결과에 실렸어도 확정 약정·납입액은 아니다.
- **기사상 배정액**: 공식 결과가 확보되지 않은 likely 정보다.
- **확인 dry powder**: 약정·납입·집행·회수 자료가 없어 모든 회사가 산정 불가다.

## 1. 우리글로벌자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 한국성장금융투자운용
- 프로그램 수: 1건
- 자금 추적 상태: `OFFICIAL_SELECTED_NO_COMMITMENT`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2021 | 한국성장금융투자운용 | `KGROWTH-2021-ROLLING-INFRA` · 인프라투자형 | `OFFICIAL_SELECTED_NO_COMMITMENT` | 900억원 | 270억원 | — | — |

### 해석

- 한국성장금융 정책형 뉴딜펀드 인프라투자형의 공식 선정 운용사다.
- 펀드 목표규모 900억원, 정책출자자 위탁운용금액 270억원 이내다.
- 270억원은 단일 manager track의 공식 상한이지만 실제 약정·납입·현재 운용잔액은 확인되지 않았다.

### 근거

- 공식: [정책형 뉴딜펀드 2021년 수시(인프라투자) 선정계획 공고](https://www.kgrowth.or.kr/down_file.asp?idx=482&SelType=Notice3) · 한국성장금융투자운용 · 2021-04-23
- 공식: [정책형 뉴딜펀드 2021년 수시 위탁운용사 선정 결과](https://www.kgrowth.or.kr/notice_view.asp?idx=509&str_type=1&tab=1) · 한국성장금융투자운용 · 2021-06-28

## 2. 캡스톤자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 건설근로자공제회
- 프로그램 수: 2건
- 자금 추적 상태: `LIKELY_REPORTED_PENDING_PRIMARY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2022 | 건설근로자공제회 | `CW-2022-DOMESTIC-RE-DEBT` · 국내 부동산 대출형 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | 운용사당 상한 ≤1,000억원 | — | 800억원 |
| 2024 | 건설근로자공제회 | `CW-2024-DOMESTIC-SENIOR-RE-DEBT` · 국내 부동산 선순위 대출 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | track 기관재원 ≤2,000억원; 운용사당 상한 ≤500억원 | — | 500억원 |

### 해석

- 건설근로자공제회 위탁운용사로 보도됐으며 현재 적재된 기사상 배정액 합계는 1,300억원이다.
- 공식 공고는 프로그램과 상한을 확인하지만 공식 선정결과 원문은 확보되지 않았다.
- 따라서 해당 금액은 likely allocation이며 실제 약정·납입·현재 운용잔액으로 확정할 수 없다.

### 근거

- 공식: [국내부동산 대출형 블라인드 펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2022/10/FA065CDD-F8C0-6154-3420-A03CBEC69453.hwp) · 건설근로자공제회 · 2022-10-06
- 기사/likely: [2022 국내 부동산 대출형 블라인드 펀드 위탁운용사 선정](https://www.edaily.co.kr/News/Read?newsId=03073366632562784) · 이데일리 · 2022-12-27T18:55:59+09:00
- 공식: [국내 부동산 선순위 대출펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2024/02/688D70C7-A11C-62FA-2409-AC240F606576.hwp) · 건설근로자공제회 · 2024-02-13
- 기사/likely: [2024 국내 부동산 선순위 대출펀드 위탁운용사 선정](https://www.fnnews.com/news/202404290711016886) · 파이낸셜뉴스 · 2024-04-29

## 3. 코람코자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 건설근로자공제회
- 프로그램 수: 1건
- 자금 추적 상태: `LIKELY_REPORTED_PENDING_PRIMARY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2022 | 건설근로자공제회 | `CW-2022-DOMESTIC-RE-DEBT` · 국내 부동산 대출형 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | 운용사당 상한 ≤1,000억원 | — | 700억원 |

### 해석

- 건설근로자공제회 위탁운용사로 보도됐으며 현재 적재된 기사상 배정액 합계는 700억원이다.
- 공식 공고는 프로그램과 상한을 확인하지만 공식 선정결과 원문은 확보되지 않았다.
- 따라서 해당 금액은 likely allocation이며 실제 약정·납입·현재 운용잔액으로 확정할 수 없다.

### 근거

- 공식: [국내부동산 대출형 블라인드 펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2022/10/FA065CDD-F8C0-6154-3420-A03CBEC69453.hwp) · 건설근로자공제회 · 2022-10-06
- 기사/likely: [2022 국내 부동산 대출형 블라인드 펀드 위탁운용사 선정](https://www.edaily.co.kr/News/Read?newsId=03073366632562784) · 이데일리 · 2022-12-27T18:55:59+09:00

## 4. 삼성SRA자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 건설근로자공제회
- 프로그램 수: 1건
- 자금 추적 상태: `LIKELY_REPORTED_PENDING_PRIMARY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2024 | 건설근로자공제회 | `CW-2024-DOMESTIC-SENIOR-RE-DEBT` · 국내 부동산 선순위 대출 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | track 기관재원 ≤2,000억원; 운용사당 상한 ≤500억원 | — | 500억원 |

### 해석

- 건설근로자공제회 위탁운용사로 보도됐으며 현재 적재된 기사상 배정액 합계는 500억원이다.
- 공식 공고는 프로그램과 상한을 확인하지만 공식 선정결과 원문은 확보되지 않았다.
- 따라서 해당 금액은 likely allocation이며 실제 약정·납입·현재 운용잔액으로 확정할 수 없다.

### 근거

- 공식: [국내 부동산 선순위 대출펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2024/02/688D70C7-A11C-62FA-2409-AC240F606576.hwp) · 건설근로자공제회 · 2024-02-13
- 기사/likely: [2024 국내 부동산 선순위 대출펀드 위탁운용사 선정](https://www.fnnews.com/news/202404290711016886) · 파이낸셜뉴스 · 2024-04-29

## 5. 메테우스자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 건설근로자공제회
- 프로그램 수: 1건
- 자금 추적 상태: `LIKELY_REPORTED_PENDING_PRIMARY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2024 | 건설근로자공제회 | `CW-2024-DOMESTIC-SENIOR-RE-DEBT` · 국내 부동산 선순위 대출 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | track 기관재원 ≤2,000억원; 운용사당 상한 ≤500억원 | — | 500억원 |

### 해석

- 건설근로자공제회 위탁운용사로 보도됐으며 현재 적재된 기사상 배정액 합계는 500억원이다.
- 공식 공고는 프로그램과 상한을 확인하지만 공식 선정결과 원문은 확보되지 않았다.
- 따라서 해당 금액은 likely allocation이며 실제 약정·납입·현재 운용잔액으로 확정할 수 없다.

### 근거

- 공식: [국내 부동산 선순위 대출펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2024/02/688D70C7-A11C-62FA-2409-AC240F606576.hwp) · 건설근로자공제회 · 2024-02-13
- 기사/likely: [2024 국내 부동산 선순위 대출펀드 위탁운용사 선정](https://www.fnnews.com/news/202404290711016886) · 파이낸셜뉴스 · 2024-04-29

## 6. 하나대체투자자산운용

- 분류: `DOMESTIC_ASSET_MANAGER`
- 연결 LP: 건설근로자공제회
- 프로그램 수: 1건
- 자금 추적 상태: `LIKELY_REPORTED_PENDING_PRIMARY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2024 | 건설근로자공제회 | `CW-2024-DOMESTIC-SENIOR-RE-DEBT` · 국내 부동산 선순위 대출 | `LIKELY_REPORTED_PENDING_PRIMARY` | — | track 기관재원 ≤2,000억원; 운용사당 상한 ≤500억원 | — | 500억원 |

### 해석

- 건설근로자공제회 위탁운용사로 보도됐으며 현재 적재된 기사상 배정액 합계는 500억원이다.
- 공식 공고는 프로그램과 상한을 확인하지만 공식 선정결과 원문은 확보되지 않았다.
- 따라서 해당 금액은 likely allocation이며 실제 약정·납입·현재 운용잔액으로 확정할 수 없다.

### 근거

- 공식: [국내 부동산 선순위 대출펀드 위탁운용사 선정 공고](https://www.cw.or.kr/upload/boardAdmin/2024/02/688D70C7-A11C-62FA-2409-AC240F606576.hwp) · 건설근로자공제회 · 2024-02-13
- 기사/likely: [2024 국내 부동산 선순위 대출펀드 위탁운용사 선정](https://www.fnnews.com/news/202404290711016886) · 파이낸셜뉴스 · 2024-04-29

## 7. 쿨리지코너인베스트먼트

- 분류: `DOMESTIC_OTHER_GP`
- 연결 LP: 한국벤처투자
- 프로그램 수: 2건
- 자금 추적 상태: `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2020 | 한국벤처투자 | `KVIC-2020-Q4-URBAN-REGEN` · 도시재생 | `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY` | 250억원 | 200억원 | 200억원 | — |
| 2021 | 한국벤처투자 | `KVIC-2021-SEP-URBAN-REGEN` · 도시재생 | `OFFICIAL_SELECTED_REQUEST_AMOUNT_ONLY` | 125억원 | 100억원 | 100억원 | — |

### 해석

- 한국모태펀드 도시재생 분야에 2020·2021년 두 차례 공식 선정됐다.
- 결성예정/목표액 합계 375억원, 결과표상 출자요청액 합계 300억원이다.
- 300억원은 확정 commitment가 아니므로 현재 AUM이나 dry powder로 표시하지 않는다.

### 근거

- 공식: [한국모태펀드 2020년 4차 정시 출자사업 계획 공고](https://www.kvic.or.kr/fileDown?boardDataNo=3138&idx=1) · 한국벤처투자 · 2020-09-28
- 공식: [한국모태펀드 2020년 4차 정시 출자사업 선정 결과](https://www.kvic.or.kr/fileDown?boardDataNo=3163&idx=1) · 한국벤처투자 · 2020-11-17
- 공식: [한국모태펀드 2021년 9월 수시 출자사업 계획 공고](https://www.kvic.or.kr/fileDown?boardDataNo=3356&idx=1) · 한국벤처투자 · 2021-09-03
- 공식: [한국모태펀드 2021년 9월 수시 출자사업 선정 결과](https://www.kvic.or.kr/fileDown?boardDataNo=3390&idx=1) · 한국벤처투자 · 2021-11-01

## 8. GCM Grosvenor

- 분류: `FOREIGN_MANAGER`
- 연결 LP: 대한지방행정공제회
- 프로그램 수: 1건
- 자금 추적 상태: `OFFICIAL_SELECTED_NO_AMOUNT`
- 검증된 commitment: **—**
- 검증된 dry powder: **산정 불가** (`INSUFFICIENT_EVIDENCE`)

### 프로그램별 현황

| 연도 | 기관 LP | 프로그램·전략 | 자금 추적 상태 | 펀드 목표규모 | 공식 공고 규모 | 출자요청/결과표 | 기사상 배정 |
|---:|---|---|---|---:|---:|---:|---:|
| 2021 | 대한지방행정공제회 | `POBA-2021-GLOBAL-PRIVATE-INFRA-SMA` · 글로벌 사모인프라 SMA | `OFFICIAL_SELECTED_NO_AMOUNT` | — | — | — | — |

### 해석

- 대한지방행정공제회 글로벌 사모인프라 SMA 공식 선정사다.
- 공개된 선정금액이 없고 해외 manager이므로 국내 운용사 합계와 분리한다.

### 근거

- 공식: [글로벌 사모인프라 SMA 위탁운용사 선정공고](https://www.poba.or.kr/bbs/selectNttDetail?sechBbsSeq=10&sechBbstSeq=74913) · 대한지방행정공제회 · 2021-05-10
- 공식: [글로벌 사모인프라 SMA 위탁운용사 선정결과](https://www.poba.or.kr/bbs/selectNttDetail?sechBbsSeq=10&sechBbstSeq=75327) · 대한지방행정공제회 · 2021-07-07

## 공통 Dry Powder 결론

```text
현재 DB: selection은 있으나 commitment·paid-in·vehicle·deployment·realized가 없음
따라서: company dry powder = NULL / INSUFFICIENT_EVIDENCE
금지: 배정액 - 0 = dry powder
```

향후 공식 commitment, capital call, vehicle, deal deployment가 연결되면 같은 챕터에 자동으로 추가할 수 있다.
