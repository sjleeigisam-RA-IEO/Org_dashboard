# CRM_base 프로젝트 파일 명세서

작성 기준: 2026-04-26  
목적: 현재 폴더와 하위 폴더의 파일 역할, 저장 정보, 향후 SQL DB 업데이트 방향을 정리하여 다음 개발 작업의 기준 문서로 사용한다.

## 1. 프로젝트 요약

이 폴더는 IGIS RA부문 CRM/업무시스템 데이터를 기반으로 펀드, 자산, 대주, 수익자, 시장 임대료, AUM/청산 정보를 분석하는 데이터 파이프라인 및 대시보드 프로젝트이다.

현재 구조는 다음과 같다.

| 구분 | 역할 |
|---|---|
| 루트 Python 파일 | Excel 원천 데이터 정제 및 Supabase 적재 |
| `dashboard/` | Supabase 및 JSON 기반 프론트엔드 대시보드 |
| `_archive/` | 원본 Excel, 과거 코드, Notion export, API 문서, 캐시 보관 |
| `scratch/` | 검증, 보정, 패치, 일회성 데이터 생성 스크립트 |
| `migrations/` | Supabase 스키마 변경 SQL |

중요 원칙:

- `_archive/`의 원본 Excel은 단순 백업이 아니라 향후 SQL DB에 추가 적재 및 업데이트할 원천 자료이다.
- 특히 펀드관리/AUM관리 파일의 `운용상태`, `설정일`, `만기일`, `해지일`, `AUM합산대상여부`, `AUM(원)`은 펀드 생애주기, 청산, AUM runoff 예측 분석의 핵심 데이터이다.
- 대주/수익자 자료는 현재 2026-03-31 기준 스냅샷이지만, `대출인출일`, `대출만기일`, `최초약정일`, 펀드 `설정일`을 이용하면 발생 기준 시계열, 만기 wall, capital formation 분석이 가능하다.

## 2. 현재 Supabase 운영 테이블

REST 기준 현재 확인된 운영 테이블은 다음 5개이다.

| 테이블 | 현재 행수 | 저장 정보 | 주요 분석 가능 항목 |
|---|---:|---|---|
| `funds` | 580 | 펀드 마스터, Notion 분류, AUM 관련 metadata | 펀드 현황, 섹터, 상태, 국내/해외, 분류별 분석 |
| `fund_assets` | 695 | 펀드별 자산, 주소, 좌표, PNU, 건축물 제원 | 자산 분포, 지도, 연면적, 용도, PNU 그룹화 |
| `lender_exposures` | 579 | 대주, 약정/인출/잔여, 금리, 만기 | 대주 ranking, 만기 wall, 대출 발생 시계열 |
| `beneficiary_exposures` | 1,094 | 수익자, 약정/투입, 분류, 최초약정일 | LP ranking, 수익자 유형, equity formation |
| `market_data` | 20,231 | 오피스/물류 임대료, 보증금, 관리비, 공실률 | 시장 임대료 추이, 권역/건물 비교 |

현재 DB에 없는 것으로 확인된 테이블:

- `entities`
- `aum_history`
- `assets`
- `project_missions`

현재 AUM 시계열은 DB 테이블이 아니라 `dashboard/data/aum_history.json` 파일 기반이다.

## 3. 루트 파일 명세

| 파일 | 역할 | 저장 정보/주의사항 |
|---|---|---|
| `.env` | 로컬 실행용 환경변수 | Supabase, VWorld, data.go.kr API 키 저장. 외부 공유 금지 |
| `.gitignore` | Git 제외 규칙 | 캐시/환경파일/임시 산출물 관리 목적 |
| `processor.py` | 원천 Excel 정제 엔진 | 대주, 수익자, 투자자산, 펀드관리, 시장임대료 파일 파싱 |
| `uploader.py` | Supabase 업로더 | 정제 데이터 upsert, JSON metadata 병합 |
| `geocoder.py` | 지오코더 호환 wrapper | `_archive/geocoder.py`의 `VWorldGeocoder`, `BuildingLedgerFetcher`를 루트 import 경로로 노출 |
| `run_update.bat` | DB 업데이트 실행 배치 | `uploader.py` 실행. 원본 Excel 갱신 후 재실행 가능 |
| `setup_schema.sql` | 초기 DB 스키마 SQL | `funds`, `lender_exposures`, `beneficiary_exposures` 초기 설계 |
| `requirements.txt` | Python 의존성 | pandas, openpyxl, supabase, dotenv, psycopg2 |
| `data_pipeline_guide.md` | 기존 데이터 파이프라인 가이드 | ETL, PNU, 건축물대장, 대시보드 그룹화 설명 |
| `task.md` | 기존 작업 체크리스트 | ETL, 대시보드, analytics/ranking 진행상태 |
| `walkthrough.md` | 최근 UI/UX 개선 보고서 | 미커밋 상태. 디자인/시계열/드릴다운 개선 설명 |
| `PROJECT_FILE_SPEC.md` | 현재 문서 | 프로젝트 파일 역할 및 향후 DB 업데이트 기준 |
| `DB_전용_펀드_리스트.csv` | DB 전용 펀드 리스트 | 660건. 펀드코드/약칭 등 DB 보완 기준 후보 |
| `누락_펀드_리스트_분석.csv` | 누락 펀드 분석 산출물 | AUM/DB 매칭 누락 확인용 |
| `보완_필요_데이터_리스트.csv` | 보완 필요 데이터 목록 | 누락/품질 보완 후보 관리용 |

## 4. `dashboard/` 명세

| 파일 | 역할 | 저장 정보/주의사항 |
|---|---|---|
| `dashboard/index.html` | 대시보드 HTML 진입점 | Supabase JS, VWorld, ApexCharts CDN 로드 |
| `dashboard/app.js` | 대시보드 핵심 로직 | 검색, 그룹화, 상세패널, basket, 분석 차트, 지도, drill-down |
| `dashboard/style.css` | 대시보드 스타일 | 라이트/글래스 UI, 카드, 차트, 상세패널 스타일 |
| `dashboard/config.js` | 프론트엔드 API 설정 | Supabase URL/key, VWorld key. 외부 공유 주의 |
| `dashboard/run_dashboard.bat` | 대시보드 실행 배치 | 로컬 브라우저 실행용 |
| `dashboard/data/aum_history.json` | AUM/Loan/Equity 집계 JSON | 384개 row. `year`, `region`, `sector`, `aum`, `loan`, `equity` 저장 |

대시보드 1차 개선 방향:

- 현재 현황 분석: 펀드, 자산, 대주, 수익자, 시장 데이터
- 생애주기 분석: 설정, 청산, 해지, 만기 기반 증감
- AUM runoff 예측: 신규 프로젝트가 없을 때 미래 만기/해지 예정 펀드의 AUM 감소 시나리오
- 품질 분석: 좌표/PNU/건축물대장/Notion 분류/AUM 누락

## 5. `_archive/` 원천 및 보관 파일 명세

`_archive/`는 폐기 폴더가 아니다. 원본 Excel과 기준 데이터가 들어 있으므로 향후 DB 업데이트의 핵심 원천으로 유지한다.

### 5.1 원본 Excel

| 파일 | 역할 | 저장 정보 | 향후 DB 업데이트 방향 |
|---|---|---|---|
| `대주 정보 조회_20260424.xlsx` | 대주 스냅샷 원천 | 683행, 기준일자, 펀드코드, 대주, 약정/인출/잔여, 금리, 인출일, 만기일 | `lender_exposures`에 기준일자별 추가 적재. 중복키는 `fund_id + lender_clean + base_date + tranche/loan key` 재검토 필요 |
| `수익자 정보 조회_20260331.xlsx` | 수익자 스냅샷 원천 | 1,123행, 기준일자, 펀드코드, 수익자, 약정/투입, 최초약정일, 분류 | `beneficiary_exposures`에 기준일자별 추가 적재. 현재 key는 중복 병합 가능성이 있음 |
| `투자 자산 조회_20260424.xlsx` | 투자자산 원천 | 695행, 펀드코드, 자산명, 주소, 자산유형, 연면적 등 | `fund_assets` 업데이트. 주소/PNU/건축물대장 보강 가능 |
| `펀드 관리_20260424.xlsx` | 펀드 마스터 및 생애주기 원천 | 1,099행, 펀드코드, 약칭, 운용상태, 설정일, 만기일, 해지일, AUM합산대상여부, 모펀드코드 | `funds` 및 신규 `fund_lifecycle` 적재. 청산/미래 만기/runoff 분석 핵심 |
| `펀드 AUM 관리_20251224_all.xlsx` | AUM 전체/청산 포함 원천 | 863행, 운용 582, 청산 280, AUM 입력일자, AUM(원) | `fund_aum_snapshots` 신규 적재 후보. 청산 포함 historical base |
| `펀드 AUM 관리_20260112.xlsx` | 운용 펀드 AUM 원천 | 377행, 대부분 2025-12-31 기준 AUM | 최신 운용 AUM 기준. 2026-03-31 자료 확보 후 재정리 필요 |
| `office_rent_20254q.xlsx` | 오피스 임대시장 원천 | 12,195행, 분기, 빌딩, 권역/동, 임대료, 보증금, 관리비, 공실률, NOC | `market_data` 추가/업데이트. PNU/건물번호 key 보존 필요 |
| `logistic_rent_20254q.xlsx` | 물류 임대시장 원천 | 10,403행, 분기, 빌딩, 창고유형, 규모, 임대료, 보증금, 관리비, 공실률 | `market_data` 추가/업데이트. PNU/건물번호 key 보존 필요 |

### 5.2 Notion export 및 분류 보강 자료

| 파일 | 역할 | 저장 정보 |
|---|---|---|
| `Project & Mission_all.csv` | Notion 전체 export | 421행, Project & Mission 이름, AUM, Loan, Equity, 분류, 주소, Vehicle 등 |
| `Project & Mission 2.csv` | Notion 축약 export | 278행, 분석/매칭에 필요한 핵심 컬럼 |
| `314a1578-...ExportBlock...zip` | Notion export 원본 zip | Notion export 원본 보관 |
| `314a1578-.../ExportBlock-...Part-1.zip` | export 내부 zip | 세부 export 원본 |
| `314a1578-.../Project & Mission_all.csv` | export 내부 전체 CSV | `_archive/Project & Mission_all.csv`와 동일 계열 |
| `314a1578-.../Project & Mission 2.csv` | export 내부 축약 CSV | `_archive/Project & Mission 2.csv`와 동일 계열 |
| `notion_sync_report.json` | Notion 동기화 결과 | 펀드명/프로젝트명 매칭 및 업데이트 결과 |
| `sync_notion_project_mission.py` | Notion CSV 동기화 스크립트 | Project & Mission 이름 및 분류를 Supabase `funds`에 반영 |

### 5.3 API, 캐시, 분석 산출물

| 파일 | 역할 | 저장 정보 |
|---|---|---|
| `geocoder.py` | 원본 지오코딩/API 구현 | VWorld 좌표, VWorld 주소 정제/PNU, 건축HUB 건축물대장 조회 |
| `geocoding_cache.json` | 주소 좌표 캐시 | 원주소별 위도/경도/정제주소 |
| `building_cache.json` | 건축물대장 캐시 | PNU 기반 건축물 제원 |
| `asset_analysis.json` | 자산 분석 중간 산출 | 투자자산 컬럼/품질 분석 결과 |
| `fund_master_analysis.json` | 펀드 마스터 분석 산출 | 펀드관리 컬럼/품질 분석 결과 |
| `rent_analysis.json` | 임대료 분석 산출 | 오피스/물류 임대시장 분석 결과 |
| `crm_local.db` | 초기 로컬 SQLite DB | `funds`, `lender_exposures`, `beneficiary_exposures` 보관 |
| `debug_db.py` | DB 디버그 스크립트 | 초기 Supabase/SQLite 점검용 |
| `verify_local.py` | 로컬 검증 스크립트 | 로컬 DB/정제 데이터 검증 |
| `check_design.py` | 대시보드 디자인 점검 | CSS/UI 점검용 |
| `mapping.json` | 명칭 정제 mapping | 대주/수익자 canonical name 매핑 |
| `supabase sql pw.txt` | Supabase SQL 접속 비밀번호 | 외부 공유 금지. 현재 직접 SQL 접속은 추가 확인 필요 |
| `data_error_report_20260424.md` | 데이터 오류 보고서 | 서울로타워/오투타워 매핑 오류 분석 |
| `implementation_plan.md` | 초기 구현 계획 | CRM 자동화 및 대시보드 구축 계획 |
| `IGIS_CRM_Dashboard_Plan_v1.2.docx` | 대시보드 기획 문서 | 초기 대시보드 기획 자료 |
| `OpenAPI활용가이드-_건축HUB_건축물대장_1.0/` | 공공데이터 API 문서 | 건축물대장 API HWP/PDF 문서 |

## 6. `migrations/` 명세

| 파일 | 역할 | 저장 정보 |
|---|---|---|
| `2026-04-24_add_notion_search_fields.sql` | Supabase migration | `funds`에 Project & Mission 이름과 Notion 분류 컬럼 추가 |

## 7. `scratch/` 작업 스크립트 명세

`scratch/`는 운영 파이프라인이 아니라 검증, 패치, 재생성, 일회성 보정 목적의 작업 로그 성격이다. 재사용 가능성이 있는 스크립트는 향후 `tools/` 또는 `pipeline/`으로 승격한다.

| 파일 | 역할 |
|---|---|
| `analyze_gaps.py` | AUM/DB 누락 gap 분석 |
| `analyze_hierarchy.py` | 펀드/모펀드 계층 분석 |
| `analyze_hierarchy_v2.py` | 계층 분석 개선판 |
| `audit_db.py` | Supabase 적재 상태 감사 |
| `build_history.py` | AUM history 생성 초기 스크립트 |
| `check_cols.py` | Excel/CSV 컬럼 확인 |
| `check_garbled.py` | 깨진 인코딩/명칭 점검 |
| `check_schema.py` | DB schema 확인 |
| `cols.txt` | Notion/CSV 주요 컬럼 목록 |
| `column_audit.py` | 컬럼 감사 |
| `compare_aum.py` | AUM 원천/DB 비교 |
| `cross_validate.py` | 교차 검증 |
| `debug_csv.py` | CSV row 디버그 |
| `diagnostic.py` | 종합 진단 |
| `discover_id.py` | ID/펀드코드 컬럼 탐색 |
| `export_db_only.py` | DB 전용 리스트 추출 |
| `export_history.py` | AUM history JSON export |
| `export_missing.py` | 누락 목록 export |
| `final_compare.py` | 최종 비교 검증 |
| `final_dashboard_fix.py` | 대시보드 최종 보정 패치 |
| `final_enrich.py` | 최종 enrich/보강 |
| `final_polish.py` | 대시보드 polish |
| `final_sweep.py` | master encoding/데이터 최종 sweep |
| `find_cols_v2.py` | 컬럼 탐색 개선판 |
| `find_diffs.py` | major diff 탐색 |
| `find_p00030.py` | 특정 펀드코드 검색 |
| `fix_syntax_error.py` | dashboard JS 문법 오류 수정 |
| `gap_report.txt` | gap 분석 요약. Missing AUM 206, Missing Rate 580 |
| `inspect_cache.py` | geocoding/building cache 점검 |
| `inspect_meta.py` | metadata 구조 점검 |
| `map_csv.py` | CSV 컬럼 매핑 |
| `master_validation.py` | master 데이터 종합 검증 |
| `modernize_charts.py` | 차트 UI 현대화 패치 |
| `patch_dashboard.py` | dashboard JS 패치 |
| `patch_dashboard_logic.py` | dashboard logic 패치 |
| `patch_region_donut.py` | 권역 donut 차트 패치 |
| `patch_v3.py` | dashboard v3 패치 |
| `purge_and_sync.py` | DB purge 후 재동기화 실험 |
| `regenerate_history.py` | AUM history 재생성 |
| `regenerate_history_v2.py` | AUM history 재생성 개선판 |
| `row_427.json` | 특정 row 디버그 스냅샷 |
| `simulate_matrix.py` | 분석 matrix 시뮬레이션 |
| `sync_excel_aum.py` | Excel AUM을 DB/JSON에 동기화 |
| `time_series_analysis.py` | 시계열 분석 실험 |
| `ultimate_fix.py` | 대시보드/데이터 최종 통합 패치 |
| `update_from_csv2.py` | CSV 기반 분류 업데이트 |
| `upload_api.py` | API 기반 업로드 실험 |
| `verify_api.py` | API 품질 검증 |
| `verify_consistency.py` | DB/JSON/원천 정합성 검증 |
| `verify_hex.py` | 인코딩/hex 검증 |
| `verify_phase1.py` | phase 1 검증 |
| `verify_phase2.py` | phase 2 검증 |
| `verify_phase34.py` | phase 3/4 검증 |

## 8. 향후 SQL DB 업데이트 설계 방향

현재 DB는 운영 화면에 필요한 5개 테이블 중심이다. 다음 단계에서는 원본 Excel을 기준으로 append/update가 가능한 구조를 열어두는 것이 중요하다.

### 8.1 추가 권장 테이블

| 테이블 | 목적 | 주요 키 |
|---|---|---|
| `fund_lifecycle` | 설정/만기/해지/청산 상태 관리 | `fund_id`, `snapshot_date` |
| `fund_aum_snapshots` | AUM 기준일별 스냅샷 | `fund_id`, `base_date`, `source_file` |
| `fund_movements` | 신규 설정/증액/감액/청산 이벤트 | `fund_id`, `event_date`, `event_type` |
| `capital_commitment_snapshots` | 대주/수익자 약정 스냅샷 통합 | `fund_id`, `party_type`, `party_name`, `base_date` |
| `data_quality_issues` | 누락/오류/이상값 관리 | `issue_id` |

### 8.2 청산 및 AUM runoff 분석

현재 `펀드 관리_20260424.xlsx`에 `운용상태`, `설정일`, `만기일`, `해지일`이 있으므로 다음 분석이 가능하다.

- 이미 청산된 펀드: `운용상태 = 청산` 또는 `해지일 <= 분석기준일`
- 미래 청산/만기 예정 펀드: `만기일 > 분석기준일` 또는 미래 `해지일`
- 신규 프로젝트가 없을 때의 AUM 감소 예측: 현재 운용 AUM을 만기/해지 예정일에 차감하는 runoff curve
- 청산률/잔존률: 설정연도 vintage별 운용 잔존 펀드 수 및 AUM
- AUM bridge: 전기 AUM + 신규 설정/증액 - 감액/청산 = 당기 AUM

### 8.3 원본 Excel 업데이트 원칙

- 새 원천 파일은 `_archive/` 또는 별도 `raw/YYYYMMDD/`에 보존한다.
- 파일명 기준일을 source metadata로 저장한다.
- 대주/수익자 스냅샷은 같은 기준일 중복은 업데이트, 다른 기준일은 추가 적재한다.
- 펀드관리/AUM관리 파일은 기준일별 snapshot으로 적재하여 과거 상태를 덮어쓰지 않는다.
- 청산/해지/만기 정보는 최신 파일로 `fund_lifecycle`을 업데이트하되, 과거 snapshot은 보존한다.
- dashboard용 JSON은 임시 산출물로 유지할 수 있으나, 장기적으로는 DB view 또는 materialized view에서 생성한다.

## 9. 1차 대시보드 개선 범위

1차 목표는 현재 적재 데이터와 원본 Excel에서 바로 만들 수 있는 분석을 시각화하는 것이다.

| 화면 | 핵심 내용 |
|---|---|
| Executive Overview | 현재 운용 펀드, 자산, 대주/수익자 약정, 좌표/PNU 확보율 |
| Lifecycle & Runoff | 설정/청산/해지, 미래 만기 기반 AUM 감소 예측 |
| Capital Formation | 대주/수익자 약정 발생 추이, vintage별 자금 형성 |
| Asset & Sector Exposure | 섹터/자산유형/권역별 노출 및 지도 |
| Lender Analysis | 대주 ranking, 금리, 만기 wall, 연결 펀드 |
| Beneficiary Analysis | 수익자 ranking, 분류별 비중, 연결 펀드 |
| Market Data | 오피스/물류 임대료, 보증금, 관리비, 공실률 추이 |
| Data Quality | AUM/좌표/PNU/분류/해지일 누락 및 이상값 |

## 10. 즉시 확인된 기술 리스크

| 리스크 | 내용 | 대응 |
|---|---|---|
| `geocoder.py` 위치 변경 | `processor.py`가 루트 `geocoder.py`를 import했으나 구현체가 `_archive/`로 이동되어 import 실패 | 루트 wrapper `geocoder.py` 추가 완료 |
| AUM 소스 혼재 | DB metadata, Excel AUM, JSON history가 혼재 | 2026-03-31 기준 최신 자료 확보 후 `fund_aum_snapshots`로 일원화 |
| 대주/수익자 중복키 병합 | 현재 upsert key가 일부 원천 row를 병합 | tranche/계좌/원천 row id 등을 포함한 key 재설계 검토 |
| `parent_fund_id` 위치 | DB 컬럼은 비어 있고 metadata에는 값 존재 | SQL 분석용 컬럼 backfill 또는 view 생성 |
| 직접 SQL 접속 | 저장된 비밀번호/호스트 조합으로 직접 SQL 접속 실패 | Supabase connection string 확인 필요. REST 조회는 가능 |

