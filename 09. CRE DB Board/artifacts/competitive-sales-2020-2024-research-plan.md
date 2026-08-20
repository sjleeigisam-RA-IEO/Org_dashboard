# 2020–2024 경쟁매각 역사 백필 심층조사 계획 및 리드 워치리스트

> **중요한 한계 및 사용법**
>
> - 이 문서는 **조사계획**이다. 아래 자산명·연도·당사자 조합은 모두 `LEAD_UNVERIFIED`(미검증 리드)이며, 거래·입찰·가격·종결의 확인된 사실로 인용하면 안 된다.
> - 본 문서 작성 과정에서 웹 원문이나 등기·공시를 실시간 검증하지 않았다. 자산명은 2025 산출물의 인접연도 단서, 저장소 밖에서 알려진 시장명, 로컬 IM 파일명 등을 이용해 **검색 시작점**으로만 구성했다.
> - 각 리드는 원문을 읽은 뒤 `REJECTED / PROCESS_FOUND / MILESTONE_CONFIRMED / TERMINAL_CONFIRMED` 중 하나로 판정한다. `우협 ≠ SPA ≠ 종결`, `운영사·브랜드 선정 ≠ 부동산 매각`, `개발 MOU ≠ 자산 취득` 원칙을 적용한다.
> - **DB 쓰기 범위가 아니다.** 조사자는 원문 스냅샷·claim sheet·coverage ledger를 별도 staging artifact로 만들고, 승인 전 공유 DB에 쓰지 않는다.

## 1. 목적·범위·성공 기준

### 1.1 대상

- **OFFICE:** 서울·경기·인천(수도권)
- **HOTEL / LOGISTICS / DATA_CENTER:** 전국
- **기간:** 사건일 기준 2020-01-01~2024-12-31
- **문서 탐색:** 기본적으로 사건연도 전년 10월 1일~후년 3월 31일; 장기 지연·재매각은 2025~2026 후속 문서까지 연결
- **포함:** 공개 마케팅, 예비/본입찰, 숏리스트, 우협, MOU, SPA, 잔금·소유권 이전·share/beneficiary-interest deal 종결, 무응찰·철회·우협 해지·재입찰
- **별도 분류:** 운영자산 매매, 펀드 수익증권/리츠 지분 거래, 세일앤드리스백, 포트폴리오, 개발부지/개발권, 공매·경매
- **제외:** 호텔 위탁운영·브랜드 입찰, 단순 리파이낸싱, 회사 M&A만 있고 대상 부동산이 특정되지 않는 건, 데이터센터 개발 MOU/전기사용협약만 있는 건, 물류시설 이전 뒤 유휴부지 개발매각

### 1.2 완료 정의

한 해의 완료는 “모든 거래를 찾았다”가 아니라 다음이 충족된 상태다.

1. `연도 × 월/분기 × 자산군 × 권역 × 소스그룹`의 선언된 partition을 모두 시도하고 결과·실패사유를 남긴다.
2. P1 리드는 자산별 마일스톤 검색과 ±인접연도 후속검색을 완료한다.
3. terminal 상태는 1차 자료 1건 또는 독립 강출처 2건으로만 승격한다.
4. 가격은 `asking / appraisal / submitted bid / preferred-bidder / SPA / closing / asset value / beneficiary-interest consideration`을 구분한다.
5. “미발견”은 `NO_PUBLICLY_VERIFIABLE_LEAD_FOUND`로 기록하며 거래 부재로 해석하지 않는다.

## 2. 2025 캠페인에서 역산한 운영 교훈

이 계획은 다음 로컬 산출물을 설계 기준으로 삼는다.

- `artifacts/competitive-sales-2025-expanded-synthesis.md`: 입찰·숏리스트·우협·SPA·종결 분리, 복합패키지와 share deal 구분
- `artifacts/backfill-2025-coverage-report.md`: 월 partition, 검색 상한·비정상 0건 recovery, adjacent-year reconciliation 필요성
- `artifacts/backfill-2025-official-source-roadmap.md`: OpenDART 본문, 공식 API, 접근 제한 및 source ladder
- `artifacts/bid-process-2025-deep-dive.md`, `hotel-competitive-sales-2025-deep-dive.md`, `logistics-competitive-sales-2025-deep-dive.md`: 자산별 chronology와 follow-up 판정 방식

2020~2024는 Google News RSS의 현재 검색 결과만으로 재현하려 하지 않는다. 오래된 기사는 RSS 보존·랭킹 편향, URL 변경, 유료화, robots 제한의 영향을 더 크게 받으므로 **공식공시 → 당사자/리츠·운용사 문서 → 검색 가능한 언론 아카이브 → 검색 snippet** 순으로 조사한다.

## 3. 실행 순서와 연도별 우선순위

### 3.1 권장 순서

1. **2024 calibration:** 2025에 이어지는 크레센도·그래비티·글래드·곤지암·여주 등 경계 사례를 먼저 재구성한다.
2. **2023:** 로컬 IM 단서가 가장 풍부하므로 자산명·자문사 검색의 recall/precision을 보정한다.
3. **2022:** 금리상승기 전후 무산·철회·재가격·우협 해지 패턴을 집중한다.
4. **2021:** 호텔 구조조정·대형 오피스·물류 포트폴리오를 보강한다.
5. **2020:** 디지털 아카이브가 약한 코로나 초기 호텔 및 물류 거래를 source-led 방식으로 조사한다.

### 3.2 캠페인 단위

- OFFICE 수도권: `연도 × 월 × (CBD/GBD/YBD/분당판교/기타 경기인천) × source group`
- HOTEL 전국: `연도 × 분기 × 17개 시도`로 시작하되 서울·부산·제주·인천·경기는 월 단위
- LOGISTICS 전국: 수도권은 월 단위, 충청/부울경/호남/강원제주는 분기 단위 후 hit 발생 시 월/시군구 분할
- DATA_CENTER 전국: 자료가 희소하므로 연도 × 권역 × (운영자산/개발권/부지/회사M&A) bundle; 운영자산 매매 여부를 수동 분류
- 검색결과가 제공자 상한과 같거나 월별 0건이 비정상적이면 주/반월 또는 짧은 의미 bundle로 recovery

## 4. 시대별 source access 전략

| 소스 계층 | 2020–2021 | 2022–2023 | 2024 | 조사·보존 규칙 |
|---|---|---|---|---|
| OpenDART 목록·원문 | 상장 매도자/매수자·리츠 관련 공시를 먼저 스캔. 오래된 `document.xml`의 `status=014` 가능성을 coverage gap으로 기록 | 정정·철회·타법인출자·담보제공을 매각 본문과 연결 | 2025 collector와 같은 월 partition으로 calibration | 목록 metadata와 원문 layer를 분리; `rcept_no` 안정키; 비ZIP XML을 손상파일로 오판 금지 |
| DART 웹/KRX KIND | API 원문 미제공·첨부 스캔 보완 | 정정공시 chain, 리츠·상장사 주요사항 확인 | API 결과와 대조 | 보고서명 공백 유무를 모두 검색; 정확한 접수번호 URL 보존 |
| 리츠정보시스템·AMC/운용사 | 영업·투자보고서 PDF가 언론보다 terminal proof에 유리할 수 있음 | 자산 편입/처분, 차입, 수익증권·주주 변경 | 프로젝트리츠/리츠 share deal 확인 | 자산매매가와 수익증권대금을 분리; 보고서 기준일과 거래일 분리 |
| 당사자·자문사 보도자료 | 오래된 URL 이동/삭제 대비 Wayback은 위치 탐색용으로만 사용하고 원문 존재 여부 표시 | 매각자문·딜클로징 발표 탐색 | 2025과 동일 | 보도자료 복제본은 document family로 묶고 독립출처로 이중계상 금지 |
| BigKinds | 2020~2021 recall의 핵심 후보. 이용조건·로그인·다운로드 범위를 준수 | 지역지·통신사 검색 보강 | RSS 누락 검산 | 기사 전문 재배포 금지; 제목·일자·매체·최소 evidence locator만 보존 |
| Google/Naver 뉴스검색 | 자산명·당사자·단계별 검색; RSS보다 일반 웹/기간검색 우선 | 원문 canonical URL 복원 | RSS와 비교 | 검색 snippet은 보이는 문장만 claim; 원문 미열람 사실 표시 |
| 전문매체(SPI·더벨·인베스트조선·딜사이트·코어비트·딜북뉴스 등) | 검색노출 제목과 무료 공개면 중심 | 자문사·입찰자·조달 chronology 핵심 | 2025 방식 | 로그인·paywall·robots 우회 금지. 접근 제한은 `ACCESS_RESTRICTED`, 부재로 간주 금지 |
| 전자공고·온비드·ALIO | 공공자산·공기업 사옥/호텔/부지 | 유찰·재공고·낙찰 확인 | 동일 | 공고번호·회차·최저가·낙찰·납부완료를 별도 milestone로 기록 |
| 등기/건축물대장/토지이음·세움터 | terminal·자산 identity의 수동검증용 | 동일 | 동일 | 이용약관 준수; 등기일과 경제적 closing일이 다를 수 있음 |
| 로컬 IM 파일명 | 2020~2022 검색 alias·자문사 seed | 2023 중심의 강한 discovery seed | 2024 일부 | IM 존재 자체를 거래·입찰·종결 근거로 사용 금지; 외부 공유 금지 |

### 권장 URL

- DART: https://dart.fss.or.kr/
- OpenDART: https://opendart.fss.or.kr/ 및 목록 API 안내 https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001
- KRX KIND: https://kind.krx.co.kr/
- 리츠정보시스템: https://reits.molit.go.kr/pub/main/mainPage
- 온비드: https://www.onbid.co.kr/
- ALIO: https://www.alio.go.kr/
- BigKinds: https://www.bigkinds.or.kr/
- Google 뉴스 기간검색 예시: `https://www.google.com/search?q={URLENCODED_QUERY}&tbm=nws&tbs=cdr:1,cd_min:01/01/2024,cd_max:12/31/2024`
- Google 뉴스 RSS(보조): `https://news.google.com/rss/search?q={URLENCODED_QUERY}&hl=ko&gl=KR&ceid=KR:ko`

## 5. OpenDART 2020–2024 커버리지 계획

### 5.1 1차 population

월별 `bgn_de/end_de`로 다음 보고서명을 정규화 검색한다. `report_nm`은 공백이 빠질 수 있으므로 공백 제거값도 비교한다.

- `유형자산양도결정`, `유형자산양수결정`, `유형자산취득결정`
- `영업양도결정`, `영업양수결정` — 호텔 운영권/사업양수와 부동산매매 구분
- `타법인주식및출자증권양도결정`, `...취득결정` — 자산보유법인·리츠·SPC share deal 후보
- `주요사항보고서`, `투자판단관련주요경영사항`
- `금전대여결정`, `채무보증결정`, `담보제공결정`, `단기차입금증가결정` — 매수자 조달·closing 보조근거
- `회사합병`, `분할`, `해산사유발생` — 부동산이 특정될 때만 보조
- 정정·철회: 제목의 `정정`, `기재정정`, `해제`, `철회`를 원접수번호와 연결

### 5.2 조회 범위

- 법정 최소: 2020-01-01~2024-12-31 월 partition
- 경계 보강: 2019-10-01~2020-03-31, 2024-10-01~2026-03-31
- 자산별 후속: 최초 공시일 이후 24개월까지 동일 법인·자산명·상대방으로 재검색
- 사업/반기/분기보고서: 매각예정자산, 유형자산 처분, 중단영업, 투자부동산 주석을 우선 표본화하고 P1 법인만 전수확장

### 5.3 원문 추출 필드

`asset_name/original_address`, 법적 양도·양수 주체, 상대방, 자문/주관, 계약일, 양도기준일·잔금일, 금액과 단위, 장부가·평가가·계약가 구분, 지급일정, 선행조건, 자금조달 문구, 이사회결의일, 정정 전후값, 접수번호·첨부파일·evidence span.

### 5.4 QA

- API `total_count == parsed` 확인; 상한/누락 의심 시 날짜 분할
- `downloaded / inserted-or-updated / latest-full-text` 수량 reconciliation
- `status=014`는 `NOT_AVAILABLE_DOCUMENT_FILE`로 보존하고 DART 웹·KIND·회사 IR로 보완
- smoking test와 production run은 다른 `job_code × window × query_version` 사용
- OpenDART 미발견은 비상장 펀드·SPC 거래의 부재를 의미하지 않는다

## 6. 구연도용 query refinement

### 6.1 공통 단계 bundle

긴 OR 하나 대신 아래를 각각 실행한다.

1. **출시/자문:** `"{자산명}" (매각주관사 OR 자문사 OR 티저 OR IM OR 매물)`
2. **입찰:** `"{자산명}" (예비입찰 OR 본입찰 OR 입찰 마감 OR 원매자 OR 인수전)`
3. **결정:** `"{자산명}" (숏리스트 OR 적격후보 OR 우선협상대상자 OR 우협 OR 차순위)`
4. **계약/종결:** `"{자산명}" (MOU OR SPA OR 매매계약 OR 잔금 OR 딜클로징 OR 소유권 이전 OR 편입 완료)`
5. **실패/재출시:** `"{자산명}" (무산 OR 철회 OR 결렬 OR 해지 OR 자금조달 실패 OR 유찰 OR 재입찰 OR 재매각)`
6. **구조:** `"{자산명}" (수익증권 OR 리츠 OR 펀드 OR SPC OR 셰어딜 OR 지분 인수 OR 우선매수권)`

모든 bundle에 연도, 옛 자산명/새 자산명, 도로명/동명, 매도자·AMC·자문사 alias를 교차한다. 종결 검색은 다음해와 후년에도 반복한다.

### 6.2 자산군별 refinement

- **OFFICE:** `오피스|업무시설|사옥|빌딩|타워|프라임오피스|세일앤드리스백`; CBD/GBD/YBD와 `종로 중구 강남 서초 영등포 마포 성남 분당 판교 인천` 변형
- **HOTEL:** `호텔|리조트|관광호텔|비즈니스호텔|객실`; 반드시 `부동산|건물|보유법인|매각`을 결합. `운영사 선정|위탁운영|브랜드 계약`은 exclusion classifier에서 분리
- **LOGISTICS:** `물류센터|물류창고|창고시설|풀필먼트|상온|저온|냉동`; 수도권 외에는 `시도+시군구+IC/산단`을 결합. `센터 매각`과 `펀드 수익증권 매각`을 별도 검색
- **DATA_CENTER:** `데이터센터|IDC|전산센터|서버센터|하이퍼스케일`; `운영자산 매각`, `부지 매각`, `개발사업권`, `전기사용계약`, `리츠/펀드 지분`, `회사 인수` bundle을 분리. MOU·시공수주·입주계약은 부동산 경쟁매각에서 제외

### 6.3 구연도 특화 어휘

- 코로나기 호텔: `폐업`, `영업 종료`, `용도변경`, `구조조정`, `매각 검토`, `회생`, `공매`
- 저금리기 오피스/물류: `코어`, `블라인드펀드`, `해외투자자`, `세일앤드리스백`, `포트폴리오`, `수익증권`
- 2022~2024 조달경색: `가격 조정`, `우협 연장`, `투자자 모집`, `투심`, `LOC`, `인수금융`, `브릿지`, `리파이낸싱`, `무산`, `재매각`
- 기사 제목의 관용어(`품는다`, `새 주인`, `인수전`, `매물로`, `완판`)는 discovery에만 쓰고 terminal proof로 사용하지 않는다.

## 7. adjacent-year follow-up 규칙

1. **연도 귀속:** process 시작연도와 각 milestone 연도를 모두 저장한다. 연간 집계는 “그 해 발생 milestone”과 “그 해 시작 process”를 별도로 산출한다.
2. **기본 탐색창:** 연도 Y에 대해 Y-1년 10월~Y+1년 3월의 문서를 검색한다.
3. **P1 확장:** 우협/MOU/SPA에서 멈춘 건은 Y+2년 말 또는 terminal/재출시 확인까지 추적한다.
4. **후속확인:** 나중 기사에서 과거 closing 가격·일자를 확인하면 `follow_up_confirmation`으로 붙이고 사건일을 기사일로 바꾸지 않는다.
5. **재매각:** 기존 우협 해지 후 같은 매도자·패키지·자문사가 재입찰하면 같은 chronology의 relaunch로 연결한다. 매도구조·패키지·차량이 실질적으로 바뀌면 새 process 후보를 만들고 관계를 기록한다.
6. **대체구조:** 외부 자산매각이 우선매수권·수익증권 재편·리츠 share deal로 바뀌면 원 process를 `PREEMPTED/FAILED/STRUCTURE_CHANGED`로 두고 대체거래를 별도 경로로 기록한다.
7. **경계 예시(2025 산출물에서 이미 확인된 조사 단서):** 2024 크레센도→2025 재입찰/종결, 2024 그래비티→2025 결합 인수, 2024 글래드 패키지→2025 중단, 2024 곤지암 자문→2025 입찰/종결, 2024 로지스포인트 여주 마케팅→2025 종결. 이 문서의 2020~2024 사실로 재사용하지 말고 원문을 다시 확인한다.

## 8. 연도·자산군별 우선 리드 워치리스트

> 아래 표의 모든 항목은 **검증되지 않은 검색 리드**다. `우선도`는 예상 거래규모, chronology 복원 가능성, 인접연도 연결가치, 로컬 seed 유무를 반영한 조사순서일 뿐 사실 신뢰도가 아니다.

### 8.1 2024 리드

| 우선도 | 자산군 | LEAD_UNVERIFIED 검색 대상 | 조사 가설/핵심 질문 | 시작 검색어·후속연도 |
|---|---|---|---|---|
| P1 | OFFICE | 광화문 크레센도빌딩 | 2024 본입찰·최초 우협과 2025 우협 해지/재입찰/종결을 한 chronology로 복원 가능한가 | `크레센도빌딩 2024 본입찰 마스턴 신한 코람코`; 2025~2026 follow-up |
| P1 | OFFICE | SI타워(현대모비스 본사) | 2024 말 자문/마케팅이 시작됐는지, 2025 입찰을 process-start 기준으로 2024에 중복할 위험은 없는가 | `SI타워 매각 JLL 컬리어스 2024`; 2025 SPA/종결 |
| P1 | OFFICE | 마제스타시티 타워원 | 로컬 IM seed. 입찰자·우협·SPA·종결 및 가격유형을 재구성할 수 있는가 | `마제스타시티 타워원 매각 본입찰 우협 2024` |
| P1 | OFFICE | 씨티뱅크센터 / HSBC빌딩 / Golden Tower / Arc Place / Tower730 | 로컬 IM seed 묶음. 각 자산의 실제 process 연도와 별칭·소유차량을 먼저 판별 | 각 자산명 + `매각 본입찰 우협 딜클로징`; 2023~2025 |
| P1 | HOTEL | 그래비티 조선 서울 판교 | 2024 개별 경쟁절차의 자문·입찰·우협·계약과 2025 결합 인수구조를 분리 | `그래비티 서울판교 매각 에스원 퍼시픽 2024`; 2025 후속 |
| P1 | HOTEL | DL 글래드 3개 패키지(여의도·강남·제주) | 2024 제안/우협의 법적 당사자, 패키지 범위, 2025 협상종료를 확인 | `글래드호텔 3개 매각 그래비티 GIC 2024`; 2025~2026 |
| P1 | HOTEL | 파르나스호텔 제주 | 2024 말 자문 RFP가 있었는지와 2025 입찰무산을 연결 | `파르나스호텔 제주 매각 자문 RFP CBRE KPMG 2024`; 2025 |
| P1 | LOGISTICS | 곤지암 물류센터 | 2024 자문사 선정·마케팅과 2025 입찰/종결의 경계 확인 | `곤지암 물류센터 매각 메이트플러스 2024`; 2025 |
| P1 | LOGISTICS | 로지스포인트 여주 | 2024 포스코이앤씨 매각·CBRE 자문과 2025 코람코 종결 연결 | `로지스포인트 여주 매각 CBRE 포스코이앤씨 2024`; 2025 |
| P1 | LOGISTICS | 이천 YM 물류센터 | 2023 시작 후 2024 목표연기·2025 지연 상태를 하나의 장기 process로 볼지 확인 | `이천 YM 물류센터 카이트20호 매각 삼정KPMG 2024`; 2023~2026 |
| P2 | LOGISTICS | 로지스포인트 호법A | 2024 최초 출시 여부와 2025 이든 우협/무산의 process origin 확인 | `호법A 물류센터 매각 2024`; 2025~2026 |
| P1 | DATA_CENTER | 구로 데이터센터 개발 프로젝트 / 안산 데이터센터 개발사업 | 로컬 IM seed. 운영자산, 개발부지, 개발권, PFV 지분 중 무엇을 매각했는지부터 분류 | `구로 데이터센터 개발사업 매각 IM 2024`, `안산 데이터센터 개발사업 지분 매각 2024` |
| P2 | DATA_CENTER | 서울·수도권 IDC 보유법인/개발권 거래 전수 | 2024 대형 corporate M&A 기사가 실제 부동산 경쟁매각인지 구분 | `(데이터센터 OR IDC) (매각 OR 우협 OR 지분 인수) 2024 -운영사선정` |

### 8.2 2023 리드

| 우선도 | 자산군 | LEAD_UNVERIFIED 검색 대상 | 조사 가설/핵심 질문 | 시작 검색어·후속연도 |
|---|---|---|---|---|
| P1 | OFFICE | Tower730 | 로컬 IM seed. 매도펀드·자문사·입찰자·종결의 연도 일치 여부 | `Tower730 타워730 매각 본입찰 2023` |
| P1 | OFFICE | Arc Place | 자산 alias(아크플레이스)와 매각/리파이낸싱을 구분 | `아크플레이스 Arc Place 매각 JLL 2023` |
| P1 | OFFICE | 씨티뱅크센터 | 은행 사옥 세일앤드리스백/일반 펀드 처분 여부와 종결 확인 | `씨티뱅크센터 매각 컬리어스 에스원 2023` |
| P1 | OFFICE | HSBC빌딩 | 로컬 IM seed. 입찰·우협·계약의 공개 강도를 조사 | `HSBC빌딩 매각 에스원 JLL 2023` |
| P1 | OFFICE | 아남타워 | 로컬 IM seed. CBRE/C&W 자문 시점과 경쟁라운드 확인 | `아남타워 매각 CBRE 쿠시먼 2023` |
| P1 | OFFICE | 센터포인트 강남 / Golden Tower | 개별 자산인지 패키지인지, 리츠/share deal인지 확인 | 각 자산명 + `매각 우협 2023` |
| P2 | OFFICE | 좋은사람들빌딩 / 방배빌딩 / 분당서현빌딩 / 구세군빌딩 / K-Square 사당 | 로컬 IM seed의 실제 시장출시·입찰 여부를 판별 | 자산명 + `매각 IM 본입찰 2023`; 2022~2024 |
| P1 | HOTEL | 신라스테이 마포(1차 프로세스) | 2023 키움 우협·조달실패와 2025 재매각을 같은 chronology로 연결할지 확인 | `신라스테이 마포 매각 키움 하나대체 2023`; 2024~2025 |
| P2 | HOTEL | 국내 비즈니스호텔 구조조정/공매 후보 | 서울 외 부산·제주·인천 누락 탐색 | `(호텔 OR 리조트) (본입찰 OR 우협 OR 공매 OR 매각 무산) 2023 {지역}` |
| P1 | LOGISTICS | 평택 어연리 물류센터 / 여주 대신 물류센터 | 로컬 IM seed. 경쟁입찰·우협·종결 여부 확인 | 자산명 + `매각 2023` |
| P1 | LOGISTICS | 안성 GL 물류센터 / 토니모리 물류센터 | 동일 시기 Deloitte 안내서가 개별/패키지 마케팅인지 판별 | `안성지엘 물류센터 매각 2023`, `토니모리 물류센터 매각 2023` |
| P1 | LOGISTICS | 용인 백암 Fresh센터 / LogisPoint 평택 / 화성 덕절 미래인로지스 | IM seed와 실제 bid process를 구분 | 자산명 + `매각 본입찰 우협`; 2022~2024 |
| P1 | LOGISTICS | 이천 YM 물류센터 | 2023 삼정KPMG 선정·최초 출시가 장기 process의 시작인지 확인 | `이천 YM 물류센터 삼정KPMG 매각 2023`; 2024~2026 |
| P1 | DATA_CENTER | Seoul Guro Data Center Development Project | 개발권/PFV 지분/토지 거래인지, 입찰이 있었는지 확인 | `구로 데이터센터 개발사업 매각 컬리어스 2023` |
| P1 | DATA_CENTER | 안산 데이터센터 개발사업 | 부지·개발사업·자금조달 마케팅과 실물 경쟁매각을 분리 | `안산 데이터센터 개발사업 매각 RSQUARE 2023` |

### 8.3 2022 리드

| 우선도 | 자산군 | LEAD_UNVERIFIED 검색 대상 | 조사 가설/핵심 질문 | 시작 검색어·후속연도 |
|---|---|---|---|---|
| P1 | OFFICE | IFC 서울 패키지 | 대형 매각 추진·본입찰/우협 또는 철회·무산을 정확히 재구성하고 Conrad 호텔·몰·오피스 패키지 범위를 확인 | `IFC 서울 매각 본입찰 우협 2022 브룩필드`; 2021~2023 |
| P1 | OFFICE | 서울 주요 프라임오피스 무산·재가격 건 | 금리 급등 이후 우협 해지/자금조달 실패가 다음해 재출시됐는지 탐색 | `(프라임오피스 OR 빌딩) (우협 해지 OR 매각 무산 OR 재매각) 2022 서울` |
| P2 | OFFICE | Tower730 / Arc Place / Majestar / HSBC / Citi Center의 process origin | 2023 IM이 2022 자문선정·마케팅에서 시작됐는지 확인 | 각 자산명 + `2022 매각주관사 티저` |
| P1 | HOTEL | 밀레니엄 힐튼 서울 후속 | 2020~2021 협상/계약과 2022 closing·영업종료·개발계획을 분리 | `밀레니엄 힐튼 매각 잔금 소유권 2022`; 2020~2023 |
| P1 | HOTEL | 르메르디앙 서울 / 쉐라톤 서울 팔래스 강남 후속 | 코로나기 매각의 계약·종결·철거/개발을 별도 이벤트로 연결 | 자산명 + `매각 종결 소유권 2022`; 2020~2023 |
| P2 | HOTEL | 신라스테이 해운대 과거 매각 시도 | 2025 기사에 등장한 2022 자문/매각 시도가 독립 process였는지 확인 | `신라스테이 해운대 매각 에비슨영 딜로이트 2022`; 2023~2025 |
| P1 | LOGISTICS | 수도권 대형 물류 포트폴리오/수익증권 거래 | 자산별 가격과 포트폴리오 조달을 분리하고 동일 거래 중복을 방지 | `(물류센터 OR 물류포트폴리오) (본입찰 OR 수익증권 매각 OR 우협) 2022` |
| P2 | LOGISTICS | 용인·이천·안성·평택 냉동/상온 센터 | 금리상승 전후 우협 철회·PF 인수와 운영자산 매매 구분 | `{시군} 물류센터 매각 우협 무산 2022` |
| P1 | DATA_CENTER | 서울 가산·구로·상암 IDC 자산/보유법인 | 통신·IDC 회사 지분매각과 건물/개발권 매각의 경계를 확인 | `(가산 OR 구로 OR 상암) (IDC OR 데이터센터) (매각 OR 지분 인수) 2022` |
| P2 | DATA_CENTER | 해외 운영사 국내 진입 거래 | 토지·건물 acquisition인지 개발 JV/MOU인지 분류 | `(데이터센터 OR IDC) (인수 OR 합작 OR 부지 매입) 2022 한국` |

### 8.4 2021 리드

| 우선도 | 자산군 | LEAD_UNVERIFIED 검색 대상 | 조사 가설/핵심 질문 | 시작 검색어·후속연도 |
|---|---|---|---|---|
| P1 | OFFICE | IFC 서울 매각 준비 | 2021 자문·마케팅 시작 여부와 2022 본 절차 연결 | `IFC 서울 매각주관사 2021`; 2022~2023 |
| P1 | OFFICE | 트윈트리타워 / 파인애비뉴 / 서울스퀘어 등 CBD 대형자산 | 실제 2021 거래 대상이 맞는지부터 검증하고 동명·과거거래 오탐 제거 | 각 자산명 + `매각 본입찰 우협 2021` |
| P2 | OFFICE | 판교·분당 대형 사옥 세일앤드리스백 | 기업 유형자산 공시와 운용사 기사 연결 | `(판교 OR 분당) 사옥 세일앤드리스백 매각 2021` |
| P1 | HOTEL | 밀레니엄 힐튼 서울 | 2020 LOI/MOU 단서와 2021 매매계약/인수주체·가격·개발목적을 원문으로 확인 | `밀레니엄 서울 힐튼 매각 이지스 2021`; 2020~2023 |
| P1 | HOTEL | 르메르디앙 서울 | 매각주체·우협/계약·개발구조·종결을 확인 | `르메르디앙 서울 매각 2021 우협`; 2020~2023 |
| P1 | HOTEL | 쉐라톤 서울 팔래스 강남 | 영업종료와 부동산/법인 거래를 분리 | `쉐라톤 서울 팔래스 강남 매각 2021`; 2020~2023 |
| P2 | HOTEL | 제주·부산 리조트/호텔 공매·회생 매각 | 공개입찰·회생 M&A·운영권을 구분 | `{지역} 호텔 (공매 OR 회생 OR 본입찰 OR 우협) 2021` |
| P1 | LOGISTICS | ESR켄달스퀘어·Logos·ARA·GIC 관련 물류 포트폴리오 | 투자자/운용사 corporate deal과 개별 운영자산 매매를 분리; 자산 manifest 확보 | `(ESR켄달스퀘어 OR 로고스 OR ARA OR GIC) 물류센터 매각 2021` |
| P2 | LOGISTICS | 용인 백암·이천·안성 대형센터 | 2021 준공/선매입과 운영자산 경쟁매각의 혼동 제거 | `{자산명/시군} 물류센터 (매각 OR 선매입 OR 수익증권) 2021` |
| P1 | DATA_CENTER | 수도권 IDC 운영자산/회사 지분거래 | 회사 M&A 기사에서 부동산 소유권·리스 구조를 추출할 수 있는지 확인 | `(IDC OR 데이터센터) (매각 OR 인수 OR 지분) 2021 서울 경기` |

### 8.5 2020 리드

| 우선도 | 자산군 | LEAD_UNVERIFIED 검색 대상 | 조사 가설/핵심 질문 | 시작 검색어·후속연도 |
|---|---|---|---|---|
| P1 | OFFICE | 코로나기 수도권 세일앤드리스백 | 상장사 `유형자산양도결정`에서 자산명·상대방·계약/양도기준일을 확보하고 언론 입찰 chronology와 연결 | OpenDART 2020 + `(사옥 OR 빌딩) (세일앤드리스백 OR 매각 우협)` |
| P1 | OFFICE | 서울스퀘어 / 센터플레이스 / 시그니쳐타워 등 CBD 후보군 | 2020 실제 process 여부를 먼저 검증; 동명 과거거래·리파이낸싱 제거 | 각 자산명 + `2020 매각 본입찰`; 2019~2022 |
| P2 | OFFICE | 강남·판교 기업사옥 매각 | 기업 구조조정·현금확보 공시와 자산거래 연결 | `(강남 OR 판교) 사옥 유형자산 양도 2020` |
| P1 | HOTEL | 밀레니엄 서울 힐튼 | 로컬 `99. 밀레니엄힐튼_2020.07`의 LOI/MOU 파일명은 discovery seed일 뿐. 2020 공식 마케팅/협상과 2021~2022 계약·종결을 공개자료로 독립 검증 | `밀레니엄 서울 힐튼 매각 MOU 2020`; 2021~2023 |
| P1 | HOTEL | 르메르디앙 서울 | 코로나기 구조조정 매각의 시작연도·입찰/우협·종결 확인 | `르메르디앙 서울 매각 2020`; 2021~2023 |
| P1 | HOTEL | 쉐라톤 서울 팔래스 강남 | 영업종료 발표와 거래 절차가 같은 시점인지 확인 | `쉐라톤 서울 팔래스 강남 매각 2020`; 2021~2023 |
| P2 | HOTEL | 전국 폐업·회생 호텔/리조트 | `폐업/영업종료`를 매각으로 오인하지 않고 공매·법원/회생 매각만 별도 추적 | `{17개 시도} 호텔 (폐업 OR 공매 OR 회생 OR 매각) 2020` |
| P1 | LOGISTICS | 수도권 대형센터·포트폴리오 | 전자상거래 성장기 선매입·개발투자와 준공 운영자산 경쟁매각을 구분 | `(물류센터 OR 물류포트폴리오) (매각 OR 본입찰 OR 수익증권) 2020` |
| P2 | LOGISTICS | 비수도권 산업단지·항만권 물류 | 지역지·온비드·기업공시 중심으로 부산·경남·충청·호남 공백 점검 | `{지역/산단/항만} 물류센터 매각 입찰 2020` |
| P1 | DATA_CENTER | 서울 가산·구로·상암 기존 IDC | 노후 사옥/IDC의 회사 매각, 실물매매, 개발권 거래를 분리 | `(가산 OR 구로 OR 상암) (IDC OR 데이터센터) 매각 2020` |
| P2 | DATA_CENTER | 통신사·IT기업 전산센터 유형자산 공시 | 상장사 공시에서 주소·상대방이 특정되는 경우만 승격 | OpenDART 2020 `유형자산양도결정` + `전산센터|IDC|데이터센터` |

## 9. 지역 coverage 체크리스트

### OFFICE(수도권)

- 서울: CBD(종로·중구), GBD(강남·서초), YBD(영등포·마포), 기타(성동·용산·구로·금천·송파)
- 경기: 성남 분당/판교, 과천, 수원, 용인, 고양, 안양, 부천, 김포, 화성
- 인천: 연수/송도, 남동, 부평, 서구/청라

### HOTEL / LOGISTICS / DATA_CENTER(전국)

- 17개 시도 모두 partition을 남긴다.
- HOTEL 고밀도: 서울·부산·제주·인천·경기·강원
- LOGISTICS 고밀도: 경기(이천·용인·안성·평택·여주·광주·김포)·인천, 충남/충북, 부산·경남; 호남·강원은 분기 검색 후 지역지·온비드 보강
- DATA_CENTER: 서울 서남권·상암, 경기 안양/과천/고양/성남/용인/하남, 인천; 이후 전국 혁신도시·산단을 확장

지역 0건은 `NO_RESULTS_PUBLIC_SEARCH`와 `SOURCE_ACCESS_GAP`을 구분한다.

## 10. 리드 조사 sheet와 판정 규칙

### 10.1 최소 필드

- `lead_id`, `lead_status=LEAD_UNVERIFIED`, asset/package, alias, address/region, asset type
- `process_origin_year`, milestone date와 date precision, document publication date
- legal owner/selling vehicle, AMC/manager, sponsor, headline seller(서로 합치지 않음)
- sell-side adviser, round type/date, expressly named bidders, shortlist/rank
- amount original text/value/type/comparator/scope
- preferred bidder, MOU, SPA, balance, ownership/share/beneficiary transfer, failed/withdrawn/rebid
- funding vehicle, LP/equity, debt/lender, planned/committed/executed 상태
- claim-level source URL/date/evidence span/access note
- exclusion/review code와 adjacent process link

### 10.2 승격 게이트

- `PROCESS_FOUND`: 자산·매도 주체·매각행위가 식별되는 직접 원문 또는 독립 보도
- `BID_RECEIVED`: 관심/IM 수령이 아니라 실제 입찰 제출 표현 필요
- `PREFERRED_BIDDER`: 선정 주체와 라운드가 특정돼야 함; 가격 1위를 자동 추정하지 않음
- `SPA_SIGNED`: 계약 체결 문구·일자/기간 필요; MOU와 분리
- `TERMINAL_CONFIRMED`: 잔금, 소유권/수익증권/주식 이전, 리츠 편입, closing 발표 등 완료행위 필요
- `FAILED/WITHDRAWN`: “무산될 전망”이 아니라 협상종료·우협해지·철회·무응찰·재매각의 후속 근거 필요

### 10.3 주요 exclusion code

`OPERATOR_TENDER`, `BRAND_APPOINTMENT`, `DEVELOPMENT_MOU_ONLY`, `CORPORATE_MA_NO_ASSET_PROOF`, `REFINANCING_ONLY`, `DEVELOPMENT_SITE_NOT_OPERATING_ASSET`, `HISTORICAL_BACKGROUND_ONLY`, `EXPECTED_PRICE_ONLY`, `PLANNED_MILESTONE_ONLY`, `DUPLICATE_SYNDICATION`, `OUT_OF_GEOGRAPHY`, `OUT_OF_PERIOD`.

## 11. 구체적인 주간 실행안

### Week 1 — 2024 calibration

- 4개 자산군 source/query matrix 확정
- OpenDART 2024 월 partition 및 정정/철회 chain
- P1 2024 리드 10~12건 chronology 작성
- 2025 산출물과 process boundary reconciliation

### Week 2 — 2023 IM-seeded campaign

- 로컬 IM 파일명에서 alias·자문사만 seed로 추출(내용/거래사실로 인용 금지)
- OFFICE·LOGISTICS P1 리드 원문검색
- BigKinds/일반 뉴스/전문매체/당사자 문서의 hit rate 비교

### Week 3 — 2022 stress-year campaign

- 무산·철회·재가격 query를 기본 bundle에 추가
- IFC 및 코로나기 호텔 terminal follow-up
- OpenDART 조달·타법인출자 보조공시 연결

### Week 4 — 2021 campaign

- 대형 오피스·호텔·물류 포트폴리오
- share/beneficiary-interest 구조와 개별 자산 manifest 분리
- 전국 지역 coverage 빈칸 review

### Week 5 — 2020 source-led campaign

- OpenDART/KIND/BigKinds/당사자 아카이브 우선
- 코로나기 호텔 폐업·운영종료 오탐 집중검수
- 데이터센터·비수도권 희소 category는 접근결과 자체를 coverage로 남김

### Week 6 — cross-year reconciliation 및 QA

- 모든 P1의 Y-1~Y+2 후속검색
- syndication family와 sale process dedupe
- closed/failed/contract-only/marketing-only 각각 표본 fixture 검증
- `coverage-ledger-2020-2024`, `lead-register`, `source-gap-report`, 연도별 synthesis 초안 생성(여전히 DB 쓰기 없음)

## 12. 산출물과 중단 기준

### 권장 staging 산출물

- `competitive-sales-2020-2024-coverage-ledger.csv`
- `competitive-sales-2020-2024-leads.json`
- `competitive-sales-{year}-{asset_type}-deep-dive.md`
- `competitive-sales-2020-2024-source-gap-report.md`
- `competitive-sales-2020-2024-validation.json`

### 조사 중단/에스컬레이션

- 로그인·CAPTCHA·paywall·robots가 있으면 우회하지 않고 `ACCESS_RESTRICTED`
- 원문 미제공이면 snippet에 보이는 문장만 저장하고 terminal 승격 금지
- 동일 자산의 법적 owner/AMC/sponsor가 충돌하면 `LEGAL_SELLER_UNRESOLVED`
- 비공개 IM·입찰서·대출약정 없이는 채울 수 없는 bidder price/LP/lender는 `UNDISCLOSED_UNCONFIRMED`
- 2회 query refinement와 공식소스 확인 뒤에도 식별 불가하면 추정하지 않고 review backlog로 넘긴다.

---

## 결론

가장 효율적인 진입점은 **2024→2023→2022→2021→2020** 역순이다. 2024는 2025의 연속 사례로 상태머신을 보정할 수 있고, 2023은 로컬 IM 파일명이 alias·자문사 discovery seed를 제공한다. 2022 이전은 RSS보다 OpenDART/KIND·리츠/AMC 보고서·BigKinds·당사자 문서를 우선해야 한다. 위 watchlist는 모두 검증 전 lead이며, 실제 역사 백필에서는 자산별 claim-level source와 adjacent-year terminal proof를 확보한 뒤에만 사실로 승격한다.
