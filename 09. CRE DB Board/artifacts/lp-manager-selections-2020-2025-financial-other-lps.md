# 보험·금융·기타 LP 위탁운용사 선정 조사 (2020~2025)

## 결론

- 공식 공고/첨부 원문이 확인된 **건설근로자공제회 CRE mandate 8건**을 구조화했다.
- 선정 운용사와 귀속액까지 full-text 결과 기사로 연결된 것은 **2건**이다.
  - 2022 국내 부동산 대출형: 캡스톤자산운용 800억원, 코람코자산운용 700억원.
  - 2024 국내 부동산 선순위 대출형: 삼성SRA·캡스톤·메테우스·하나대체투자자산운용 각 500억원.
- 다만 위 두 결과는 공식 LP 결과 공고가 아니라 언론 원문이므로 **APPROVED 승격 불가**다. 검수 입력용 `REVIEW_READY` 후보만 만들었고 공식 결과 확보를 blocker로 남겼다.
- 새마을금고중앙회 2024·2025 공고는 기업 메자닌/PE/VC이며, 2025 Special Situation은 “실물자산(부동산,인프라자산 등) … 제외”를 명시하므로 CRE 범위에서 제외했다.
- live DB와 importer/schema는 수정하거나 실행하지 않았다.

## 범위와 판정 규칙

포함 대상은 실제 부동산, 인프라, 부동산 대출, 리츠에 대한 공개 위탁 mandate다. 일반 PE/VC, 기업 메자닌, 펀드 판매, 상품 공모는 제외했다. 금액은 V2.5 의미론에 따라 다음처럼 분리했다.

- `TRACK_LP_COMMITMENT`: 전략 track 전체 예정 약정액
- `ALLOCATION_PER_MANAGER`: 운용사당 예정 배정 상한
- `SELECTION_LP_COMMITMENT`: 특정 선정 운용사에 귀속된 결과 금액
- `TARGET_FUND_SIZE`: LP 출자액이 아닌 목표 펀드 결성규모

검색 기사 제목·스니펫만으로는 결과를 구조화하지 않았다. 공고 조건은 공식 HWP exact text, 선정 결과는 접근 가능한 full article text를 보존했다.

## 포함 mandate

| 연도 | LP / track | 공식 공고 금액 basis | 요구수익률·전략 | 선정 결과 | 결과 근거 / 상태 |
|---|---|---|---|---|---|
| 2021 | 건설근로자공제회 / 국내 부동산 기회추구형 | `TRACK_LP_COMMITMENT` 300억원 이내, 1개사 | 지분형 기회추구, 일부 대출 가능; 국내; 7년/투자 3년 | 미확인 | 공식 공고만 확인 |
| 2021 | 건설근로자공제회 / 해외 인프라 | `TRACK_LP_COMMITMENT` 300억원 이내, 1개사 | 글로벌 인프라 Equity, 코어·코어플러스·가치부가 | 미연결 | transcript의 Ardian/세컨더리 결과는 공식 공고 전략과 불일치 |
| 2022 | 건설근로자공제회 / 부동산 리츠 | `ALLOCATION_PER_MANAGER` 각 400억원 이내, 2개사 | 목표 배당수익률 4% 이상; 해외자산 ≤30% | 미확인 | 공식 공고만 확인 |
| 2022 | 건설근로자공제회 / 국내 부동산 대출형 | 공고 `ALLOCATION_PER_MANAGER` 각 1,000억원 이내 | 선순위 대출, LTV≤65% 구간 비중 ≥70%, 보수 차감 후 6.0% 이상 | 캡스톤 800억원, 코람코 700억원 | 이데일리 full text; 공식 결과 필요 |
| 2024 | 건설근로자공제회 / 국내 부동산 선순위 대출 | `TRACK_LP_COMMITMENT` 총 2,000억원 이내; `ALLOCATION_PER_MANAGER` 500억원 이내 | 실물담보·PF 선순위, LTV≤65% 구간 비중 ≥70%, 보수 차감 후 6.0% 이상 | 삼성SRA·캡스톤·메테우스·하나대체 각 500억원 | 파이낸셜뉴스 full text; 공식 결과 필요 |
| 2024 | 건설근로자공제회 / 글로벌 인프라 | 지분형 USD 22m, 대출형 USD 22m (`TRACK_LP_COMMITMENT`) | Equity 코어~밸류에드 / 선순위 Debt Unlevered | 미확인 | 공식 공고만 확인 |
| 2025 | 건설근로자공제회 / 미국 레지덴셜 대출 | `TRACK_LP_COMMITMENT` USD 21m, 1개사 | 미국 100%, 멀티패밀리 ≥50%, 목표펀드 USD 500m 이상 | 미확인 | 공식 공고만 확인 |
| 2025 | 건설근로자공제회 / 국내 부동산 우선주 | `TRACK_LP_COMMITMENT` 총 1,000억원 이내; 운용사당 500억원 이내; `TARGET_FUND_SIZE` 최소 1,000억원 | 오피스 ≥60%, 기타 실물 ≤40%, 개발 금지, Net IRR 8% / CoC 5% 이상 | 코람코·퍼시픽 보도 발견 | 검색 스니펫 단계라 결과 미구조화 |

## 결과 연결 상세

### 2022 국내 부동산 대출형

- 공식 공고: <https://www.cw.or.kr/board.do?boardConfigNo=29&menuNo=46&action=view&boardNo=25415>
- 공식 첨부: <https://www.cw.or.kr/upload/boardAdmin/2022/10/FA065CDD-F8C0-6154-3420-A03CBEC69453.hwp>
- 결과 기사: <https://www.edaily.co.kr/News/Read?newsId=03073366632562784>
- 공식 조건 exact text:
  - “국내부동산 선순위 중심 순수 대출형 투자(실물 담보 대출, PF 대출, 브릿지 대출 등)”
  - “LTV(Loan To Value) 65% 이하의 선순위로만 구성된 대출 투자 비중이 70% 이상”
  - “목표 수익률: 6.0% 이상 (보수 차감 후)”
- 결과 exact text: “출자규모는 각각 800억원과 700억원으로 총 1500억원이다.” 앞 문장의 운용사 순서(캡스톤, 코람코)에 따라 각각의 `SELECTION_LP_COMMITMENT`를 매핑했다.

### 2024 국내 부동산 선순위 대출

- 공식 공고: <https://www.cw.or.kr/board.do?boardConfigNo=29&menuNo=46&action=view&boardNo=27768>
- 공식 첨부: <https://www.cw.or.kr/upload/boardAdmin/2024/02/688D70C7-A11C-62FA-2409-AC240F606576.hwp>
- 결과 기사: <https://www.fnnews.com/news/202404290711016886>
- 공식 조건 exact text:
  - “위탁운용규모:총 2,000억원 이내 (운용사당 500억원 이내, 4개사 선정)”
  - “목표 수익률: 6.0% 이상 (보수 차감 후)”
- 결과 exact text: 네 운용사를 열거한 뒤 “각각 500억원을 출자, 총 2000억원 규모 투자다.”라고 명시한다. 각 선정사 귀속액은 `SELECTION_LP_COMMITMENT` 500억원으로 구조화했다.

## 제외

1. **새마을금고중앙회 2024 위탁펀드형 대체투자**  
   공식 공고: <https://www.kfcc.co.kr/mgNotice/mgNoticeDetail.do?no=396>  
   Credit Mezzanine 및 기업 Buyout/Growth 전략으로 CRE mandate가 아니다.

2. **새마을금고중앙회 2025 위탁펀드형 대체투자**  
   공식 공고: <https://www.kfcc.co.kr/mgNotice/mgNoticeDetail.do?no=436>  
   PE/VC이며, exact text “Special Situation 전략은 실물자산(부동산,인프라자산 등) & 해외투자 제외”에 따라 명시적 exclusion이다.

## 후보 manifest

- `fixtures/lp-mandate-candidates/financial-other-lps/cw-2022-domestic-re-debt.json`
- `fixtures/lp-mandate-candidates/financial-other-lps/cw-2024-domestic-senior-re-debt.json`

두 파일은 모두 `REVIEW_READY`이며 `APPROVED`가 아니다. 공식 선정결과와 reviewer/approver 서명 전에는 `fixtures/approved-lp-mandates/`로 이동하거나 importer에 투입해서는 안 된다.

## 미해결 gap

- 2020~2025 보험사·은행계열에서 공식 공고와 공식 결과가 동시에 공개된 사례는 이번 transcript 범위에서 확보하지 못했다.
- 건설근로자공제회 공식 공고는 최종 선정 결과를 “개별통보”한다고 명시한다. 별도 공식 결과 게시물 또는 경영공시·운용보고서 원문을 추가 확보해야 한다.
- 2025 국내 부동산 우선주 결과는 코람코·퍼시픽 선정 보도가 있으나 full text와 공식 결과가 없어 후보로 만들지 않았다.
