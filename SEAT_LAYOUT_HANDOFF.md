# 자리배치 탭 핸드오프

## 1. 목적
- 기존 조직구성 대시보드에 `자리배치` 탭을 추가해, 층별 좌석 배치와 개편 전/후 이동을 시각화한다.
- 최종 목표는 아래 2가지 모드를 함께 운영하는 것이다.
  - 보기 모드: 현재안/변경안 비교, 층별 좌석 배치 확인
  - 관리자 모드: 변경안만 수정하고 저장, 추후 새 버전(`2611`, `2701` 등) 추가

## 2. 현재까지 된 것

### 2.1 자리배치 데이터 추출
- 입력 파일: [20260401_좌석배치(안)_수정.xlsx](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\20260401_좌석배치(안)_수정.xlsx)
- 추출 스크립트: [build_seat_layout_data.py](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\build_seat_layout_data.py)
- 산출 데이터:
  - [seat-layout-data.json](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout-data.json)
  - [seat-layout-data.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout-data.js)
  - [seat-layout-overlays.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout-overlays.js)

### 2.2 시트 구조 파악
- 실제 시트명:
  - `세우 2F_현재`
  - `세우 2F_1`
  - `세우12F_현재`
  - `세우12F_1`
  - `세우13F_현재`
  - `세우13F_1`
- 좌석코드는 층 + 좌석번호 구조로 유지하는 것이 적합하다고 정리함.
- 현재 추출 좌석 수:
  - 2F: 116
  - 12F: 177
  - 13F: 70

### 2.3 대시보드 연결
- 기존 대시보드에 `자리배치` 탭 추가
- 수정 파일:
  - [index.html](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\index.html)
  - [sheet-loader.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\sheet-loader.js)
  - [styles.css](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\styles.css)
  - [seat-layout.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout.js)

### 2.4 참고 도면 확보
- 참고 PDF: [세우빌딩 평면도_260402.pdf](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\세우빌딩 평면도_260402.pdf)
- 미리보기 이미지:
  - [page_1.png](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_pdf_preview\page_1.png)
  - [page_2.png](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_pdf_preview\page_2.png)
  - [page_3.png](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_pdf_preview\page_3.png)

## 3. 현재 UI 상태

### 3.1 구현된 것
- `조직구성 / 자리배치` 탭 전환 가능
- `13F / 12F / 2F` 순서의 층 레이어 선택 가능
- `현재안 / 변경안` 토글 가능
- 층별 이동 요약 리스트 표시 가능

### 3.2 현재 문제
- 사용자 피드백 기준으로 자리배치 시각화는 아직 품질이 낮음
- 좌석 배치가 부정확하고, 평면도 느낌이 약함
- 디자인이 촌스럽고 가독성이 낮다고 피드백 받음
- “워크존”, “지원좌석” 같은 임시 좌석구역명은 사용하면 안 됨
- 좌석구역은 무라벨 또는 실제 명칭만 사용해야 함
- 도면 위 개별 객체처럼 흩뿌리는 방식보다, 블록형 재구성이 더 적합하다는 방향 합의

## 4. 최근에 반영한 중요한 결정
- 층 레이어 순서는 `13층 > 12층 > 2층`
- 좌석코드는 불변 기준으로 유지
- 이후 `구역`, `조직`, `사람`은 좌석코드 위에 오버레이 맵핑
- 자리배치 버전은 `2506`, `2604` 같은 시점 코드로 관리
- 향후 `2611`, `2701` 같은 신규 변경안 버전 추가를 전제로 설계
- 관리자 모드에서는 `현재안`은 고정, `변경안`만 수정

## 5. 구글시트 연동 방향

### 5.1 이미 정리된 구조
- 관련 문서:
  - [seat_layout_sheet_schema.md](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_sheet_schema.md)
  - [seat_layout_build_order.md](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_build_order.md)

### 5.2 추천 시트 구조
- `seat_master`
  - 불변 좌석 마스터
  - `seat_code`, `floor_code`, 좌표/유형 등
- `seat_versions`
  - `2506`, `2604`, `2611` 등 버전 관리
- `seat_assignments`
  - 버전별 사람-좌석 매핑
- `seat_zone_map`
  - 버전별 좌석-구역 매핑

### 5.3 관리자 모드 방향
- 비밀번호로 활성화
- `수정 중인 변경안 버전` 선택
- 또는 `새 변경안 버전 추가`
- 저장 대상은 구글시트의 `seat_assignments`, `seat_zone_map`

## 6. 다음 스레드에서 바로 해야 할 일

### 6.1 1순위
- [seat-layout.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout.js)와 [styles.css](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\styles.css)를 중심으로 자리배치 디자인 전면 개선
- 방향:
  - 화이트/웜그레이 계열
  - 모던하고 절제된 평면도 느낌
  - 블록형 배치
  - 도면 가독성 우선

### 6.2 2순위
- 좌석영역을 개별 객체가 아니라 더 큰 레고형 블록/그리드로 재구성
- 공용부, 회의실, 코어 영역을 실제 평면도처럼 더 명확하게 정리
- 좌석 배치 오차와 겹침 제거

### 6.3 3순위
- `seat_zone_map` 개념을 실제 UI에 붙여 구역 색칠과 조직 오버레이 준비
- 2층/12층의 타 부문 좌석 회색 처리

### 6.4 4순위
- 관리자 모드 초안
  - 비밀번호 입력
  - 수정할 버전 선택
  - 신규 버전 생성
  - 변경안만 수정 후 저장

## 7. 유의사항
- 사용자 피드백상, 자리배치 탭은 아직 “보여주기용 완료본”이 아님
- 다음 스레드에서 “현재 디자인이 왜 별로인지” 다시 설명할 필요 없이 이 문서를 기준으로 바로 개선 작업 들어가면 됨
- 특히 다음 3가지는 다시 실수하면 안 됨
  - 임시 좌석구역명 붙이기
  - 과한 색상 사용
  - 좌석 겹침/부정확한 위치

## 8. 로컬 실행
- 작업 폴더: [org_dashboard](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard)
- 로컬 서버 실행 예시:
```powershell
cd "D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard"
python -m http.server 8787
```
- 확인 주소:
  - [http://localhost:8787](http://localhost:8787)

## 9. 핵심 파일 목록
- [seat-layout.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout.js)
- [styles.css](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\styles.css)
- [index.html](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\index.html)
- [sheet-loader.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\sheet-loader.js)
- [build_seat_layout_data.py](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\build_seat_layout_data.py)
- [seat-layout-data.json](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout-data.json)
- [seat-layout-data.js](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat-layout-data.js)
- [seat_layout_sheet_schema.md](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\seat_layout_sheet_schema.md)
- [SEAT_LAYOUT_HANDOFF.md](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\SEAT_LAYOUT_HANDOFF.md)
