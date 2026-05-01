# Staff and Org Key Policy

## 원칙

대시보드 간 연결은 이름 텍스트가 아니라 `staff.staff_id`와 `orgs.org_id`로 한다.

이름은 표시값이다. 동명이인, 개명, 휴직 표기, 겸직 표기 때문에 장기 키로 쓰지 않는다.

현재 단계에서 사람 정보의 origin은 이번에 추가한 `staff` 테이블이다. Google Sheet와 T5T staff master에서 가져온 정보를 `staff`에 모으고, 다른 테이블은 필요할 때 `staff_id`를 참조한다.

## 사람 키 우선순위

1. `employee_no`
   - 사번이 있으면 `staff_id = staff_emp_<사번>` 형식으로 관리한다.
   - 가장 안정적인 내부 키다.
2. `notion_id`
   - T5T/Notion 원천과 연결하는 보조 고유 키다.
3. `email`
   - 회사 메일은 중간 검증 키로 사용한다.
4. `name`
   - 사번/Notion ID가 없는 경우 임시 매칭에만 사용한다.
   - 이름만 있는 신규자는 `staff_name_<hash>`로 임시 생성하고, 이후 사번을 확보하면 병합한다.

## 기존 CRM 연결 방식

`funds.manager`는 기존 표시 텍스트로 보존한다.

정규 연결은 다음 컬럼에 저장한다.

- `funds.manager_staff_id -> staff.staff_id`
- `funds.dept_org_id -> orgs.org_id`
- `fund_assets.managing_org_id -> orgs.org_id`

다만 현재 단계에서 펀드 담당자 연결은 핵심 작업이 아니다. `manager_staff_id`, `dept_org_id`, `managing_org_id`는 나중에 붙일 수 있도록 마련한 연결 자리이며, 대시보드 전환 전에는 기존 `manager`, `dept` 텍스트를 계속 유지한다.

## 신규 입사/추가 인원 처리

1. Google Spreadsheet의 `assignments` 또는 T5T staff master 원천에 사람을 추가한다.
2. `python CRM_base\build_supabase_seed.py`를 실행한다.
3. `python CRM_base\upsert_supabase_seed.py --table staff --table staff_org_assignments --table seats`를 실행한다.
4. 신규자의 사번이 나중에 확인되면 `staff.employee_no`와 필요 시 `staff_id` 병합 여부를 검토한다.

권장 운영은 T5T staff master에 사번/회사메일/Notion ID를 먼저 넣고, 조직/좌석 시트는 표시와 배치 정보를 관리하는 것이다.

## 퇴사/이탈 처리

기존 row를 삭제하지 않는다.

- `staff.status = 'inactive'`
- `staff.leave_date = 실제 퇴사일`
- 좌석에서 빠진 경우 `seats.staff_id = null`, `seats.person_name = ''`
- 조직 배치 이력은 `staff_org_assignments`에 남긴다.

삭제하지 않는 이유는 과거 T5T 로그, 펀드 담당 이력, AUM/조직 분석의 참조 무결성을 유지하기 위해서다.

## 조직 변경/겸직 처리

- 현재 주 소속은 `staff.org_id`
- 겸직/과거/보조 배치는 `staff_org_assignments`에 추가 row로 보존한다.
- Google Sheet에 `(겸)`이 붙은 사람은 `staff_org_assignments.is_dual_role = true`로 들어간다.

## 매칭 후보 생성

기존 CRM 텍스트 필드와 새 기준 테이블의 후보 매칭은 아래 명령으로 만든다.

```powershell
python CRM_base\build_fund_staff_org_mapping.py
```

생성 파일:

- `CRM_base/supabase_seed/fund_manager_staff_candidates.csv`
- `CRM_base/supabase_seed/fund_dept_org_candidates.csv`

담당자 이름 exact match는 자동 반영 가능하지만, 현재 운영 단계에서는 자동 반영하지 않는다. 후보표는 향후 연결고리 작업을 위한 기초 자료로만 둔다.

```powershell
python CRM_base\build_fund_staff_org_mapping.py --apply-exact-manager
```

조직명은 `자산관리2파트4`처럼 CRM 표기가 붙어 있는 경우가 많아 별도 alias 테이블 또는 수동 검토표가 필요하다.

위 `--apply-exact-manager` 옵션은 필요할 때만 쓰는 보조 기능이다. 지금은 실행하지 않는 것이 기본 방침이다.
