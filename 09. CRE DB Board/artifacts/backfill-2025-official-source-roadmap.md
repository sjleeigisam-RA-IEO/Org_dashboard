# 2025 공식소스 확장 로드맵

기준: 2026-08-15 공개 접근·API 조사 및 2025 1차 백필 실행 결과

## 1. 판정 원칙

- 법적·거래상 최종 상태는 공식 원천 또는 당사자 원문으로만 확정한다.
- 전문매체·검색 RSS는 후보 발견과 중간 단계 보강에만 사용한다.
- 게시일, 사건 효력일, 예정일, 수집일을 분리한다.
- 정정·철회·취소 문서를 삭제하지 않고 revision/supersession으로 연결한다.
- 우협 선정, SPA 체결, 잔금·종결은 서로 다른 stage다.
- PF 주선·검토, 금융약정, 실제 인출은 서로 다른 stage다.
- 위원회 의결, 허가 발급, 고시 효력은 서로 다른 stage다.
- 준공 예정, 실제 준공, 사용승인, 영업·입주 개시는 서로 다른 stage다.

## 2. 다음 실행 우선순위

### P1. 건축HUB — 인허가·착공·사용승인

- 공식 카탈로그: https://www.data.go.kr/data/15136267/openapi.do
- 접근: 공공데이터포털 REST JSON/XML
- 현재 환경: `DATA_GO_KR_KEY` 사용 가능
- 대상 날짜: 허가일, 착공일, 사용승인일, 철거·멸실일
- 주요 키: 신규 건축데이터 PK, 허가대장 PK, 법정동코드, 대지위치
- 적재 원칙:
  - 허가, 착공, 사용승인을 별도 event transition으로 저장
  - 구 시스템 PK 전환표가 있으면 alias/crosswalk 보존
  - 복합시설 전체 연면적을 특정 용도 공급량으로 복사하지 않음

### P2. OpenDART 본문 확장 — 매각·PF·대출·투자

- API: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001
- 현재 환경: `DART_API_KEY` 사용 가능
- 기존 완료: 주요사항보고 8,416건 스캔, 매각형 보고서 66건 적재
- 다음 범위:
  - 유형자산 양도·취득 본문
  - 채무보증·담보제공
  - 차입·대출·만기
  - 타법인 주식·출자증권 취득
  - 사업보고서 주석의 PF 익스포저
- 안정키: `rcept_no`, `corp_code`, 보고서명
- 정정·철회 공시는 원문과 연결하고 별도 version으로 보존

### P3. 2025 adjacent-year reconciliation

- 게시일 탐색 범위: 2024-10-01 ~ 2026-03-31
- 목적:
  - 2024년에 발표된 2025 예정 준공·계약
  - 2026년에 확인된 2025 종결·사용승인·정정
- 2025 사건일과 문서 게시일을 분리해 연결

### P4. R-ONE — 거래량·지가·상업용 임대동향

- API 안내: https://www.reb.or.kr/r-one/portal/openapi/openApiDevPage.do
- 현재 환경: 전용 R-ONE API key 미확인
- 우선 시계열:
  - 토지거래 월 `A_2024_00532`, 2006-01~
  - 건축물거래 월 `A_2024_00542`, 2006-01~
  - 지가변동률 `A_2024_00903`, 2005-01~
  - 오피스·상가 공실률/임대료: 구간별 table ID를 별도 series segment로 저장
- 장기열은 방법론·표본·상권구획 변경 구간을 임의 연결하지 않음

### P5. KOSIS — 건축·공급·물가·건설비

- Open API: https://kosis.kr/openapi/index/index.jsp
- 현재 환경: 전용 KOSIS API key 미확인
- 우선 시계열:
  - 주택 인허가 연간 `116 / DT_MLTM_666`, 1990~
  - 주택 착공 월계 `DT_MLTM_5386`, 2011~
  - 주택 준공 월계 `DT_MLTM_5372`, 2010~
  - 건축착공 구계열 `DT_MLTM_562`, 2000~2012
  - 건축허가 신계열 `DT_MLTM_2200`, `6906`
  - 건축착공 신계열 `DT_MLTM_2202`, `6905`
  - 소비자물가지수 `101 / DT_1J22003`, 1965~
  - 건설공사비지수 `397 / DT_39701_A003`, 2000~
- 월계·월 누계·연간 표를 같은 series로 혼합하지 않음

### P6. ECOS — 금리·물가·산업대출

- API: https://ecos.bok.or.kr/api/
- 현재 환경: 전용 ECOS API key 미확인
- 2000년 백필 우선 시계열:
  - 기준금리 `722Y001 / 0101000`
  - 국고채 3년 `817Y002 / 010200000`
  - 회사채 3년 AA- `817Y002 / 010300000`
  - CD 91일 `817Y002 / 010502000`
  - 기업대출 신규금리 `121Y006 / BECBLA02`
  - 시설자금대출 신규금리 `121Y006 / BECBLA0204`
  - 생산자물가지수 `404Y014 / *AA`
  - 산업별 대출 `131Y013` 등
- 표·항목·주기 코드를 복합 안정키로 사용

### P7. PF·리츠·펀드 집계

- PF 총계: 금융위원회·금융감독원 「부동산 PF 상황 점검」 릴리스와 첨부표
- FISIS: https://fisis.fss.or.kr/page/api-intro.jsp
  - 개별 자산 사건이 아니라 업권·회사 총량 검산용
  - PF 전용 안정 시계열은 현재 미확인
- 리츠정보시스템: https://reits.molit.go.kr/pub/main/mainPage
  - 리츠 수, 자산총계, 투자자산 유형, 투자보고서·영업보고서
- KOFIA FreeSIS: https://freesis.kofia.or.kr/stat/main.do
  - 부동산펀드 설정액·순자산·자금유출입
  - 공개 REST보다 웹 조회·엑셀 다운로드 중심

## 3. 보조·발견 소스 정책

- Google News RSS: 공개 RSS 메타데이터만 후보 생성
- 인베스트조선: 명시된 무료뉴스 RSS 사용 가능
- SPI·마켓인·딜북뉴스: 공개 제목·요약·URL 범위만 사용
- 더벨: robots 차단 확인으로 자동수집 제외, 수동 검증만
- 딜사이트: robots가 제한한 검색·경로 자동화 금지
- CBRE Korea: 조사 환경에서 403, 우회 금지
- 법원경매: CAPTCHA·접근통제 우회 금지

## 4. Macro revision 모델

각 API가 현재 저장값만 반환할 수 있으므로 매 수집 시 다음을 보존한다.

1. native table·item·classification ID
2. 기준기간과 공표일
3. 조회시각과 요청 파라미터
4. 원응답·첨부파일 hash
5. 잠정·확정·개정 상태
6. supersedes release/observation
7. 기준연도·표본·분류 변경에 따른 series segment

## 5. 권장 실행 순서

1. 기존 `DATA_GO_KR_KEY`로 건축HUB 2025 표본 API 검증
2. 서울부터 허가·착공·사용승인 월 partition 실행
3. OpenDART 66건 본문 claim 추출 및 정정 연결
4. 2024-10~2026-03 adjacent-year 검색
5. R-ONE·KOSIS·ECOS 키 확보 후 2000년 우선 macro 백필
6. 검수 통과 event cluster만 canonical event 승인
