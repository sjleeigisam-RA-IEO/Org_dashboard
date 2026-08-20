# RA Dashboard Git 위계

## 권위 원칙

작업공간의 폴더 위계와 Git 소유권을 일치시킨다.

```text
C:\10137_WorkSpace\00. 2025 RA 기획추진\RA dashboard
```

상위 `RA dashboard` 저장소는 통합 Portal과 서로 강하게 연결된 운영 모듈의 권위 저장소다. 독립 실행·배포 단위인 제품만 번호 폴더 자체의 별도 저장소로 유지한다. 동일 파일을 상위와 하위 저장소가 동시에 ordinary blob으로 추적하지 않는다.

## 최종 저장소 경계

| Git 경계 | 소유 범위 | 이유 |
|---|---|---|
| 상위 `RA dashboard` | `00`, `01`, `02`, `03`, `05`, `08`, `51`, `90`, 루트 Portal·shared·supabase | 통합 실행·공유 인증·DB 계약·자동화·문서의 단일 권위 |
| `04. RentMap` | 임대차·오피스 시장 조사와 지도 파이프라인 | 별도 데이터·연구 workflow와 독립 이력 |
| `06. Enterprise Search DB` | 기업정보 검색 Next.js 앱 | 독립 build/test/runtime 단위 |
| `07. 3D Draw` | 도면 검토 앱 | 별도 remote와 배포 이력 |

`52. BID PJT`는 CAD·영상·메일·허가도서 등 대형 원본업무자료이므로 Git에서 제외하고 로컬 원본으로 관리한다.

## 루트 소유 모듈

- `00. Raw Data`: 통합 데이터 입력·risk 자료
- `01. RA Portal`: Portal 데이터 파이프라인, migration, Portfolio Analysis
- `02. T5T Board`: T5T Dashboard, Input Form, Notion automation runtime
- `03. Construction Board`: 시공사 정보 Dashboard와 갱신 자동화
- `05. Org Board`: 조직·좌석·관리자 UI와 canonical source workbook
- `08. Floor Stacking OCR`: 층별 안내 OCR 도구
- `51. IOTA_platform`: IOTA schema·RAG·기술문서
- `90. Shared Documentation`: 통합 architecture·schema·technical notes
- 루트 `index.html`, `portal.html`, `shared`, `supabase`: 통합 실행 계층

## 공유 관계

```text
루트 Portal / shared 인증
  ├─ 01. RA Portal 데이터·migration
  ├─ 02. T5T Board 및 automation_runtime
  ├─ 03. Construction Board
  ├─ 05. Org Board
  ├─ 08. Floor Stacking OCR
  └─ 51. IOTA_platform

독립 제품 저장소
  ├─ 04. RentMap
  ├─ 06. Enterprise Search DB
  └─ 07. 3D Draw
```

독립 저장소가 중앙 환경설정이나 Supabase contract를 참조하더라도 소스 이력은 각 독립 저장소가 소유한다. 상위 저장소는 `04`, `06`, `07`을 ignore하며 gitlink 또는 submodule로 추가하지 않는다.

## 흡수한 중복 저장소

2026-08-18에 아래 remote 없는 중첩 저장소를 상위 저장소로 흡수했다.

- `01. RA Portal/portfolio-analysis`
- `02. T5T Board`
- `05. Org Board`

흡수 전 모든 refs를 다음 외부 경로에 Git bundle로 보존하고 `git bundle verify`를 통과시켰다.

```text
C:\Users\10137\AppData\Local\hermes\git-archives\ra-dashboard-consolidation-20260818_142531
```

복구 예시:

```bash
git clone "C:/Users/10137/AppData/Local/hermes/git-archives/ra-dashboard-consolidation-20260818_142531/02-t5t-board.bundle" restored-t5t-board
```

## Commit 원칙

1. `00/01/02/03/05/08/51/90` 변경은 상위 저장소에만 commit한다.
2. `04/06/07` 변경은 각 번호 폴더의 독립 저장소에만 commit한다.
3. 상위 저장소에서 `04/06/07`을 force-add하거나 mode `160000` gitlink로 추가하지 않는다.
4. `52`의 대형 원본자료는 Git에 넣지 않는다.
5. 실제 `.env`, token, 비밀번호, 로컬 state는 어느 저장소에도 commit하지 않는다.
6. 원격 push 전 개인정보·업무자료 범위와 upstream divergence를 별도로 검토한다.

## 원격 주의사항

상위 저장소의 현재 remote 이름은 과거 조직 Dashboard 시절의 `Org_dashboard.git`이다. 로컬 통합 저장소의 범위가 더 넓으므로 원격 이름만 보고 저장소 범위를 판단하지 않는다. Remote 재편이나 push는 별도 승인과 upstream reconciliation 후 수행한다.
