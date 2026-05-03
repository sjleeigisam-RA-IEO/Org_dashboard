# IOTA Seoul Pilot 인증 및 권한 설계 계획

## 1. 목적

IOTA Seoul 파일럿 대시보드와 입력폼의 접속자를 개인 단위로 식별하고, 해당 사용자의 역할과 조직에 따라 입력 데이터의 저장 위치와 대시보드 공개 범위를 조절한다.

초기 목표는 복잡한 사내 SSO 연동이 아니라, 파일럿 참여자 명단을 기준으로 다음을 가능하게 하는 것이다.

- 접속자가 누구인지 확인
- 이슈 입력 시 작성자, 조직, 워크스페이스 자동 지정
- 대시보드에서 역할과 워크스페이스에 따라 정보 공개 수준 조절
- 향후 운영 단계에서 Supabase Auth/RLS 또는 회사 인증 체계로 확장 가능하게 설계

## 2. 기본 방향

파일럿 시작 단계에서는 `iota_seoul_pilot_members` 테이블을 기준 테이블로 둔다.

단, 이미 DB에 임직원 마스터 테이블이 있고 직원 ID, 이름, 조직, 이메일을 안정적으로 관리하고 있다면, `iota_seoul_pilot_members`는 전체 임직원 테이블을 대체하지 않고 파일럿 참여자/권한만 관리하는 보조 테이블로 사용한다.

권장 구조는 다음과 같다.

```text
임직원 마스터
→ 전체 직원의 기본 정보 관리
→ staff_id, name, org_name, email

iota_seoul_pilot_members
→ 파일럿 사용 대상자와 권한 관리
→ staff_id, role, workspace_code, is_active
```

## 3. 로그인 방식

### 3.1 사용자 입력값

사용자는 로그인 화면에서 이름과 이메일을 입력한다.

```text
이름
회사 이메일
```

이름은 직원 DB 매칭용으로 사용하고, 이메일은 실제 본인 확인 수단으로 사용한다. 내부 식별 기준은 이름이 아니라 `staff_id`로 한다.

```text
화면 입력값: 이름 + 이메일
내부 식별값: staff_id
표시값: 이름 / 조직명 / 역할
저장값: staff_id / workspace_code / role
```

### 3.2 Magic Link 인증

파일럿에서는 Magic Link 방식을 권장한다.

흐름은 다음과 같다.

```text
1. 사용자가 이름과 이메일 입력
2. DB에서 파일럿 멤버 여부 확인
3. 이름과 이메일이 일치하고 active 상태이면 Magic Link 발송
4. 사용자가 이메일 링크 클릭
5. 로그인 세션 생성
6. 이후 30일 동안 재인증 없이 사용
7. 접속할 때마다 멤버 테이블을 다시 조회해 최신 권한 반영
```

Magic Link는 별도 서비스가 아니라 Supabase Auth의 비밀번호 없는 로그인 기능으로 구현할 수 있다. 파일럿에서는 Supabase 기본 이메일 발송을 사용하고, 운영 단계에서는 회사 SMTP 또는 회사 도메인 발신자로 전환한다.

### 3.3 세션 유지

파일럿에서는 30일 세션 유지를 기본안으로 한다.

```text
로그인 인증: 최초 1회 또는 세션 만료 시
권한 확인: 접속할 때마다 DB 재조회
```

따라서 사용자는 자주 이메일 인증을 반복하지 않아도 되고, 관리자는 멤버 테이블에서 권한이나 활성 상태를 바꾸면 다음 접속부터 반영할 수 있다.

## 4. 파일럿 멤버 테이블

테이블명은 SQL 관례상 공백 없이 `iota_seoul_pilot_members`를 사용한다.

예상 컬럼은 다음과 같다.

```sql
iota_seoul_pilot_members
- member_id
- staff_id
- staff_name
- email
- org_name
- workspace_code
- role_code
- allowed_project_ids
- is_active
- invited_at
- last_login_at
- created_at
- updated_at
```

컬럼 의미는 다음과 같다.

| 컬럼 | 의미 |
| --- | --- |
| `staff_id` | 회사 임직원 DB의 고유 직원 ID |
| `staff_name` | 표시용 이름 |
| `email` | Magic Link 발송 및 본인 확인용 이메일 |
| `org_name` | 조직명 |
| `workspace_code` | 자동 적재될 워크스페이스 |
| `role_code` | 파일럿 권한 역할 |
| `allowed_project_ids` | 접근 가능한 프로젝트 목록 |
| `is_active` | 파일럿 사용 가능 여부 |

기존 임직원 마스터 테이블이 있다면 `staff_name`, `email`, `org_name`은 중복 저장하지 않고 조인으로 가져오는 방식도 가능하다. 다만 파일럿 속도를 위해 초기에는 스냅샷 형태로 중복 저장해도 된다.

## 5. 권한 체계

권한은 초기에는 3단계로 단순화한다.

```text
Master
Director
Manager
```

권한은 `role_code` 컬럼으로 관리한다.

```text
master
director
manager
```

### 5.1 역할별 기본 권한

| 역할 | 설명 | 기본 공개 범위 |
| --- | --- | --- |
| Master | 관리자/운영자 | 전체 프로젝트, 전체 워크스페이스 조회 및 관리 |
| Director | 의사결정자/리드 | 담당 프로젝트 및 관련 워크스페이스의 주요 이슈 조회 |
| Manager | 실무 담당자 | 본인 조직/워크스페이스 및 허용된 프로젝트 중심 조회/입력 |

### 5.2 역할 + 워크스페이스 조합

실제 공개 범위는 역할만으로 결정하지 않고, 역할과 워크스페이스를 함께 본다.

예시는 다음과 같다.

```text
Master + WS_PM
→ 전체 프로젝트/전체 워크스페이스 조회 가능

Director + WS_FIN
→ 금융/투자구조 관련 주요 이슈와 담당 프로젝트 조회

Manager + WS_CON
→ 개발관리 워크스페이스의 담당 프로젝트 이슈 입력/조회
```

따라서 권한 판단 기준은 다음 조합으로 설계한다.

```text
role_code
+ workspace_code
+ allowed_project_ids
+ data_visibility_level
```

## 6. 데이터 공개 레벨

입력되는 이슈/업무 로그에는 공개 레벨을 부여한다.

초기 공개 레벨은 다음 3단계로 둔다.

```text
team
director
master
```

의미는 다음과 같다.

| 공개 레벨 | 조회 가능 대상 |
| --- | --- |
| `team` | 같은 워크스페이스 또는 담당 프로젝트의 Manager 이상 |
| `director` | Director 이상 또는 지정된 프로젝트 리드 |
| `master` | Master만 |

예를 들어 Manager가 개발관리 워크스페이스에서 입력한 일반 진행사항은 `team`, 민감한 의사결정 이슈는 `director`, 대외비성 구조/리스크 이슈는 `master`로 저장할 수 있다.

## 7. 입력폼 동작 방식

로그인 후 입력폼은 다음과 같이 동작한다.

```text
1. 로그인 세션 확인
2. iota_seoul_pilot_members에서 사용자 프로필 조회
3. 작성자 이름/직원 ID 자동 세팅
4. 조직명 기준 workspace_code 자동 세팅
5. 접근 가능한 프로젝트만 선택지에 표시
6. 입력 내용 저장 시 role_code, workspace_code, staff_id 함께 저장
```

입력 데이터에는 최소한 다음 값이 함께 저장되어야 한다.

```text
writer_staff_id
writer_name
writer_org_name
workspace_code
role_code
visibility_level
created_by_member_id
```

이렇게 하면 대시보드에서 별도 수작업 없이 “누가, 어느 조직 관점에서, 어느 공개 수준으로 입력했는지”를 해석할 수 있다.

## 8. 대시보드 표시 방식

대시보드는 접속자의 멤버 프로필을 기준으로 조회 범위를 조절한다.

기본 로직은 다음과 같다.

```text
1. 접속자의 role_code 확인
2. 접속자의 workspace_code 확인
3. allowed_project_ids 확인
4. 각 이슈의 visibility_level 확인
5. 조회 가능한 항목만 표시
```

대시보드에서는 같은 DB를 보더라도 사용자에 따라 표시되는 정보가 달라질 수 있다.

예:

```text
Master
→ 전체 현황, 전체 원문, 전체 리스크 확인

Director
→ 담당 프로젝트의 주요 이슈, 의사결정 필요사항, 리스크 요약 확인

Manager
→ 본인 워크스페이스의 입력/협업 항목과 담당 프로젝트 이슈 확인
```

## 9. 구현 단계

### Step 1. 파일럿 멤버 리스트 정리

팀에서 먼저 파일럿 사용 대상자를 확정한다.

필요 정보:

```text
이름
이메일
조직명
직원 ID
파일럿 역할: Master / Director / Manager
담당 워크스페이스
담당 프로젝트
활성 여부
```

### Step 2. 기존 테이블 확인

Supabase DB에 임직원 마스터 또는 조직 마스터 성격의 테이블이 있는지 확인한다.

확인 대상:

```text
직원 ID
이름
이메일
조직명
직책/역할
재직 상태
```

기존 테이블이 충분하면 `iota_seoul_pilot_members`는 파일럿 권한만 관리한다. 기존 테이블이 부족하면 파일럿 멤버 테이블에 필요한 정보를 직접 저장한다.

### Step 3. 멤버 테이블 생성

`iota_seoul_pilot_members`를 생성하고 파일럿 대상자를 등록한다.

### Step 4. Magic Link 로그인 연결

이름과 이메일을 입력받아 멤버 테이블과 매칭한 후, 일치하는 사용자에게 Magic Link를 발송한다.

### Step 5. 입력폼 자동 적재 적용

로그인 사용자 기준으로 작성자, 조직, 워크스페이스, 역할을 자동 저장한다.

### Step 6. 대시보드 권한 표시 적용

역할, 워크스페이스, 프로젝트, 공개 레벨에 따라 조회 범위를 제한한다.

## 10. 리스크와 유의사항

### 이름 + 이메일만으로는 보안 인증이 약함

이름과 이메일은 비밀값이 아니므로, 이것만으로 로그인시키면 타인 사칭 가능성이 있다. 따라서 이메일 소유 확인을 위해 Magic Link를 함께 사용한다.

### 이름은 고유 ID가 아님

동명이인, 영문/한글 표기 차이, 조직 변경 문제가 있을 수 있다. 내부 저장과 권한 판단은 반드시 `staff_id` 기준으로 한다.

### 조직 변경 대응 필요

사용자가 조직 이동을 하면 `workspace_code`가 바뀔 수 있다. 따라서 로그인 세션은 30일 유지하더라도, 접속 시마다 멤버 테이블을 다시 조회한다.

### 운영 전환 시 DB 레벨 권한 필요

파일럿 초기는 프론트엔드 필터링으로 빠르게 검증할 수 있다. 다만 민감정보가 포함될 경우 최종적으로는 Supabase Row Level Security를 적용해 DB 단계에서 조회 권한을 제한해야 한다.

## 11. 현재 결론

파일럿 시작안은 다음과 같다.

```text
멤버 테이블: iota_seoul_pilot_members
로그인 방식: 이름 + 이메일 입력 후 Magic Link 인증
세션 유지: 30일
권한 단계: Master / Director / Manager
권한 기준: 역할 + 조직/워크스페이스 + 담당 프로젝트
입력 적재: 로그인 사용자 프로필 기준으로 자동 저장
대시보드 표시: 사전 정의된 공개 로직으로 사용자별 차등 표시
```

이 방식은 파일럿 단계에서 구현 부담이 낮고, 이후 운영 단계에서 회사 인증 체계 또는 Supabase RLS로 확장하기 쉽다.
