# Supabase Migration Plan

## 방향

현재 대시보드는 그대로 둔다.

- `org_dashboard`: 기존 `org-data.json`, `seat-layout-data.json`, Google Sheet 흐름 유지
- `t5t-dashboard`: 기존 Notion sync -> local JSON 흐름 유지
- `CRM_base/portfolio-analysis`: 기존 Supabase 운영 테이블 + local JSON 흐름 유지

이번 작업은 대시보드를 새 DB에 연결하는 작업이 아니라, 나중에 연결할 수 있도록 Supabase 쪽 기준 테이블과 seed 적재 파이프라인을 먼저 만드는 작업이다.

조직/좌석의 운영 원천은 Google Spreadsheet다. 따라서 seed 생성의 기본값은 `sheet-linked.config.js`의 Google Apps Script WebApp을 호출해 최신 시트 데이터를 가져오는 방식이다. 로컬 JSON은 오프라인 fallback 또는 좌석 좌표/도형 같은 정적 레이아웃 보조 데이터로만 사용한다.

## 추가 산출물

- `migrations/2026-05-01_core_dashboard_tables.sql`
  - `orgs`, `staff`, `staff_org_assignments`, `seats`, `seat_layout_shapes`, `aum_snapshots`, `fund_lifecycle`
  - 기존 `funds`, `fund_assets`에는 연결용 FK 컬럼만 추가
- `migrations/2026-05-01_t5t_input_tables.sql`
  - `projects`, `project_staff_links`, `t5t_logs`, `t5t_log_project_links`, `t5t_input_drafts`
  - `t5t_form_submissions`, `t5t_form_items`
  - 향후 T5T 입력창에서 사람/프로젝트 선택값을 표준키로 저장하기 위한 기반
- `build_supabase_seed.py`
  - 기본값: Google Apps Script WebApp에서 최신 조직/좌석 데이터를 읽어 Supabase 적재용 seed JSON 생성
  - 옵션: `--source json`으로 기존 로컬 JSON fallback 사용 가능
- `upsert_supabase_seed.py`
  - 생성된 seed JSON을 Supabase에 upsert
- `build_t5t_seed.py`
  - T5T Notion JSON cache에서 프로젝트/로그 seed 생성
- `build_t5t_raw_seed.py`
  - 실제 T5T form CSV export에서 원천 제출/항목 seed 생성
- `supabase_seed/*.json`
  - 생성 산출물. 실행 전에는 존재하지 않을 수 있다.

## 실행 순서

1. Supabase SQL Editor에서 `migrations/2026-05-01_core_dashboard_tables.sql` 실행
2. 로컬에서 seed 생성

Google Spreadsheet 기준으로 생성한다.

```powershell
python CRM_base\build_supabase_seed.py
```

오프라인이거나 WebApp 접근이 안 될 때만 로컬 JSON fallback을 쓴다.

```powershell
python CRM_base\build_supabase_seed.py --source json
```

3. 업로드 전 건수 확인

```powershell
python CRM_base\upsert_supabase_seed.py --dry-run
```

4. Supabase 업로드

```powershell
python CRM_base\upsert_supabase_seed.py
```

T5T 입력 기반 테이블은 별도 SQL 실행 후 아래 순서로 적재한다.

```powershell
python CRM_base\build_t5t_seed.py
python CRM_base\upsert_supabase_seed.py --table projects --table project_staff_links --table t5t_logs --table t5t_log_project_links
```

실제 T5T form raw CSV는 Notion 처리 로그와 별도로 보존한다.

```powershell
python CRM_base\build_t5t_raw_seed.py
python CRM_base\upsert_supabase_seed.py --table t5t_form_submissions --table t5t_form_items
```

## 설계 메모

- `staff`는 t5t의 `staff_master.json`을 우선 기준으로 삼는다.
- `org_dashboard` Google Sheet에만 있는 인원은 `staff_name_<hash>` 형식의 임시 ID로 보완한다.
- 좌석에만 등장하는 인원도 seed에 포함한다. 다만 `공용PC`, `모션 데스크` 같은 시스템 좌석명은 staff로 만들지 않는다.
- 조직/좌석 원본에서 아직 매핑이 불명확한 필드는 삭제하지 않고 `metadata` JSONB에 보존한다.
- Google WebApp의 `seatLayout.rows`는 최신 좌석 배정 원천이다.
- 좌석 좌표/도형은 현재 WebApp payload에 포함되지 않으므로, 당분간 로컬 `seat-layout-data.json`의 정적 geometry를 보조로 결합한다.
- 완전한 JSON-less 구조로 가려면 Google Sheet 또는 Supabase에 `seat_defs`, `seat_layout_shapes` 성격의 정적 레이아웃 마스터까지 올려야 한다.
- `aum_snapshots`는 연도/섹터/지역 단위 AUM history와 현재 fund-level snapshot을 함께 담는다.

## 이후 단계

1. Supabase 적재 후 row count와 null key 점검
2. `staff.name` 기준 중복 및 동명이인 검토
3. `seats.person_name -> staff.staff_id` 매핑 누락 검토
4. `funds.manager -> staff.staff_id`는 즉시 연결하지 않고, 후보표만 유지
5. DB 품질이 안정되면 그때 대시보드 fetch 경로를 Supabase로 전환

현재 통합의 origin은 `staff` 테이블이다. 펀드 담당자 FK는 향후 분석 연결을 위한 확장 포인트이며, 이번 마이그레이션의 필수 연결 대상은 아니다.

T5T 입력창을 만들 때의 우선순위는 다음과 같다.

1. `/api/staff`에서 `staff` 목록 제공
2. `/api/projects`에서 `projects` 목록 제공
3. 입력 row는 `writer_staff_id`, `selected_project_ids`를 함께 저장
4. 이후 Notion sync 또는 Supabase-only 운영 여부를 결정

2026-05-01 기준 확인한 raw CSV 원천:

- 파일: `t5t-dashboard/IGIS RA T-5-T Forms_Submissions_2026-05-01.csv`
- 기간: 2025-08-22 ~ 2026-04-29
- 제출: 579건
- 업무 항목: 2,894건
- 작성자 식별 후보: 이메일 39개, 이름 33개
- 프로젝트 텍스트 입력 항목: 1,924건
- 외부 관계자/상대방 텍스트 입력 항목: 1,533건
