# 구글시트 작성 방법

## 생성 파일

- `org_dashboard_google_sheet_template.xlsx`

이 파일을 구글 드라이브에 업로드하면, 한 개의 구글시트 파일 안에서 여러 탭으로 운영할 수 있습니다.

## 탭 구성

- `guide`
- `sections`
- `organizations`
- `people`
- `assignments`
- `role_rules`

## 실제 운영 시 수정 우선순위

### 1. `assignments`

가장 자주 수정할 탭입니다.

- 인사 이동
- 직책 변경
- 겸직 여부
- 대행 여부
- 대시보드 포함 여부

핵심 컬럼:

- `person_name`
- `section_name`
- `group_name`
- `part_name`
- `team_name`
- `role_raw`
- `role_display`
- `is_counted_in_dashboard`
- `is_shared_role`
- `is_acting_role`

### 2. `organizations`

조직 구조가 바뀔 때 수정합니다.

- 그룹 추가/삭제
- 센터명 변경
- 파트명 변경
- 조직 코드 관리

### 3. `sections`

상위 부 단위 총괄자 표기 수정용입니다.

- `section_lead_name`
- `section_lead_title`

### 4. `role_rules`

대시보드 예외 규칙 관리용입니다.

- SS&C TF 비카운트 인원
- 표시 직책 보정
- 예외 집계 규칙

## 업로드 방법

1. 구글 드라이브 접속
2. `새로 만들기`
3. `파일 업로드`
4. `org_dashboard_google_sheet_template.xlsx` 선택
5. 업로드 완료 후 구글시트로 열기

## 운영 팁

- `assignments`는 필터를 켜고 사용하면 편합니다.
- ID 컬럼(`section_id`, `org_id`, `person_id`, `assignment_id`)은 가능하면 유지하는 것이 좋습니다.
- 이름 변경보다 `행 유지 + 값 수정` 방식이 대시보드 연결 시 안정적입니다.

## 다음 연결 방향

운영이 괜찮으면 다음 단계로:

1. 구글시트 -> Apps Script JSON API 생성
2. 대시보드가 해당 JSON을 읽도록 변경
3. 시트 수정 후 새로고침 시 반영
