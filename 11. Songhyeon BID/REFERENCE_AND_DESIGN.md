# 송현BID 포트폴리오 펀드 대시보드 레퍼런스 조사 및 적용 설계

- 조사 기준일: 2026-08-29
- 적용 대상: 동일 투자자가 출자한 하나의 포트폴리오 펀드가 송현 권역의 복수 자산을 보유한다는 가정
- 구현 파일: `송현BID_포트폴리오펀드_운용대시보드_프로토타입.html`
- 주의: 프로토타입의 모든 수치는 의사결정 구조 검증용 **DEMO DATA**이며 실제 자산성과가 아니다.

---

## 1. 결론

좋은 대시보드는 “확보한 필드”를 카드로 나열하지 않는다. 사용자의 질문을 다음 순서로 구조화한다.

1. **현재 무엇을 결정해야 하는가**
2. **펀드 전체 성과가 기준 대비 어떤가**
3. **무엇이 변화의 원인인가**
4. **어느 자산·임차인·계약이 기여하거나 훼손했는가**
5. **권리·데이터·비용 귀속이 확보됐는가**
6. **누가 언제 무엇을 해야 하는가**
7. **수치가 어느 원천에서 왔으며 신뢰 가능한가**

조사 대상 제품·공식 운영사례에서 반복 관찰된 구조는 다음 네 단계다.

> **Portfolio pulse → Exposure·Attribution → Lifecycle·Action → Asset evidence**

BID·상권 우수 사례의 공통 구조는 다음과 같다.

> **유입 → 체류·회유 → 자산 진입 → 결제·기업주문 → 재방문 → NOI·NAV → 권리·복제**

따라서 송현BID 대시보드는 방문객 수를 최상단 성과로 두지 않고, **권역 활동이 동일 펀드의 순증 NOI·NAV와 반복 가능한 운영권으로 전환됐는지**를 최상위 질문으로 삼아야 한다.

---

## 2. 레퍼런스 선정 기준

### A. 채택 신호가 강한 상용 제품

다음 중 하나 이상을 공식적으로 확인할 수 있는 제품을 우선했다.

- 공식 고객·GP·투자자 수
- 공식 데이터 커버리지 또는 거래누계
- G2·Capterra의 검증 리뷰 수
- 기관 고객사례 또는 산업교육 채택

서로 다른 개념인 AUM, 거래누계, 데이터 커버리지, 사용자 수는 합산하거나 직접 순위화하지 않았다.

### B. 공식 운영주체가 제공하는 공공·BID 화면

공개 사용자 수가 없어도 실제 운영기관이 제공하고, KPI 정의·갱신주기·보고서가 확인되는 경우 포함했다.

### C. 표현만 참고하는 사례

마케팅 화면만 확인되거나 사용자 수·실제 효과가 공개되지 않은 경우 채택 우수성을 단정하지 않고 표현 참고로만 사용했다.

---

## 3. 글로벌 부동산 운용 대시보드

| 제품 | 공급자 공시·독립 리뷰 신호 | 주 사용 질문 | 핵심 표현 문법 | 송현 적용 |
|---|---|---|---|---|
| **Juniper Square** | 공식 **2,300+ GPs**. Capterra 61개 verified reviews, G2 검색 노출 106 reviews | 펀드 결산·자본계정·LP 보고가 정상인가 | fund→asset→investor 계층, 상태·예외·문서 중심 LP 포털 | 내부 복잡성을 감춘 역할별 화면, 근거문서 드릴다운 |
| **Dealpath** | 공식 **$10T+ transactions supported**. Capterra 22개 verified reviews | 어떤 딜·과제를 전진·중단할 것인가 | pipeline, IC memo, 단계·담당자·기한, `채택/기각` 액션 | Executive IC의 Gate, 다음 30일 액션, 조건부 연장·중단 상태 |
| **VTS** | 공식 **13B+ sf live deal data**, 81.9K assets, 544K tenant entities, 300M+ real-time data points. Capterra 85개 verified reviews | 공실·만기·시장수요 위험이 어디에 있는가 | portfolio→asset→floor→lease, stacking plan, leasing funnel, live demand | 자산→거래·교차방문 흐름, 향후 lease roll·공실 드릴다운 |
| **Yardi Voyager / Investment Suite** | Voyager Capterra **256개 verified reviews** | NOI·예산·부채·회계·critical date가 기준을 벗어났는가 | 역할별 KPI, Actual/BP/Forecast, 회계 원장 drill-down | 펀드 NOI Bridge, 비용 귀속표, 데이터 원천 연결 |
| **MRI Software** | 공식 **45,000+ clients**, 23m units, 5.5m leases, 170+ countries. Capterra 108개, G2 검색 노출 186 reviews | 가치·현금흐름·개발수익이 가정에 얼마나 민감한가 | forecast, transactional simulation, scenario·sensitivity | Base/PoC/Scale 시나리오 선택과 향후 Scenario Lab |
| **ARGUS Enterprise** | 공식 **200+ universities** 교육 채택. Capterra 7개 verified reviews | 임대현금흐름·가치평가 가정이 무엇인가 | cash-flow table, rent roll, DCF, assumption grid | NOI/NAV 변화의 가정·계산근거 추적. 공개 리뷰 표본은 작으므로 평가 과대해석 금지 |
| **eFront / Aladdin Alternatives** | New Mexico SIC 등 공식 기관 사례. 제품별 고객 수는 비공개 | 공·사모 포트폴리오의 성과·위험·데이터 품질은 어떠한가 | allocation→position, benchmark, exception workflow | 펀드→자산 일관 정의와 데이터 검증 예외 |
| **MSCI Real Assets** | 공식 170+ countries, **$50T+ transactions**, **$2T+ private real estate assets covered**, 80+ indexes | 시장·peer 대비 수익·위험이 어떠한가 | benchmark, quartile, attribution, 지도·시계열 | 포트폴리오 네트워크 효과와 자산별 기여 attribution |
| **Fundrise** | 공식 $7B+ portfolio value, $2.87B equity managed, 385K+ individual investors | 내 계정가치·수익·배당·자산 업데이트는 무엇인가 | 큰 숫자, 단순 allocation, 모바일 timeline, 설명 카드 | 모바일에서 최상위 판단·핵심수치만 우선 표시 |

표의 `공식` 수치는 제품 공급자 자체 공시이며 독립검증 수치가 아니다. Capterra·G2의 숫자는 독립 리뷰 플랫폼에 노출된 리뷰 수이고 제품 품질 점수와 동일하지 않다. 모든 수치는 2026-08-25 접근 기준이다.

### 채택 신호 해석

- **Yardi·MRI·VTS**는 검증 리뷰와 운영 범위가 커 일상적인 운영 UI 패턴을 배우기에 적합하다.
- **Juniper Square**는 GP 채택과 리뷰 양쪽 신호가 균형적이다.
- **Dealpath·ARGUS**는 기관 전문사용자 제품이므로 공개 리뷰 수보다 거래지원·교육채택·기관사례를 함께 봐야 한다.
- **MSCI·eFront** 수치는 운용 AUM이 아니라 데이터 커버리지 또는 기관사용 근거다.
- 별점 원문이 자동접속 차단된 경우 임의로 인용하지 않았다.

---

## 4. 국내 부동산·상권·도시 데이터 레퍼런스

국내 서비스는 검증 가능한 공개 사용자 수가 부족하므로 사용자 수 기준 순위를 만들지 않았다. 대신 공식 운영주체·지표정의·공개화면·실제 의사결정 적합성을 검토했다.

| 서비스 | 답하는 질문 | 전달 정보 | 표현·상호작용 | 송현 적용 |
|---|---|---|---|---|
| **서울시 상권분석서비스** | 어떤 상권·업종이 성장·쇠퇴하는가 | 점포·개폐업·생존율·영업기간·추정매출·유동/주거/직장인구 | 상권 랭킹→지도→분석리포트, 업종·분기·상권유형 필터, 사용자 상권 | 지도보다 먼저 랭킹과 예외, 추정치의 산식·한계 표시 |
| **서울 생활이동** | 어디에서 언제 어떤 목적으로 유입되는가 | OD 이동량·시간·성별·연령·이동유형. 공식 안내상 매일 생산하며 약 1개월 전 자료를 요일·월 단위 제공 | 출발/도착 선택, OD flow, 시간대·목적 필터 | Portfolio Network의 외부수요→통제자산 방향성과 세그먼트 |
| **서울 실시간 도시데이터** | 지금 어느 장소가 혼잡하고 위험한가 | 서울 주요 121개 장소의 인구혼잡·교통·날씨·문화행사. 공식 안내상 인구·대중교통 5분, 상권 10분 갱신 | 장소 랭킹, 상태색, 실시간/예측 시계열 | 정상·관찰·조치·심각·지연의 제한적 상태 체계 |
| **한국관광 데이터랩** | 어느 지역·시기에 어떤 관광수요가 움직이는가 | 방문·이동·소비·관광 세그먼트 | 지역·기간 비교, 지도, 시계열, 지표 정의·주의 | 외부수요 모수로만 사용. 송현 고객·결제로 자동 환산 금지 |
| **R-ONE** | 시장 지표가 시간·지역별로 어떻게 변하는가 | 가격·임대·거래·공실 등 공식 부동산 통계 | 지역·기간 필터, 시계열, 표·다운로드 | 시장 benchmark와 기준일·단위·공식 출처 표기 |
| **K-apt** | 자산의 관리비·공사·운영 이상이 있는가 | 관리비·회계·유지관리·입찰 | 단지검색→비교→세부표 | 공통 운영비와 자산별 직접비 비교, 이상치 드릴다운 |
| **리츠정보시스템** | 차량·리츠·자산·공시의 법적 상태는 무엇인가 | 인가·자산·운용사·공시 | 검색·목록·공시 상세 | 펀드·SPV·계약·공시의 canonical master와 원문 연결 |
| **오픈업·KT 잘나가게 등 민간 상권 서비스** | 매출·업종·고객 변화에 어떤 조치가 필요한가 | 추정매출·상권·고객·알림 | 지도, 업종비교, action-oriented alert | 숫자 다운로드보다 다음 행동. 단, 모델 추정값은 공식 실적과 분리 |

### 국내형 표현에서 배울 점

1. **지도는 탐색의 출발점이지 결론이 아니다.** 지도 선택 후 랭킹·시계열·상세보고로 이어져야 한다.
2. **추정치는 산식·기준일·모집단·한계를 붙인다.**
3. **상태를 다섯 단계 이내로 제한한다.** 정상·관찰·조치필요·심각·지연/미수집.
4. **공공 외부데이터를 펀드 성과로 자동 합산하지 않는다.** 외부수요와 내부전환을 분리한다.
5. **다음 행동을 수치보다 앞에 둔다.** 담당자·기한·근거가 없는 알림은 만들지 않는다.

---

## 5. 글로벌 BID·권역운영 레퍼런스

| 사례 | 확인된 운영·채택 신호 | 전달 정보와 표현 | 배운 점 |
|---|---|---|---|
| **South Bank BID** | 공식 분기보고서·publications 운영. 2026 Q2 보고서는 BT GeoMND footfall과 Mastercard 지출지수를 사용 | footfall YoY, 요일·시간대, 국내/국제/근로자, 체류시간, 지출·거래를 함께 해석. 데이터 장애·비교제외 기간과 지출지수가 실제 파운드 금액이 아님을 명시 | 방문객이 줄어도 체류·지출이 늘 수 있다. 수량과 방문품질 분리 |
| **New West End Company** | 공식 자료상 **800+ members**, 향후 5년 안전·운영 인프라 £23m 투자 계획 | visitor insights, impact result, 보안·환경·캠페인 결과 | 회원에게 공개하는 운영성과와 권역투자·안전지표 연결 |
| **DowntownDC BID Data Dashboard** | 공식 BID가 공개 데이터 대시보드와 State of Downtown 발간 | foot traffic, office attendance, housing, retail·hospitality, investment를 섹션별 비교 | footfall을 오피스복귀·관광·주거·투자 맥락과 함께 설명 |
| **Times Square Alliance** | 공식 Market Research & Data 운영 | 보행량·방문·경제·브랜드·안전 관련 자료와 시계열 | 장소브랜드 지표를 경제·안전 자료와 분리하되 같은 narrative에서 제공 |
| **Bryant Park** | 공식 페이지상 **12m+ annual visitors** 및 파트너 프로그램 | 프로그램·방문자·후원기회를 연결 | 후원영업에는 유용하나 총 방문객만으로 자산효과를 증명하면 안 됨 |
| **Placer.ai** | 공식 고객사례·분석제품. 공개 접근 페이지에서 고객 수는 확인하지 않아 미기재 | trade area, 시간대·요일, 재방문, cohort, 경쟁지 교차방문, before/after | 방문량→운영시간·입지·캠페인 의사결정으로 번역 |
| **Replica** | 공식 공공기관 impact stories와 data validation 공개 | OD·목적·시간·지역별 이동, scenario와 영향 비교 | 공공 외부수요의 네트워크 표현과 검증문서 병기 |

### BID 대시보드가 답해야 할 질문

1. 누가 어디서 언제 왔는가
2. 통제자산에 실제로 들어왔는가
3. 체류·교차방문·결제가 발생했는가
4. 다시 방문하거나 기업이 재주문했는가
5. 어느 자산의 NOI·공실·임대차에 반영됐는가
6. 운영비 차감 후 펀드 순효과가 양수인가
7. 운영·데이터·수익·확장권이 펀드 또는 운용사에 남는가

---

## 6. 차트 선택 원칙

| 판단 질문 | 적합한 표현 | 적용 위치 |
|---|---|---|
| 지금 무엇을 결정해야 하는가 | decision banner + Gate + action queue | Executive IC 상단 |
| 무엇이 NOI를 만들거나 훼손했는가 | waterfall / contribution bridge | Portfolio NOI Bridge |
| 개별 자산 합계보다 추가효과가 있는가 | asset contribution matrix + network lift | Fund Economics |
| 누가 수요를 보내고 누가 전환하는가 | 방향성 network / OD flow | Portfolio Network |
| 어느 단계에서 수요가 빠지는가 | funnel + segment breakdown | Demand Conversion |
| 어떤 계약권리가 비어 있는가 | rights scorecard + exception list | Rights & Risk |
| 일정·만기가 언제 몰리는가 | timeline / maturity ladder / heatmap | 향후 lease·debt 화면 |
| 가정 변화에 가치가 민감한가 | scenario matrix / tornado / fan chart | 향후 Scenario Lab |
| 수치가 믿을 만한가 | source·freshness·definition panel | Evidence |

### 피해야 할 차트

- 범주가 많은 donut
- 드릴다운 없는 총합 KPI
- 지도 위에 모든 지표를 중첩
- 서로 다른 분모의 footfall·매출·NOI를 같은 축에 표시
- 기준선 없는 빨강·초록
- 인과 증거가 없는 before/after 단독 비교
- 데이터가 없는 직원·시가총액·자산가치의 가짜 시각화

---

## 7. 프로토타입 구현상태와 적용 표현

| 영역 | 현재 상태 | 비고 |
|---|---|---|
| Executive·Gate·action queue | 구현됨 | 모든 판단은 SIMULATED·DEMO 표시, owner·due·evidence·완료조건 포함 |
| Canonical NOI 대사 | 구현됨 | 기준 NOI 118.4억원, 순증 7.6%=9.0억원, 결과 127.4억원 |
| 고정 PoC 관점 | 구현됨 | 기간·시나리오 거짓 필터 제거. Scenario Lab은 설계만 유지 |
| Network·Conversion | 구현됨 | DEMO index, 모바일 스크롤 힌트·세로 funnel |
| 자산·공통비 귀속 | 부분 구현 | DEMO matrix. 실제 payer/beneficiary SPV·true-up은 데이터 연결 필요 |
| 권리 조문 관리 | 부분 구현 | 점수 제거, DEMO 조문 충족/공백 표시. 실제 계약 registry 미연결 |
| KPI lineage | 부분 구현 | KPI ID·산식·source field·owner·상태 계약 구현. 실제 레코드 링크 미연결 |
| Actual/BP/Forecast·NAV·debt·CAPEX·LP cash flow | 설계 | 원천 연결 전 산출하지 않음 |

### 7.1 Executive IC

**학습 출처:** Dealpath, Yardi, Juniper Square

- 최상단에 `조건부 연장`이라는 현재 결정 배치
- 이유를 “수요 전환 확인 / NOI 인과 부족 / 운영권 기간 부족”으로 요약
- 30일 액션 큐와 검증 Gate 병치
- KPI를 `현재값 + 기준 + 원천 + 상태`로 구성

### 7.2 Portfolio NOI Bridge

**학습 출처:** Yardi, MRI, ARGUS, MSCI

- 방문객이 아니라 권역운영비 차감 후 펀드 순증 NOI를 최상위 경제지표로 사용
- 수요전환·기업주문·임차인 유지·공동운영·운영비로 원인 분해
- 고정 PoC DEMO만 표시하고, 데이터가 없는 기간·시나리오 선택기는 제거
- 실제 Scenario Lab은 Actual/BP/Forecast·NAV·부채·CAPEX 원천 연결 후 구현

### 7.3 Portfolio Network

**학습 출처:** 서울 생활이동, Placer.ai, Replica, VTS

- 공공·업무수요와 통제자산을 다른 색으로 구분
- 선 굵기와 화살표로 방향·강도 표현
- 교차방문·결제 라벨 표시
- 자산 클릭 시 하단 drawer에서 직접 NOI·네트워크효과·공통비·다음 판단 확인

### 7.4 Demand Conversion

**학습 출처:** South Bank BID, DowntownDC, Placer.ai

- 잠재수요→주소가능수요→진입→결제→반복으로 funnel 구성
- 관광·업무·주민을 시간·목적별로 분리
- 최대 이탈구간과 다음 조치를 별도 경보로 제시
- 모바일에서는 가로스크롤이 아니라 세로 funnel 사용

### 7.5 Fund Economics

**학습 출처:** MSCI attribution, Yardi, ARGUS

- 직접 NOI, 네트워크효과, 공통비, 펀드 순기여를 자산별로 분리
- 동일 펀드여도 자산별 장부와 비용회수율 유지
- 기본 운용보수와 AreaCo 보수의 중복 위험 표시

### 7.6 Rights & Risk

**학습 출처:** Dealpath exception workflow, Juniper Square compliance exception

- 운영권·데이터권·수익권·확장권을 조문별 충족/공백으로 관리
- 임의 100점 점수를 사용하지 않고 DEMO 문서·조문·협상 공백 표시
- SPV 대출약정·관찰기간·벤더 대체조항을 실행 위험으로 노출

### 7.7 Evidence & Lineage

**학습 출처:** 서울 상권분석, 관광 데이터랩, Yardi·ARGUS

- 공식 재무·계약, 외부 관측, 내부 계산, 모델 추정, 결측을 구분
- 원천군 카드와 함께 KPI ID·정의·단위·산식 버전·source system/table.field·기준일·owner·품질상태를 lineage 표로 표시
- 실제 source record ID·문서 ID·적재시각·산식 commit은 미연결로 명시
- 모든 demo 수치는 실제 판단에 사용하지 않는다고 고정 표시

---

## 8. 의도적으로 적용하지 않은 표현

| 제외 항목 | 이유 |
|---|---|
| 실제 지도와 자산 위치 | 포트폴리오 편입 자산과 공공권한이 확인되지 않음 |
| 실제 NOI·NAV·방문·결제 수치 | 원천 데이터가 제공되지 않음. 현재는 전면 DEMO 표시 |
| 임대 stacking plan | 층·호실·lease roll 데이터 미연결 |
| LTV·DSCR·대출만기 | 펀드·SPV 대출약정 데이터 미연결 |
| peer benchmark | 비교 가능한 권역형 포트폴리오 정의가 아직 없음 |
| 확정 인과효과 | before/after와 대조자산·통제변수 설계 전 |
| 고객 수가 검증되지 않은 국내 민간서비스의 우수성 순위 | 근거 없는 인기·평가 주장 방지 |
| 타사 UI 복제 | 정보설계와 상호작용 원리만 선별 적용 |

---

## 9. 실제 데이터 연결 우선순위

### 1단계 — 의사결정에 즉시 필요한 최소 데이터

- 펀드·SPV·자산 canonical master
- 월별 NOI·매출·운영비·CAPEX
- 공실·임대료·주요 임대차 이벤트
- 프로그램·예약·기업주문·POS/PG 정산
- 운영·데이터·수익·확장권 계약 원문

### 2단계 — 네트워크 효과

- 익명 공통 ID 또는 허용된 교차방문 linkage
- 자산별 유입·송출·체류·결제
- 관광·업무·주민 cohort와 30/90일 재방문
- 비노출 비교자산 또는 대조기간

### 3단계 — 펀드·플랫폼 가치

- valuation·NAV bridge
- 리파이낸싱·대출약정·covenant
- 임대 stacking·만기 ladder
- 후속 자산 편입·권역형 펀드 파이프라인
- SBD·용산 재사용 비용과 권리

---

## 10. 출처 목록과 증거 성격

- 접근일: 2026-08-25
- 제품 고객·거래·커버리지 수치: **공급자 자체 공시**
- Capterra·G2 리뷰 수: **독립 리뷰 플랫폼 노출 수**. 별점이나 품질점수로 대체하지 않음
- BID 수치: **공식 운영주체의 운영규모**. 대시보드 사용자 수나 인과효과가 아님

### 글로벌 부동산 운용 제품

- Juniper Square: https://www.junipersquare.com/
- Dealpath: https://www.dealpath.com/ · https://www.dealpath.com/platform/
- VTS: https://www.vts.com/
- Yardi Investment Management: https://www.yardi.com/solutions/investment-management/
- MRI Investment Management: https://www.mrisoftware.com/ · https://www.mrisoftware.com/products/investment-management/
- ARGUS: https://www.altusgroup.com/argus/
- Aladdin Alternatives: https://www.blackrock.com/aladdin/products/aladdin-alternatives
- MSCI Real Assets: https://www.msci.com/our-solutions/real-assets
- Fundrise: https://fundrise.com/ · https://fundrise.com/about · https://fundrise.com/client-returns

### 검증 리뷰

- Juniper Square: https://www.capterra.com/p/171269/Juniper-Square/reviews/ · https://www.g2.com/products/juniper-square/reviews
- Dealpath: https://www.capterra.com/p/164485/Dealpath/reviews/
- VTS: https://www.capterra.com/p/154799/VTS/reviews/
- Yardi Voyager: https://www.capterra.com/p/33832/Yardi-Voyager/reviews/
- MRI: https://www.capterra.com/p/79570/MRI-Software/reviews/ · https://www.g2.com/products/mri-property-management/reviews
- ARGUS Enterprise: https://www.capterra.com/p/276457/ARGUS-Enterprise/reviews/

### 국내 공공·상권

- 서울시 상권분석서비스: https://golmok.seoul.go.kr/
- 서울 생활이동: https://data.seoul.go.kr/dataVisual/seoul/seoulLivingMigration.do
- 서울 실시간 도시데이터: https://data.seoul.go.kr/SeoulRtd/
- 한국관광 데이터랩: https://datalab.visitkorea.or.kr/
- R-ONE: https://www.reb.or.kr/r-one/
- K-apt: https://www.k-apt.go.kr/
- 리츠정보시스템: https://reits.molit.go.kr/
- 오픈업: https://www.openub.com/

### BID·권역운영

- South Bank BID publications: https://southbankbid.co.uk/publications
- South Bank BID 2026 Q2 report: https://southbankbid.co.uk/assets/publications/quarterly-report-apr-jun-26.pdf
- New West End insights·impact: https://newwestend.com/insights-performance/ · https://newwestend.com/impact-results/
- DowntownDC Data Dashboard: https://www.downtowndc.org/data-dashboard/
- Times Square Market Research & Data: https://www.timessquarenyc.org/business-community/market-research-data
- Bryant Park brand partnerships: https://bryantpark.org/about-us/brand-partnerships
- Placer.ai foot traffic analytics: https://www.placer.ai/foot-traffic-analytics
- Replica: https://www.replicahq.com/data-validations · https://www.replicahq.com/impact-stories

---

## 11. 조사 한계

- 공개 마케팅 화면만으로 실제 권한체계·API·감사로그·응답성까지 평가할 수 없다.
- G2·Capterra가 자동접속을 차단한 경우 검색 결과에 노출된 verified review 수만 사용했고 별점을 추정하지 않았다.
- 제품사 공식 고객·데이터 수치는 자체 공시이며 독립감사 수치로 간주하지 않았다.
- BID의 방문객·회원·투자액은 운영 규모 신호이지 대시보드 사용자 수 또는 인과적 성과가 아니다.
- 실제 송현 자산과 법적 권리는 별도 원문 검증이 필요하다.
- 프로토타입은 정보구조와 상호작용 검증용이며 투자판단 자료가 아니다.
