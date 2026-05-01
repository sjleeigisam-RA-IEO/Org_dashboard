# IOTA Seoul T-5-T 데이터 전처리 및 DB 적재 계획 (2026-05-02)

본 문서는 `t5t-dashboard/IGIS RA T-5-T Forms_Submissions_2026-05-01.csv` 파일을 전처리하여 Supabase DB로 자동 적재하고, 향후 데이터 정규화 및 분석이 가능하도록 환경을 구축하는 것을 목표로 합니다.

## 1. 데이터 표준화 및 정규화
*   **시점 데이터**: `Submitted at` 필드를 기반으로 연도(YYYY), 월(MM), 주차(ISO Week, 1~52)를 자동 계산하여 `week_key` 생성.
*   **작성자 매핑**: CSV의 `이름`과 `E-mail`을 DB의 `staff` 테이블과 매핑하여 `staff_id` 추출.

## 2. 업무 및 프로젝트 분류 로직
*   **업무 성격 구분**: 
    - **프로젝트 업무**: 관련 프로젝트명이 입력되었거나 본문 내 펀드/PFV/자산 키워드 포함 시.
    - **일반 업무**: 프로젝트 연결 고리가 없는 일반 행정 및 기획 업무.
*   **DB 매칭**: `projects`, `funds` 테이블의 명칭/약칭/자산명 필드와 Fuzzy Matching(유사도 검색) 및 고유 ID 연결.
*   **미매칭 항목**: '신규 프로젝트 검토(New Project Review)' 상태로 분류하여 추후 마스터 데이터 업데이트 유도.

## 3. 이해관계자 토큰화 (Stakeholder Tokenization)
*   `외부 관계자` 필드에서 주요 엔티티 추출 및 분류:
    - 수익자/LP, 대주, 시공사, 설계사, 자문사 등.
    - `t5t_log_stakeholders` 테이블에 별도 레코드로 적재하여 분석 용이성 확보.

## 4. 향후 로드맵
*   **Python Pipeline**: CSV 자동 파싱 및 Upsert 스크립트(`process_t5t_csv.py`) 구축.
*   **입력 시스템 개발**: 추후 마스터 데이터를 직접 선택할 수 있는 전용 입력 폼 개발 계획.
