# 구글시트 자동 연동 설정

## 목적

`assignments` 탭만 수정해도 아래 탭이 다시 만들어지도록 하는 설정입니다.

- `people`
- `organizations`
- `sections`

현재 대시보드 자체는 아직 연결하지 않고, 구글시트 내부 동기화만 먼저 구축하는 단계입니다.

## 준비 파일

- [google_sheet_sync.gs](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\google_sheet_sync.gs)

## 설정 방법

1. 구글시트 열기
2. `확장 프로그램 > Apps Script`
3. 기본으로 생성된 `Code.gs` 내용을 전부 삭제
4. [google_sheet_sync.gs](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\google_sheet_sync.gs) 내용을 붙여넣기
5. 저장
6. Apps Script에서 `syncDerivedSheets` 한 번 수동 실행
7. 권한 요청 승인

## 이후 동작

- `assignments` 탭을 수정하면 `onEdit`으로 자동 동기화됩니다.
- 메뉴 `조직DB > 파생 시트 동기화`로 수동 실행도 가능합니다.

## assignments 최소 입력 기준

실무에서는 아래만 주로 수정하면 됩니다.

- `person_name`
- `section_name`
- `group_name`
- `part_name`
- `team_name`
- `role_raw`
- `role_display`

보조 플래그는 필요할 때만 수정합니다.

- `is_counted_in_dashboard`
- `is_shared_role`
- `is_acting_role`
- `is_external_hire`

아래 컬럼은 비워도 됩니다.

- `assignment_id`
- `person_id`
- `group_org_id`
- `part_org_id`
- `team_org_id`
- `raw_name`
- `tags`

상세 규칙은 [assignments_input_rules.md](D:\Project\00. 2025 RA 기획추진\03. 부문 내 업무\00. RA_조직 관련\26년 조직개편(안)\final version\org_dashboard\assignments_input_rules.md) 참고

## 반영되는 규칙

- `assignments`의 `person_name` 기준으로 `people` 생성
- `section_name / group_name / part_name / team_name` 기준으로 `organizations` 생성
- `section_name` 기준으로 `sections` 생성
- `sections`의 총괄자 기본값
  - 투자+펀딩: 윤관식 / 부대표
  - 사업+개발: 이철승 / 부문대표
  - 관리+운영: 정조민 / 부대표

## 조직 신설/확장 시

다음만 `assignments`에 추가하면 됩니다.

- 새 `section_name`
- 새 `group_name`
- 새 `part_name`
- 새 `team_name`
- 새 인원 행

그러면 다음 동기화 때 `organizations`, `people`, `sections`에 자동 반영됩니다.

## 주의

- `role_rules`는 자동생성하지 않고 별도 관리합니다.
- `sections`의 총괄자 이름/직함을 직접 바꿔도 유지됩니다.
- `organizations`와 `people`는 동기화 시 다시 써지므로, 수동 수정은 `assignments` 중심으로 하는 것이 좋습니다.
