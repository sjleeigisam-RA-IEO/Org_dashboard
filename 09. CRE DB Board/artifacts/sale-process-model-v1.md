# 경쟁입찰형 실물자산 매각 프로세스 모델 V1

## 목적

실거래 신고의 최종 가격만 저장하지 않고, 한 자산의 매각 검토부터 자문사 선정, 예비·본입찰, 숏리스트, 우선협상, 계약, 거래종결 또는 무산·재매각까지 append-only로 추적한다.

## 권위 흐름

```text
Source document version
  → title/snippet candidate (REVIEW_READY)
  → evidence span / mention
  → n-ary source claim
  → asset·party·sale-process resolution
  → canonical sale process
  → round / participation / submission / funding / decision / milestone
  → selected current fact and analytical view
```

제목·snippet 규칙 결과는 canonical event가 아니다. 가격·순위·자금출처·우협·종결은 evidence review를 통과하기 전 확정값으로 사용하지 않는다.

## Canonical 객체

```text
Asset / portfolio
  1:N Sale process (재매각·재입찰 별도 process)
       1:N Process role
       1:N Bid round
             1:N Bidder participation
                   1:N Consortium/member/vehicle
                   1:N Bid submission
                         1:N Funding component
             1:N Bid decision
       1:N Transaction milestone
```

## V2.3 테이블

| 테이블 | 역할 |
|---|---|
| `sale_processes` | canonical SALE event의 경쟁매각 확장, 매각방식·현재 상태 |
| `sale_process_roles` | 매도자·매각자문·법률자문·인수금융주선 등 유효기간별 역할 |
| `bid_rounds` | 관심표명·예비·본입찰·BAFO·재입찰 라운드 |
| `bidder_participations` | 라운드별 관심·제출·숏리스트·철회·우협·차순위 상태 |
| `bidder_participation_members` | 대표 입찰자·운용사·펀드·리츠·SPC·공동투자자 분리 |
| `bid_submissions` | 가격·comparator·단위·가격기준·순위·가격 외 조건 |
| `bid_funding_components` | 자기자본·블라인드/프로젝트펀드·LP·공동투자·인수금융·메자닌 |
| `bid_decisions` | 숏리스트·우협·차순위 결정과 supersession/revocation |
| `transaction_milestones` | MOU·실사·SPA·계약금·금융약정·선행조건·잔금·소유권·종결·무산 |

## 상태 구분

### 참여 상태

```text
INTEREST_REPORTED
IM_RECEIVED
PRELIMINARY_BID_SUBMITTED
FINAL_BID_SUBMITTED
SHORTLISTED / NOT_SHORTLISTED
WITHDREW
PREFERRED / RESERVE_BIDDER / LOST
```

“인수 검토”는 `INTEREST_REPORTED`이며 실제 입찰서 제출로 승격하지 않는다.

### 매각 진행 상태

```text
DISCOVERY → MANDATE → MARKETING → BIDDING → SHORTLIST
→ PREFERRED_NEGOTIATION → CONTRACTED → CONDITIONS_PENDING → CLOSED
                                      ↘ FAILED / WITHDRAWN / REBID
```

- 숏리스트는 우협이 아니다.
- 우협은 SPA가 아니다.
- SPA는 거래종결이 아니다.
- 잔금 납입·소유권 이전·공식 공시 등 별도 증거가 있어야 `CLOSED`를 승인한다.
- 최초 우협 결렬 후 차순위 전환은 기존 결정을 삭제하지 않고 `supersedes_decision_id`로 연결한다.

## 입찰가격

`bid_submissions`는 다음을 함께 보존한다.

```text
bid_amount_decimal / lower / upper
currency_code
comparator: EXACT / ABOUT / AT_LEAST / AT_MOST / RANGE / UNKNOWN
amount_precision
price_basis: 총매매가 / 지분가치 / 기업가치 / 평당가 / ㎡당가 / 미상
VAT 포함 여부
승계부채 포함 여부
financing / due-diligence / closing condition
reported_rank + rank_scope + rank_as_of
```

“최고가”, “2위”는 해당 입찰 라운드와 보도 시점에만 귀속한다. 최고가 입찰자가 비가격 조건 때문에 우협이 되지 않는 시나리오를 허용한다.

## 자금조달 분리

```text
bidder / asset manager
managed fund or REIT
acquisition vehicle / SPC
equity provider / LP
co-investor
debt provider / lender syndicate
debt arranger
```

예: “코람코자산운용이 입찰”과 “코람코가 운용하는 블라인드펀드가 equity를 제공”과 “SPC가 매수”와 “은행 대주단이 인수금융 제공”은 네 개의 별도 사실이다.

자금 상태는 `RUMORED / PLANNED / INDICATIVE / COMMITTED / EXECUTED / WITHDRAWN`으로 분리한다. 공개되지 않은 자금원은 추정하지 않는다.

## 증거와 검수

모든 V2.3 객체는 다음을 가진다.

```text
evidence_status: UNSOURCED / SOURCE_CLAIM / MANUAL_VERIFIED
source_claim_id
review_status
confidence
metadata_json
```

- `SOURCE_CLAIM`이면 `source_claim_id`가 필수다.
- 제목·snippet 후보는 `review_tasks`의 `SALE_PROCESS_EVIDENCE_REVIEW`로만 생성한다.
- 가격·순위·우협·종결·자금원은 원문 또는 강한 공식 증거를 확인한 뒤 claim과 canonical 객체로 승격한다.
- 기사 간 상충은 덮어쓰지 않고 각 claim을 보존한다.

## 조회 view

- `v_bid_competition`: 라운드·입찰자·제출가격·순위·현재 우협 여부
- `v_bid_funding`: 제출별 펀드·LP·SPC·대주·금액·commitment 상태
- `v_sale_process_current`: 현재 우협과 최신 milestone

## 지역 coverage

`config/asset-use-geography-policies.json` V1:

- 오피스: 서울·인천·경기
- 호텔: 전국, 수도권·부울경·호남·강원/제주 우선
- 물류: 전국, 수도권·부울경·호남·충청 우선
- 데이터센터: 전국, 수도권·부울경·호남 우선

물류는 IC·항만·산업단지, 데이터센터는 전력·통신·인허가 cluster를 행정구역과 함께 관리한다.
