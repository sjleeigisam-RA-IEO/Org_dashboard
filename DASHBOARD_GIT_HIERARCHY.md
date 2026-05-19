# RA Dashboard Git 위계 정리

## 목적

이 작업 폴더는 여러 개의 대시보드가 하나의 운영 시스템처럼 묶여 있는
통합 RA 대시보드 작업공간입니다.

현재 운영 기준 저장소는 상위 저장소입니다.

```text
D:\Project\00. 2025 RA 기획추진\RA dashboard
```

하위 폴더의 Git 저장소들은 각 대시보드가 독립 프로젝트였을 때의 로컬
이력을 보존하는 역할입니다. 실제 운영 관점에서는 상위 포털, 공유
Supabase DB, 공통 자동화 파이프라인을 통해 하나의 시스템으로 작동합니다.

## 저장소별 역할

| 저장소 | 역할 | 현재 해석 |
|---|---|---|
| 상위 `RA dashboard` | 통합 운영 저장소 | 포털, 공유 DB 스키마, Supabase 작업, Edge Function, 대시보드 간 릴리즈의 기준 |
| `CRM_base/portfolio-analysis` | RA Insight 대시보드 | 펀드, 자산, 프로젝트, 수익자, 대주, canonical asset 분석 UI의 로컬 이력 |
| `t5t-dashboard` | T5T 분석 대시보드 | T5T 분석, 이슈 인텔리전스, 주간 요약, 관련 UI의 로컬 이력 |
| `org_dashboard` | 조직 대시보드 | 조직, 좌석배치, 구성원, 관리자 화면, Google Sheet fallback UI의 로컬 이력 |

## 작업 기준

현재 통합 작업은 상위 저장소를 기준으로 진행합니다.

하위 저장소는 각 대시보드 단위의 이력을 남길 필요가 있을 때 커밋합니다.
다만 명시적으로 다시 분리하지 않는 한, 하위 저장소를 별도 배포 기준으로
보지 않습니다. 실제로 함께 작동하는 통합 상태는 상위 저장소에 기록합니다.

## 데이터와 의존성 위계

```text
공유 Supabase DB
  -> CRM_base 파이프라인과 마이그레이션
  -> RA Insight portfolio-analysis
  -> T5T input 및 T5T dashboard
  -> Org dashboard 구성원/관리자 화면
  -> portal.html 통합 셸
```

주요 공유 계층은 다음과 같습니다.

- `CRM_base/migrations`: 기존 대시보드를 깨지 않는 additive DB 변경
- `CRM_base/*sync*.py`, `run_t5t_pipeline.py`: 수집 및 정규화 파이프라인
- `supabase/functions/t5t-submit`: 제출, 초안, 지난주 업무 불러오기 endpoint
- `CRM_base/portfolio-analysis/config.js`: 로컬 공통 Supabase 설정 소스
- `portal.html`: 통합 실행 셸

## 커밋 원칙

1. 하위 대시보드의 로컬 이력을 남길 필요가 있으면 하위 저장소를 먼저 커밋합니다.
2. 이후 상위 저장소에서 실제 통합 운영 상태를 커밋합니다.
3. 생성물이나 백업 파일은 감사 추적 또는 데이터 인계 가치가 있을 때만 남깁니다.
4. 인증, DB 스키마, 자동화, 공유 데이터 계약, 대시보드 간 동작은 상위 저장소 기준으로 관리합니다.

## 현재 기준선

2026-05-19 기준, 상위 저장소가 현재 운영 기준입니다. 하위 저장소들은 각
대시보드별 로컬 이력 보존을 위해 최신 상태로 커밋했으며, 이 문서는 앞으로
작업할 때 기준이 흔들리지 않도록 저장소 위계를 기록합니다.
