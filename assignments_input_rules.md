# assignments 입력 규칙 단순화

## 결론

실제로 자주 수정할 컬럼은 아래 7개만 보면 됩니다.

- `person_name`
- `section_name`
- `group_name`
- `part_name`
- `team_name`
- `role_raw`
- `role_display`

그리고 필요할 때만 아래 4개를 추가로 만지면 됩니다.

- `is_counted_in_dashboard`
- `is_shared_role`
- `is_acting_role`
- `is_external_hire`

## 필수 입력 컬럼

### 1. `person_name`

- 사람 이름

### 2. `section_name`

- 예: `투자+펀딩`, `사업+개발`, `관리+운영`, `부분직속`, `TFs`

### 3. `group_name`

- 그룹/센터/TF 이름
- 예: `투자1그룹`, `론파이낸스센터(LFC)`, `SS&C TF`

### 4. `part_name`

- 파트명
- 파트가 없으면 비워도 됨

### 5. `team_name`

- 세부조직명
- 비우면 자동으로 `part_name`, 그것도 없으면 `group_name`으로 처리

### 6. `role_raw`

- 원래 직책
- 예: `그룹장`, `파트장/센터장`, `담당디렉터`, `시니어매니저`, `매니저`

### 7. `role_display`

- 화면 표시용 직책
- 비우면 자동으로 `role_raw`와 같게 처리

## 필요할 때만 수정하는 컬럼

### `is_counted_in_dashboard`

- 기본값: `Y`
- 통계에서 제외하려면 `N`

### `is_shared_role`

- 겸직이면 `Y`
- 아니면 비우거나 `N`

### `is_acting_role`

- 대행이면 `Y`
- 아니면 비우거나 `N`

### `is_external_hire`

- 외부영입이면 `Y`
- 아니면 비우거나 `N`

## 건드리지 않아도 되는 컬럼

아래는 비워도 스크립트가 돌아가도록 설계했습니다.

- `assignment_id`
- `person_id`
- `group_org_id`
- `part_org_id`
- `team_org_id`
- `raw_name`
- `tags`

## 실무 입력 예시

### 1. 사람 이동

- 기존 행의
  - `group_name`
  - `part_name`
  - `team_name`
  만 수정

### 2. 조직 신설

- 새 행 추가
- `section_name`, `group_name`, `part_name`, `team_name`, `person_name`, `role_raw` 입력
- 동기화하면 `organizations`, `people`, `sections`에 자동 반영

### 3. 겸직 처리

- `is_shared_role = Y`

### 4. 대행 처리

- `is_acting_role = Y`

### 5. 통계 제외

- `is_counted_in_dashboard = N`

## 가장 쉬운 운영 방식

평소에는 아래만 수정하면 됩니다.

- `person_name`
- `group_name`
- `part_name`
- `team_name`
- `role_raw`

나머지는 필요할 때만 추가 수정하면 됩니다.
