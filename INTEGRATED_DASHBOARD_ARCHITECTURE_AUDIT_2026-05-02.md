# 통합 RA Dashboard 구조 점검 메모

작성일: 2026-05-02  
목적: 폴더 통합, Git 통합, Supabase 전환, 파일럿 워크플랫폼 연결 작업의 현재 관계를 정리하고 꼬임 지점을 선제적으로 식별한다.

## 1. 현재 목표 구조

최종 목표는 여러 폴더에 나뉜 화면을 하나의 RA Dashboard 제품으로 묶는 것이다.

- 루트 `index.html`: 통합 포털
- 기본 조회 화면: 펀드, 자산, AUM, 익스포저 조회
- T5T 화면: 기존 Notion DB/JSON 기반 업무 로그를 SQL DB 기반으로 전환
- 조직 화면: 조직/좌석/인원 구조 조회
- 파일럿 워크플랫폼: IOTA Seoul 일부 업무 페이지를 같은 DB에 연결해 검증

핵심 원칙은 “폴더는 기능별로 구분하되, 키와 DB는 공유하는 하나의 대시보드”이다. 따라서 파일럿도 별도 DB를 파는 것이 아니라 같은 Supabase 안에서 `project_id`, `source_system`, 필요 시 별도 prefix로 격리해 검증하는 방향이 맞다.

## 2. 폴더별 역할

| 폴더/파일 | 현재 역할 | 운영 기준 |
|---|---|---|
| `index.html` | 통합 포털. 조직, T5T, 기업마케팅센터, IGIS RA Insight 링크 제공 | 유지. 이후 단일 앱 shell로 발전 |
| `org_dashboard/` | 조직/좌석 대시보드. 현재 Google Sheet/WebApp 및 로컬 JSON 기반 | 당분간 기존 운영 유지. DB seed는 이관 준비 |
| `CRM_base/portfolio-analysis/` | 펀드, 자산, AUM, 익스포저 분석 화면 | 핵심 자산 조회 화면 후보 |
| `t5t-dashboard/` | T5T 업무 대시보드. 현재 Supabase v2 실험 화면으로 전환 중 | SQL 전환 검증 후 정식 화면화 |
| `pilot_form/` | IOTA Seoul 파일럿 워크플랫폼 UI | 같은 DB를 쓰는 파일럿. 스키마 정리 필요 |
| `CRM_base/migrations/` | Supabase migration SQL | 실제 DB 기준과 대조 관리 필요 |
| `CRM_base/supabase_seed/` | org/staff/seat/AUM/T5T seed 산출물 | 재현 가능한 이관 산출물 |
| `crm dashboard/` | 과거 CRM 원천/가공 산출물 | archive 후보. 현재 통합 앱의 운영 진입점은 아님 |
| `automation_runtime/` | 기존 Notion/T5T 자동화 런타임 | SQL 전환 이후 역할 재정의 필요 |

## 3. 실제 Supabase 적용 상태

루트 `.env` 기준으로 실제 DB를 조회한 결과:

| Table | Rows | 판단 |
|---|---:|---|
| `funds` | 1,099 | 기존 CRM/자산 조회 핵심 운영 테이블 |
| `fund_assets` | 903 | 기존 CRM/자산 조회 핵심 운영 테이블 |
| `lender_exposures` | 579 | counterparty FK 추가됨 |
| `beneficiary_exposures` | 1,090 | counterparty FK 추가됨 |
| `orgs` | 102 | 조직 DB seed 적용됨 |
| `staff` | 323 | 공통 staff master 적용됨 |
| `staff_org_assignments` | 305 | 조직 배치 seed 적용됨 |
| `seats` | 419 | 좌석 seed 적용됨 |
| `seat_layout_shapes` | 112 | 좌석 도형 seed 적용됨 |
| `aum_snapshots` | 1,162 | AUM 시계열 seed 적용됨 |
| `fund_lifecycle` | 778 | 펀드 lifecycle seed 적용됨 |
| `projects` | 623 | IOTA pilot 4건 + Notion project seed 619건 |
| `project_staff_links` | 1,942 | Notion project-staff link seed 적용됨 |
| `t5t_logs` | 0 | 최종 정규화 로그 테이블은 아직 비어 있음 |
| `t5t_log_project_links` | 0 | 아직 비어 있음 |
| `t5t_log_stakeholders` | 0 | 아직 비어 있음 |
| `t5t_input_drafts` | 0 | future input staging |
| `t5t_form_submissions` | 599 | raw T5T 제출 원천 적재됨 |
| `t5t_form_items` | 2,967 | raw T5T item 적재 및 분석 필드 일부 추가됨 |
| `counterparties` | 563 | 거래상대방 통합 master 적용됨 |
| `iota_seoul_master_data` | 102 | 파일럿 public table에 데이터 있음 |
| `iota_seoul_logs` | 0 | 파일럿 입력 로그 대기 |
| `iota_seoul_log_links` | 0 | 파일럿 입력 로그 대기 |
| `iota_seoul_log_stakeholders` | 0 | 파일럿 입력 로그 대기 |

현재 T5T는 “최종 정규화 테이블(`t5t_logs`) 운영” 단계가 아니라, `t5t_form_submissions`와 `t5t_form_items`를 중심으로 SQL 전환 테스트를 하는 단계다.

## 4. 데이터 흐름 정리

### 4.1 자산/AUM/CRM 조회

현재 흐름:

1. Excel/CRM 원천
2. `CRM_base/replace_supabase_*.py`
3. Supabase `funds`, `fund_assets`, `lender_exposures`, `beneficiary_exposures`
4. `CRM_base/portfolio-analysis/`

추가된 연결 자리:

- `funds.manager_staff_id -> staff.staff_id`
- `funds.dept_org_id -> orgs.org_id`
- `fund_assets.managing_org_id -> orgs.org_id`
- `lender_exposures.counterparty_id -> counterparties.counterparty_id`
- `beneficiary_exposures.counterparty_id -> counterparties.counterparty_id`

권장: 기존 텍스트 필드(`manager`, `dept`, `lender_clean`, `beneficiary_clean`)는 당분간 유지하고, FK는 분석 확장용으로 단계적으로 채운다.

### 4.2 조직/좌석

현재 흐름:

1. Google Sheet/WebApp 및 로컬 layout JSON
2. `org_dashboard/` 화면
3. `CRM_base/build_supabase_seed.py`
4. Supabase `orgs`, `staff`, `staff_org_assignments`, `seats`, `seat_layout_shapes`

권장: 화면은 당분간 기존 Google Sheet 기반으로 유지한다. 다만 통합 대시보드로 전환할 때는 `staff`와 `orgs`를 공통 identity layer로 사용한다.

### 4.3 T5T

현재 흐름:

1. Tally/CSV 또는 Notion raw source
2. `CRM_base/process_t5t_csv.py` 또는 `CRM_base/sync_notion_raw_to_sql.py`
3. Supabase `t5t_form_submissions`, `t5t_form_items`
4. `t5t-dashboard/t5t-service-v2.js`
5. `t5t-dashboard/app-v2.js`

현재 화면이 참조하는 핵심 테이블:

- `t5t_form_items`
- `projects`
- `staff`
- `funds`
- `counterparties`
- `lender_exposures`
- `beneficiary_exposures`

최종 목표 흐름:

1. raw source는 `t5t_form_submissions`, `t5t_form_items`에 보존
2. 정제/검증 후 `t5t_logs`, `t5t_log_project_links`, `t5t_log_stakeholders`로 승격
3. 화면은 최종적으로 `t5t_logs` 계열을 기본 조회하고, raw item은 drill-down 또는 검증용으로 사용

### 4.4 IOTA Seoul 파일럿

현재 `pilot_form/` 웹은 아래 public table을 사용한다.

- `iota_seoul_logs`
- `iota_seoul_log_links`
- `iota_seoul_log_stakeholders`
- `iota_seoul_master_data`

반면 migration 파일 `2026-05-01_iota_seoul_schema.sql`은 별도 schema인 `iota_seoul.projects`, `iota_seoul.workspaces`, `iota_seoul.master_data`를 만든다.

실제 Supabase REST 노출 schema는 `public`, `graphql_public`뿐이다. 따라서 브라우저에서 별도 `iota_seoul` schema를 직접 접근하는 구조는 현재 동작하지 않는다.

권장 방향:

- 파일럿 웹은 계속 `public` table을 사용한다.
- 별도 schema SQL은 archive 또는 재설계 대상으로 둔다.
- 파일럿 project는 `public.projects`에 `project_id = iota-*`, `source_system = pilot_setup`로 관리한다.
- 파일럿 로그도 장기적으로는 `t5t_logs`/`t5t_log_project_links`와 합칠지, `pilot_work_logs` 성격으로 분리할지 결정한다.

## 5. 꼬임/리스크 포인트

### P0. 비밀/키 파일 관리

Git 추적 대상에 아래 파일이 있다.

- `t5t-dashboard/supabase-config.js`
- `t5t-dashboard/tally api key.txt`
- `CRM_base/_archive/supabase sql pw.txt`

`supabase-config.js`의 publishable key는 브라우저용일 수 있으나, `tally api key.txt`와 `supabase sql pw.txt`는 즉시 git 추적 제외 또는 삭제/회전 검토가 필요하다.

### P0. 브라우저에서 `.env` fetch

아래 파일들이 루트 `.env`를 브라우저에서 읽는 구조다.

- `CRM_base/portfolio-analysis/index.html`
- `pilot_form/dashboard.html`
- `pilot_form/workform.html`

로컬 테스트에는 편하지만 정적 배포에서는 `.env` 노출 또는 fetch 실패 문제가 생긴다.

권장:

- 로컬 전용: `dashboard.config.local.js` 또는 `supabase-config.local.js`
- 배포용: 공개 가능한 anon key만 포함한 `public-config.js`
- service role, DB password, Tally API key는 절대 브라우저 파일에 두지 않는다.

### P1. T5T `index.html` HTML 중복 - 정리 완료

`t5t-dashboard/index.html`에 `<!DOCTYPE html>`, `<html>`, `<head>`가 중복 삽입되어 있다. 브라우저가 보정할 수는 있으나 구조적으로 위험하다.

조치: 중복 선언을 제거해 단일 HTML document 구조로 정리했다.

### P1. `iota_seoul` schema와 `public.iota_seoul_*` 테이블이 병렬 존재 - 정리 완료

파일럿 관련 SQL과 실제 웹이 서로 다른 모델을 가리킨다.

- SQL: `iota_seoul.projects`, `iota_seoul.master_data`
- 웹: `public.iota_seoul_logs`, `public.iota_seoul_master_data`

권장: 지금 단계에서는 public table 기준으로 통일하고, 별도 schema SQL은 사용 중지 표시한다.

조치: `2026-05-01_iota_seoul_schema.sql`을 `public.iota_seoul_*` 기준으로 재작성했다. 파일럿 프로젝트는 `public.projects`의 `iota-*` ID로 관리한다.

### P1. 프로젝트 master가 아직 pilot 4건 중심 - 정리 완료

실제 DB `projects`는 4건뿐이다. 하지만 seed 파일 기준으로는 Notion cache에서 619건 프로젝트를 생성할 수 있다. 즉 migration 문서와 실제 DB 상태가 다르다.

권장:

- 파일럿만 테스트할 때는 4건 유지 가능
- T5T 전체 SQL 전환 테스트에는 `projects` 619건 seed 적용 필요
- 적용 전에는 현재 pilot project 4건과 Notion project 619건의 `project_id` 충돌 여부를 확인한다.

조치: pilot `iota-*` ID와 Notion `project_notion_*` ID 충돌이 없음을 확인하고, `projects` 619건과 `project_staff_links` 1,942건을 upsert했다. 실제 DB는 `projects` 623건 상태다.

### P1. `CRM_base/.env` 기준을 기대하는 스크립트가 남아 있음 - 정리 완료

루트 `.env` 통합을 했지만 일부 스크립트는 `CRM_base/.env`를 읽는다.

- `CRM_base/setup_pilot_projects.py`
- `CRM_base/backfill_pilot_from_csv.py`
- `CRM_base/upsert_supabase_seed.py`

권장: 모든 Python 스크립트는 루트 `.env`를 우선 읽고, `CRM_base/.env`는 fallback으로만 둔다.

조치: `CRM_base/env_utils.py`를 추가하고 주요 로컬/DB 파이프라인 스크립트가 루트 `.env`를 우선 읽도록 정리했다. 브라우저에서 `.env`를 fetch하는 P0 항목은 이번 범위에서 건드리지 않았다.

### P2. T5T raw item과 normalized log의 역할이 아직 혼재

현재 `t5t_form_items`에 `classification_summary`, `classification_tokens`, `task_type`, `stakeholder_ids`, `matched_fund_id`가 추가되었다. 이 구조는 빠른 화면 구현에는 좋지만, 장기적으로 raw table과 분석 table의 경계가 흐려진다.

권장:

- raw 보존: `t5t_form_submissions`, `t5t_form_items`
- 분석/조회: `t5t_logs`, `t5t_log_project_links`, `t5t_log_stakeholders`
- 화면 v2는 임시로 raw table을 보되, v3에서 normalized table로 이동

## 6. 권장 DB 기준선

통합 대시보드의 공통 master는 아래 순서로 본다.

1. `staff`: 사람 master
2. `orgs`: 조직 master
3. `funds`: 펀드 master
4. `fund_assets`: 자산 master/detail
5. `projects`: 업무/개발/파일럿 프로젝트 master
6. `counterparties`: 거래상대방/이해관계자 master

업무 로그 계열은 아래처럼 구분한다.

| 목적 | 테이블 |
|---|---|
| T5T raw 제출 | `t5t_form_submissions` |
| T5T raw item | `t5t_form_items` |
| T5T 정규화 로그 | `t5t_logs` |
| 로그-프로젝트 연결 | `t5t_log_project_links` |
| 로그-이해관계자 연결 | `t5t_log_stakeholders` |
| 파일럿 임시 로그 | 현재 `iota_seoul_logs`, 장기적으로 통합 여부 결정 |

## 7. 다음 작업 순서

1. 키/비밀 파일 정리
   - `tally api key.txt`, `supabase sql pw.txt` git 추적 제거 및 키 회전 검토
   - 브라우저 `.env` fetch 제거

2. T5T HTML 구조 수정
   - `t5t-dashboard/index.html` 중복 doctype/head 제거
   - smoke test로 화면 로드 확인

3. 파일럿 DB 모델 기준 확정
   - `public.iota_seoul_*` 기준으로 갈지
   - 또는 `t5t_logs/projects` 통합 모델로 흡수할지 결정
   - 별도 `iota_seoul` schema SQL은 현재 REST 미노출이므로 운영 기준에서 제외

4. T5T SQL 전환 단계 정리
   - `t5t_form_items` 기반 v2 화면 유지
   - `projects` 619건 seed 적용 여부 결정
   - `t5t_logs` 승격 파이프라인 작성

5. 통합 포털을 “카드 링크 모음”에서 “공통 앱 shell”로 발전
   - 공통 config loader
   - 공통 Supabase client
   - 공통 navigation
   - 각 dashboard는 route/module로 분리

## 8. 결론

현재 구조는 방향이 맞다. Git 통합과 DB 기반 전환의 뼈대는 이미 잡혀 있다.

다만 지금은 “통합 전환 중간층”이라 다음이 섞여 있다.

- 운영 화면
- migration seed
- 파일럿 실험
- 과거 원천/아카이브
- 브라우저용 임시 config

바로 손볼 핵심은 코드 대개편이 아니라 기준선 확정이다. 특히 `public` DB를 통합 기준으로 삼고, 파일럿은 같은 DB 안의 `project/source_system` 기반 실험으로 관리하는 것이 지금 목표와 가장 잘 맞는다.

## 9. Git 추적 제외 정리 기준

2026-05-02 기준으로 아래 파일군은 통합 대시보드의 운영 기준선에서 제외하고 로컬 보관 대상으로 돌렸다. 삭제가 아니라 Git 추적 제외이며, 필요하면 로컬에서 다시 참고할 수 있다.

| 제외 파일군 | 이유 |
|---|---|
| `CRM_base/scratch/` | 1회성 진단, 보정, 검증, 패치 스크립트 묶음 |
| `scratch/` | 루트 단위 임시 점검 파일 |
| `CRM_base/_archive/` | 과거 자료, 캐시, 민감 백업, 외부 가이드 등 운영 기준 외 파일 |
| `crm dashboard/` | 통합 전 구형 CRM workspace. 현재 운영 진입점은 `CRM_base/portfolio-analysis/` |
| `automation_runtime/logs/`, `automation_runtime/state/` | 실행 로그와 상태값. 코드가 아니라 런타임 산출물 |
| `t5t-dashboard/*.log`, `t5t-dashboard/test_*.json`, `t5t-dashboard/scratch_*.txt`, `t5t-dashboard/debug_ids.py` | 로컬 디버그 산출물 |
| `t5t-dashboard/tally api key.txt` | 민감 키 파일. Git 추적 대상에서 제외 |
| 루트 `notion_agent.py`, `notion_pages.txt`, `query_*` | 현재 통합 대시보드 기준 밖의 과거 Notion 조회 보조 스크립트 |
| `CRM_base/*_output.txt`, `CRM_base/org_report.txt`, `CRM_base/inspect_results.json` 등 | 로컬 실행 결과물 |
| `CRM_base/MODEL_WORK_ASSIGNMENT.md`, `CRM_base/NEXT_WORK_PLAN.md`, `CRM_base/task*.md`, `CRM_base/walkthrough.md`, `handoff_dashboard_status.md`, `org_dashboard/HANDOFF_2026-04-08.md` | 이전 작업 지시/인수인계 문서. 현재 기준 문서로 대체 |

계속 Git에 남기는 기준 파일은 다음과 같다.

- 통합 기준 문서: `INTEGRATED_DASHBOARD_ARCHITECTURE_AUDIT_2026-05-02.md`
- DB 기준 문서: `CRM_base/SUPABASE_MIGRATION_PLAN.md`, `CRM_base/MIGRATION_STATUS_2026-05-01.md`, `CRM_base/STAFF_ORG_KEY_POLICY.md`
- 실행 파이프라인: `CRM_base/build_*`, `CRM_base/process_t5t_csv.py`, `CRM_base/sync_notion_raw_to_sql.py`, `CRM_base/upsert_supabase_seed.py`, `CRM_base/replace_supabase_*.py`
- 화면 진입점과 정적 assets: `index.html`, `org_dashboard/`, `t5t-dashboard/`, `CRM_base/portfolio-analysis/`, `pilot_form/`
