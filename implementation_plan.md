# 프로젝트명: CRM 데이터 자동화 & 프리미엄 대시보드 구축

본 프로젝트는 엑셀 기반의 CRM 데이터(대주/수익자 정보)를 자동으로 정제하여 클라우드 DB(Supabase)에 적재하고, 이를 실시간으로 시각화하는 반응형 웹 대시보드를 구축하는 것을 목표로 합니다.

## 핵심 가치
1. **자동화**: 더블 클릭 한 번으로 엑셀 전처리 및 DB 업로드 완료
2. **성능**: 클라우드 SQL(PostgreSQL) 기반의 빠른 데이터 로딩 및 검색
3. **디자인**: 프리미엄 감성의 다크 모드 UI와 인터랙티브 시각화

---

## 1. 기술 스택 (Tech Stack)
*   **ETL (Extract, Transform, Load)**: Python 3.11+ (Pandas, Supabase-py)
*   **Database**: Supabase (PostgreSQL)
*   **Frontend**: Next.js (React), Tailwind CSS, Lucide Icons
*   **Visualization**: Recharts (Interactive Charts)
*   **Automation**: Windows Batch Script (.bat)

---

## 2. 데이터 아키텍처 (Database Schema)

### [Master Tables]
*   **funds**: 펀드 기본 정보 (코드, 명칭, 섹터, 자산명 등)
*   **entities**: 대주 및 수익자 통합 마스터 (이름 정제 및 분류용)

### [Relation Tables (Exposures)]
*   **lender_exposures**: 펀드별 대주 익스포저 (금리, 트렌치, 대출액 등)
*   **beneficiary_exposures**: 펀드별 수익자 익스포저 (지분율, 약정액, 투입액 등)

---

## 3. 구현 단계별 계획

### Phase 1: ETL 파이프라인 구축 (현재 단계)
*   [x] 엑셀 데이터 정제 로직 개발 (이름 통일, 숫자 변환)
*   [ ] Supabase DB 스키마 설계 및 테이블 생성
*   [ ] Python 업로더 개발 (Upsert 기능 포함)
*   [ ] 윈도우 원클릭 실행 배치 파일 제작

### Phase 2: 웹 대시보드 UI/UX 설계
*   [ ] 대시보드 레이아웃 및 디자인 시스템 설정
*   [ ] 반응형 필터 및 검색 컴포넌트 개발
*   [ ] 섹터별/금융기관별 익스포저 시각화 차트 구현

### Phase 3: 고도화 및 배포
*   [ ] 상세 정보 팝업 및 검색 기능 강화
*   [ ] 데이터 정제용 매핑 파일(JSON/CSV) 사용자 관리 기능
*   [ ] 최종 웹 배포 및 동기화 테스트

---

## 4. 사용자 리뷰 필요 사항
> [!IMPORTANT]
> **구글 서비스 및 Supabase 계정 설정**
> - Supabase 프로젝트 생성이 필요합니다 (제가 가이드를 드릴 예정입니다).
> - 대주/수익자 이름 중 미세하게 다른 것들을 하나로 합치는 '매핑 규칙'에 대한 검토가 필요합니다.

## 5. 오픈 질문
- 웹 대시보드에 접근할 수 있는 인원은 누구인가요? (로그인 기능 필요 여부)
- 특정 기간별 트렌드(과거 데이터 비교) 기능이 필요한가요?
