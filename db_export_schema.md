# 조직 대시보드 DB 구조 제안

정적 대시보드를 DB/CSV/구글시트 기반으로 전환하려면 아래 5개 테이블 구조가 가장 안정적입니다.

## 1. `sections`

- 목적: 상위 부 단위 관리
- 주요 컬럼:
  - `section_id`
  - `section_name`
  - `section_lead_name`
  - `section_lead_title`
  - `display_order`

## 2. `organizations`

- 목적: 조직 트리 저장
- 레벨:
  - `group`
  - `center`
  - `tf`
  - `part`
  - `team`
- 주요 컬럼:
  - `org_id`
  - `org_name`
  - `org_level`
  - `section_id`
  - `parent_org_id`
  - `org_code`
  - `display_order`
  - `notes`

## 3. `people`

- 목적: 사람 마스터
- 주요 컬럼:
  - `person_id`
  - `person_name`
  - `raw_name_example`
  - `is_external_hire`

## 4. `assignments`

- 목적: 사람-조직 배치 이력 저장
- 핵심 테이블
- 주요 컬럼:
  - `assignment_id`
  - `person_id`
  - `section_name`
  - `group_name`
  - `part_name`
  - `team_name`
  - `group_org_id`
  - `part_org_id`
  - `team_org_id`
  - `role_raw`
  - `role_display`
  - `is_counted_in_dashboard`
  - `is_shared_role`
  - `is_acting_role`
  - `is_external_hire`
  - `raw_name`
  - `tags`

## 5. `role_rules`

- 목적: 화면/통계 예외 규칙 저장
- 예:
  - 외부영입 제외
  - SS&C TF 비카운트 명단
  - 개발PFV TF 직책 보정

## 구글시트 권장 시트 구성

- `sections`
- `organizations`
- `people`
- `assignments`
- `role_rules`

이 구조면 대시보드에서는 사실상 `assignments`를 중심으로 읽고,
조직 트리는 `organizations`,
표시 예외는 `role_rules`를 붙이면 됩니다.

## 파일 생성

아래 스크립트로 CSV를 다시 만들 수 있습니다.

```powershell
cd "D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard"
python .\export_db_csv.py
```

생성 위치:

- `db_export/sections.csv`
- `db_export/organizations.csv`
- `db_export/people.csv`
- `db_export/assignments.csv`
- `db_export/role_rules.csv`
