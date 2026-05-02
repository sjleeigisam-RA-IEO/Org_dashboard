# T-5-T 데이터 전처리 및 적재 작업 현황 (완료)

- [x] `process_t5t_csv.py` 스크립트 기반 마련
    - [x] CSV 데이터 로드 및 인코딩 처리
    - [x] 시점 데이터(연, 월, 주차) 정규화 로직 구현 (화-월 주기 반영)
- [x] 마스터 데이터 기반 매칭 엔진 구축
    - [x] Staff 매칭 (Name/Email)
    - [x] Project/Fund 매칭 (Fuzzy Matching 및 다중 컬럼 지원)
- [x] 토큰화 및 분류 로직 구현
    - [x] 일반/프로젝트 업무 구분
    - [x] 이해관계자(Stakeholder) 추출 및 분류
    - [x] **거래상대방(Counterparty) 마스터 구축 및 FK 매칭 (563건 구축 완료)**
- [x] DB 적재 및 검증
    - [x] Supabase `t5t_form_submissions` 및 `t5t_form_items` 전체 적재 완료 (579건)
    - [x] 매트릭스 분석 구조 (시기, 프로젝트, 작성자, 이해관계자, 이슈) 구축 완료
- [ ] (향후) 대시보드 연동 및 입력 시스템 기획
