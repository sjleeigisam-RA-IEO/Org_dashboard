# CRM Step Plan

## 목적

- `crm dashboard`의 1차 CRM DB를 실무용 구조로 확장한다.
- `수익자/대주` 중심 스냅샷 데이터와 `T5T dashboard` 로그 기반 이해관계자 데이터를 하나의 CRM 체계로 통합한다.
- 향후 `임차인`, `매수/매도인`, `주간사/자문`, `공공/행정기관`, `해외 파트너`, `운영사`, `시공사`까지 무리 없이 확장 가능한 구조를 만든다.

## 현재 상태

- 1차 DB 생성 완료
  - `crm_entity_master_v1.csv`
  - `crm_entity_role_bridge_v1.csv`
  - `crm_entity_alias_v1.csv`
  - `crm_stakeholder_taxonomy_v1.csv`
- `entity`와 `role`을 분리해 복수 역할 허용 구조 확보
- `T5T` 실제 이해관계자 유형 반영 완료
- 아직 실무 CRM 화면에 바로 쓰기에는 alias 정리와 수기 보강 구조가 부족함

## 핵심 과제

1. 같은 주체를 같은 엔티티로 정리
2. 모호한 이름을 실명 법인/기관 기준으로 정제
3. 수기 CRM 정보를 붙일 별도 마스터 설계
4. 대시보드에서 바로 읽을 수 있는 조회용 테이블 생성

## 단계별 계획

### Step 1. Alias 정제 규칙표 만들기

목표:
- `신한`, `공제회`, `매도인`, `비공개`, `잠재 임차인` 같은 모호한 이름을 정리한다.

작업:
- `crm_entity_alias_rules_v1.csv` 초안 생성
- 정리 대상 우선순위 분류
  - 법인 축약명
  - 일반명칭
  - 역할 placeholder
  - 비식별명
- 매핑 방식 정의
  - exact match
  - contains match
  - manual review

산출물:
- alias 규칙표 CSV
- 수동 검토 필요 목록 CSV

완료 기준:
- 상위 빈도 엔티티 기준 최소 50~100건 정리
- `신한`, `KB`, `하나`, `공제회`, `매도인`류 처리 기준 확정

### Step 2. CRM 수기 마스터 설계

목표:
- 로그나 스냅샷만으로 알 수 없는 실무 정보 입력 구조를 만든다.

작업:
- `crm_manual_master_v1.csv` 설계
- 권장 컬럼
  - `entity_id`
  - `official_name`
  - `group_name`
  - `department_or_affiliation`
  - `contact_person`
  - `internal_owner`
  - `importance_level`
  - `relationship_status`
  - `interest_topics`
  - `key_requests`
  - `risk_notes`
  - `next_action`
  - `next_meeting_date`
  - `coverage_note`

산출물:
- 수기 입력용 마스터 CSV 템플릿
- 작성 가이드 Markdown

완료 기준:
- 실무자가 바로 입력 가능한 템플릿 형태 확보
- `entity_id` 기준으로 기존 DB와 연결 가능

### Step 3. 조회용 CRM View 테이블 만들기

목표:
- 대시보드와 모달에서 바로 읽을 수 있는 denormalized view를 만든다.

작업:
- `crm_contact_view_v1.csv` 생성 스크립트 작성
- 포함 항목
  - 기본 식별 정보
  - 대표 역할
  - 연결 프로젝트 수
  - 최근 로그 수
  - 최근 로그 일자
  - 내부 담당자
  - 중요도 / 관계 상태
  - 메모 / 다음 액션

산출물:
- 조회용 통합 CSV
- 생성 스크립트

완료 기준:
- CRM 모달에서 API 없이 바로 붙일 수 있는 수준의 1행 1엔티티 뷰 확보

### Step 4. T5T 로그 연결 고도화

목표:
- 현재 키워드 기반 추출을 엔티티 연결 중심 구조로 개선한다.

작업:
- `t5t-dashboard` 로그의 이해관계자명을 `entity_id`에 연결
- alias 적용 후 로그 재매핑
- 연결 프로젝트, 최근 접점, 최근 작성자, 최근 원문 링크 자동 생성

산출물:
- `crm_log_link_view_v1.csv`
- 엔티티-로그 연결 스크립트

완료 기준:
- 각 엔티티별 최근 로그 3~5건 자동 조회 가능

### Step 5. CRM 모달 데이터 스펙 확정

목표:
- 프론트에서 바로 쓸 수 있는 JSON/CSV 스펙을 고정한다.

작업:
- 모달 필드 확정
  - `title`
  - `type_badge`
  - `organization`
  - `summary`
  - `owner`
  - `importance`
  - `relationship_status`
  - `project_list`
  - `recent_logs`
  - `notes`
  - `next_action`
- placeholder 허용 범위 정의

산출물:
- `crm_modal_spec_v1.md`
- 샘플 JSON

완료 기준:
- 프론트 구현 전에 데이터 계약이 고정됨

### Step 6. 대시보드 연동

목표:
- `t5t-dashboard` CRM 모달을 placeholder에서 실제 데이터 기반으로 교체한다.

작업:
- `crm_contact_view_v1`와 `crm_log_link_view_v1`를 읽는 로직 추가
- 엔티티명 클릭 시 alias 포함 조회
- 데이터 없을 때 fallback 문구 처리

산출물:
- 프론트 연동 코드
- 테스트용 샘플 데이터

완료 기준:
- 상위 이해관계자 클릭 시 실제 CRM 카드 표시

## 우선순위

1. Step 1 `Alias 정제 규칙표`
2. Step 2 `CRM 수기 마스터`
3. Step 3 `조회용 CRM View`
4. Step 4 `T5T 로그 연결`
5. Step 5 `모달 스펙 확정`
6. Step 6 `대시보드 연동`

## 의사결정 원칙

- `entity_id`는 한 번 부여하면 유지한다.
- 원본 스냅샷 데이터는 직접 수정하지 않고, 정제 규칙과 파생 테이블로 해결한다.
- `T5T`의 현재 분류명은 유지하되 내부 CRM taxonomy와 분리 관리한다.
- 모호한 이름은 억지 자동 병합보다 `manual review`를 우선한다.
- 대시보드용 테이블과 입력용 마스터는 분리한다.

## 바로 다음 추천 작업

- Step 1부터 시작
- 구체적으로는 `상위 빈도 모호 엔티티 목록`을 뽑고 `crm_entity_alias_rules_v1.csv`를 생성
- 그 다음 `crm_manual_master_v1.csv` 템플릿을 만든다.
