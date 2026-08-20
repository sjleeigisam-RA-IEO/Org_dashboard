# T5T JSON vs SQL DB Quality Comparison

작성일: 2026-05-13

## 1. 비교 대상

| 구분 | 위치/테이블 | 역할 | 현재 상태 |
|---|---|---|---|
| 기존 JSON | `02. T5T Board/data/t5t_log.json` | 기존 대시보드 노출용 최종 로그 | 1,223건, 2026-01-03~2026-05-03 |
| 신규 SQL 원문/중간 | `t5t_form_submissions`, `t5t_form_items` | Notion/Tally 원문을 신청/항목 단위로 구조화 | 617 submissions, 3,075 items, 2025-08-25~2026-05-11 |
| 신규 SQL 정규화 | `t5t_logs`, `t5t_log_project_links`, `t5t_log_stakeholders` | 대시보드용 로그/관계형 테이블 | 113 logs, 9 project links, 58 stakeholders, 2026-05-04~2026-05-11 |

현재 `02. T5T Board/t5t-service-v2.js`는 `t5t_logs`가 아니라 `t5t_form_items`를 직접 조회해 집계한다. 따라서 현 시점의 실제 SQL 대시보드 품질은 `t5t_form_items` 기준으로 보는 것이 맞다.

## 2. 핵심 결론

신규 SQL 방식은 원문 보존, 기간 커버리지, 자동 적재 구조 측면에서는 기존 JSON보다 확장성이 높다.

다만 대시보드 완성도 기준으로는 아직 기존 JSON이 우위다. 기존 JSON은 Notion의 로그형 변환 단계에서 요약, 업무유형, 프로젝트 매칭, 수동 확인 플래그가 이미 상당히 정제된 상태였고, 신규 SQL 방식은 raw item을 규칙 기반으로 직접 변환하면서 프로젝트 매칭률과 분류 품질이 아직 낮다.

따라서 현재 상태를 그대로 커밋/운영하면 "수집 자동화는 개선되었지만, 대시보드 인사이트 품질은 하락"할 가능성이 크다.

## 3. 정량 비교

| 항목 | 기존 JSON | SQL `t5t_form_items` | SQL `t5t_logs` |
|---|---:|---:|---:|
| 전체 건수 | 1,223 | 3,075 | 113 |
| 기간 | 2026-01-03~2026-05-03 | 2025-08-25~2026-05-11 | 2026-05-04~2026-05-11 |
| 요약 존재율 | 100.0% | 100.0% | 100.0% |
| 원문 존재율 | 기존 요약 중심 | 100.0% | 100.0% |
| 작성자 식별률 | 100.0% | 91.7% | 100.0% |
| 라인 식별률 | 100.0% | 100.0% | 100.0% |
| 토큰 존재율 | 100.0% | 74.8% | 62.8% |
| 프로젝트/펀드 등 매칭률 | 약 55% 수준 | 28.1% | 30.1% |
| 프로젝트 직접 매칭 | 559+111+12 상태군 | 9건 | 9건 |
| 펀드 매칭 | JSON에는 별도 SQL fund id 없음 | 583건 | metadata 기반 |
| 수동확인/미매칭 | 미매칭 430건, 수동확인 150건 | raw_unmatched 2,207건 | manual review 79건 |

동일 기간에 가까운 2026-01~2026-04 기준으로도 SQL `t5t_form_items`의 매칭률은 33.2% 수준이다. 기존 JSON의 대시보드 KPI상 match rate는 약 54.8%였고, 상태 분포상 `Project & Mission 매칭`, `신규 프로젝트 매칭`, `복수 후보`가 대시보드용 관계 품질을 지탱하고 있었다.

## 4. 품질 차이 원인

### 4.1 기존 JSON의 강점

- Notion에서 이미 "로그형 DB"로 변환된 후 JSON화되어 대시보드에 들어갔다.
- `원문 요약`, `업무유형`, `classification_tokens`, `매칭 근거`, `수동 확인 필요`가 거의 전 건에 채워져 있다.
- 프로젝트 관계는 `Project & Mission` 또는 `신규 프로젝트` relation id로 들어가 있어 대시보드 pulse/top project 구성에 유리하다.
- 작성자/라인/source URL이 모두 채워져 있어 UI 설명력이 높다.

### 4.2 신규 SQL 방식의 강점

- Notion raw 원문을 SQL에 직접 보존하므로 원천 추적성과 재처리가 가능하다.
- `t5t_form_submissions`와 `t5t_form_items`로 원문 신청 단위와 항목 단위가 분리되어 있다.
- 기존 JSON보다 훨씬 긴 기간을 커버한다. 현재 2025-08~2026-05까지 3,075 item이 적재되어 있다.
- 펀드/자산/거래상대방 SQL 마스터와 직접 연결할 수 있는 구조라 장기적으로 CRM/포트폴리오 DB와 결합하기 좋다.

### 4.3 신규 SQL 방식의 약점

- 프로젝트 직접 매칭이 9건뿐이다. `project_text`가 있는데도 미매칭인 항목이 1,397건이다.
- `match_status='matched'`인데 `matched_project_id`와 `matched_fund_id`가 모두 없는 항목이 276건 있다. 과거 CSV 적재분의 metadata가 비어 있어 매칭 상태의 의미가 불명확하다.
- 분류 체계가 기존 JSON의 `운용/관리`, `신규검토`, `프로젝트`, `펀딩관련 업무`, `펀드/투자자`, `리스크/법무`보다 단순하다. 현재 SQL item은 주로 `General`/`Project`, SQL logs는 `내부·기타`/`펀드·투자자`/`프로젝트`로만 분류된다.
- SQL 정규화 테이블 `t5t_logs`는 113건만 존재한다. 전체 raw item 3,075건을 아직 대시보드용 로그로 완전히 전환하지 못한 상태다.
- 현재 대시보드 JS가 `t5t_logs`가 아니라 `t5t_form_items`를 직접 조회하므로, 새로 만든 정규화 테이블이 실제 화면의 단일 기준으로 정착되지 않았다.

## 5. 샘플 문제

아래 항목들은 `project_text`가 있는데도 `raw_unmatched`로 남아 있다.

| work_date | project_text | raw_text 요지 | 현재 상태 |
|---|---|---|---|
| 2026-03-02 | 고양 삼송 데이터센터 개발 프로젝트 | 임대차 및 인입 루트 공사 관련 업무 | raw_unmatched |
| 2026-03-02 | 양재 더케이호텔 재개발 프로젝트 | 삼성전자/현대차/디스트릭트 얼라이언스 기획 | raw_unmatched |
| 2026-03-02 | 양재더케이 | 양재동 더케이호텔 인허가 및 설계 | raw_unmatched |
| 2026-03-02 | 동대문 두타 | 매도자 및 투자자 협의 | raw_unmatched |
| 2026-03-02 | 타임워크 웨스트 | 대체 시공사, 대주단 대출연장, PF 기준 협의 | raw_unmatched |

이는 프로젝트명 alias/short-name 매칭 규칙이 기존 Notion 로그 DB 수준으로 이관되지 않았다는 신호다.

## 6. 판단

현 시점에서 SQL 전환 로직은 "원문 수집 자동화 및 DB 적재"까지는 방향이 맞다. 그러나 "대시보드에 바로 적용 가능한 품질의 최종 로그 테이블"로는 아직 보강이 필요하다.

운영 전환 기준은 다음 세 가지다.

1. `t5t_logs`를 실제 대시보드 조회 기준으로 삼을지, 아니면 `t5t_form_items` 직접 집계를 유지할지 결정한다.
2. 기존 JSON의 프로젝트 relation/업무유형/매칭근거 품질을 SQL 변환 로직에 이식한다.
3. 전체 `t5t_form_items` 3,075건을 대상으로 `normalize_t5t_logs.py`를 재실행하고, 최소한 기존 JSON 수준의 매칭률 55% 내외를 회복한다.

## 7. 권장 작업

1. 기존 JSON `t5t_log.json`의 `업무 로그명`, `원문 요약`, `업무유형`, `매칭 상태`, `매칭 근거`, relation id를 SQL `t5t_logs` 보정 seed로 1회 이관한다.
2. `projects`, `funds`, `asset_master`, `project_mission` alias 테이블 또는 alias JSON을 만들어 `project_text` 기반 fuzzy/alias 매칭을 강화한다.
3. `match_status='matched'`인데 id가 없는 276건을 재분류한다.
4. `normalize_t5t_logs.py` 실행 결과가 전체 기간을 커버하도록 확인한다.
5. `t5t-service-v2.js`의 조회 대상을 `t5t_form_items`에서 `t5t_logs` 중심으로 바꾸고, raw item은 drilldown에서만 보조로 쓰는 구조가 바람직하다.

## 8. 일반업무 재분류 가설 검증

추가 dry-run 결과, `raw_unmatched` 중 프로젝트 매칭 대상이 아니라 일반업무로 볼 수 있는 항목을 별도 상태로 분리하면 평가 결과가 크게 달라진다.

| 범위 | 전체 item | 기존 matched | 일반업무 후보 | 유효 분류율 |
|---|---:|---:|---:|---:|
| 전체 SQL item | 3,075 | 868 | 886 | 57.0% |
| 기존 JSON 비교기간(2026-01-03~2026-05-03) | 1,301 | 432 | 371 | 61.7% |

이는 기존 JSON의 유효 상태군(`Project & Mission 매칭`, `신규 프로젝트 매칭`, `복수 후보`, `일반업무`)과 비교했을 때 훨씬 가까운 수치다. 따라서 단순 `matched` 비율만으로 SQL 전환 품질을 판단하면 일반업무를 실패로 과대계상하게 된다.

반영한 로직:

- `project_text`가 비어 있고 원문/요약이 존재하는 항목은 기본적으로 `general_work` 후보로 본다.
- `project_text`가 있어도 `수익자 미팅`, `투자자 미팅`, `물류 포트폴리오`, `물류섹터뷰`, `협업`, `시장 리서치`, `시니어 블라인드`처럼 특정 프로젝트 relation보다 일반 활동에 가까운 텍스트는 `general_work` 후보로 본다.
- `sync_notion_raw_to_sql.py`는 신규 Notion 적재 시 해당 항목을 `match_status='general_work'`, `task_type='일반업무'`로 저장한다.
- `normalize_t5t_logs.py`는 기존 `raw_unmatched` 항목도 정규화 시 같은 기준으로 `general_work`로 해석하고, `needs_manual_review=false`로 처리한다.
- 기존 적재분은 `01. RA Portal/classify_t5t_general_work.py`로 dry-run 후 `--apply` 옵션을 주면 `t5t_form_items`에 반영할 수 있다.

## 9. 신규/기존 프로젝트·펀드·자산 재매칭 반영 결과

`01. RA Portal/match_t5t_entities.py`를 추가해 `raw_unmatched` 중 일반업무가 아닌 항목을 대상으로 다음 후보군과 재매칭했다.

- 신규/기존 프로젝트: `projects.project_name`, `project_code`, metadata의 `Project & Mission 이름`, `Vehicle(약칭)`, `자산명`, `펀드명`, `투자지역`
- 펀드: `funds.fund_id`, `short_name`, `fund_name`, `asset_name`, `project_mission_name`
- 자산: `asset_master.canonical_name`, `asset_code`
- 자산 경유 관계: `asset_project_links`, `asset_fund_links`

오탐 방지를 위해 `13호` 같은 짧은 호수명, 도시명 단독 매칭, `개발사업/DC/소형` 같은 범용 토큰만으로 이루어진 매칭은 제외했다.

1차 DB 반영 결과:

| 테이블 | 상태 | 건수 |
|---|---|---:|
| `t5t_form_items` | `matched` | 1,294 |
| `t5t_form_items` | `general_work` | 886 |
| `t5t_form_items` | `raw_unmatched` | 895 |
| `t5t_form_items` | `matched_project_id` 보유 | 356 |
| `t5t_form_items` | `matched_fund_id` 보유 | 666 |
| `t5t_logs` | 전체 정규화 로그 | 3,075 |
| `t5t_log_project_links` | 프로젝트 링크 | 356 |
| `t5t_log_stakeholders` | 이해관계자 링크 | 702 |

일반업무와 매칭 성공을 함께 보면 유효 분류 건수는 `1,294 + 886 = 2,180건`, 전체 3,075건 중 약 70.9%다.

## 10. A/B 라인 별칭 보정 반영 결과

사용자 검토로 확인된 A/B 라인 업무명 별칭을 `01. RA Portal/t5t_manual_aliases.json`에 추가하고 `01. RA Portal/apply_t5t_manual_aliases.py`로 2026년 A/B 라인 미매칭 항목에 반영했다.

반영한 주요 별칭:

- B Line: `타임워크 웨스트/타임워크 신도림 -> 타임워크 웨스트 (신도림)`, `세운 5-1, 3 -> 세운5구역`, `타임워크 분당 -> 롯데백화점 분당점 리모델링`, `팩토리얼 용산/용산 나진 -> 팩토리얼 용산`, `IOTA/서울로+메트로 -> 이오타서울`, `IGIS 572 -> 572호/부산 육양국 DC`
- B Line 추가: `KLIP1`, `서리풀`, `가산 복합개발`, `Mall of K/PJT Lucina`, `IGIS 429/439`, `IGIS 472`, `IGIS 501`, `IGIS 574`, `울산KTX`
- A Line: `부산 데이터센터 -> 부산 육양국 DC`, `Special Situation Fund TFT -> 별도 일반업무`, `오금역 시니어개발`, `양양씨사이드`, `고양 삼송 DC`

최종 DB 반영 결과:

| 테이블 | 상태 | 건수 |
|---|---|---:|
| `t5t_form_items` | `matched` | 1,386 |
| `t5t_form_items` | `general_work` | 901 |
| `t5t_form_items` | `raw_unmatched` | 788 |
| `t5t_form_items` | `matched_project_id` 보유 | 444 |
| `t5t_form_items` | `matched_fund_id` 보유 | 670 |
| `t5t_logs` | 전체 정규화 로그 | 3,075 |
| `t5t_log_project_links` | 프로젝트 링크 | 444 |
| `t5t_log_stakeholders` | 이해관계자 링크 | 702 |

일반업무와 매칭 성공을 함께 보면 유효 분류 건수는 `1,386 + 901 = 2,287건`, 전체 3,075건 중 약 74.4%다.

A/B 라인 2026년 잔여 미매칭:

| 라인 | 별칭 보정 전 | 별칭 보정 후 | 주요 잔여 |
|---|---:|---:|---|
| A Line | 124 | 83 | 수협 노량진, 안성 산하리, 홍대 L타워, 상암 DMC, 부천 소형 DC 등 |
| B Line | 73 | 7 | `-` 일반 서술 5건, `[ILIP]` 1건, `[기타 / 물류섹터 관련]` 1건 |

A Line의 `수협 노량진`, `안성 산하리`, `상암`, `부천 소형 DC`는 사용자가 신규 프로젝트에 있다고 지적했으나, 현재 SQL `projects/funds/asset_master` 검색 기준으로는 정확한 대상이 확인되지 않았다. 이는 Notion 신규 프로젝트 원천에는 있으나 SQL 마스터로 아직 동기화되지 않았거나, SQL 내 명칭이 다른 이름으로 들어간 상태일 가능성이 높다.

## 11. 미션 분류와 C2/D/D-TF 라인 보정

프로젝트와 직접 연결되지는 않지만 일반업무로 보기 어려운 회사 차원의 과제를 `match_status='mission'`, `task_type='미션'`으로 분류하도록 추가했다. `normalize_t5t_logs.py`도 `mission`을 수동확인 불필요 상태로 처리한다.

반영 결과:

| 라인 | 2026년 전체 | matched | mission | general_work | raw_unmatched |
|---|---:|---:|---:|---:|---:|
| C2 Line | 81 | 75 | 3 | 2 | 1 |
| D Line | 130 | 112 | 6 | 12 | 0 |
| D-TF Line | 5 | 5 | 0 | 0 | 0 |

C2 Line에서 `미션`으로 분류한 항목:

- 삼성전자 AI Ready 디지털트윈 작업 지원
- 팩토리얼 성수 테크 솔루션/삼성전자 디지털트윈 후속작업 대응
- T5T Contents

D Line에서 `미션`으로 분류한 항목:

- 산단환경개선펀드/산업단지공단 관련 시장현황, 제도/운용사 협의
- 개발플랫폼: 물류·데이터센터 프로젝트 현황, CF Model/Funding/공사비 분석
- 당사 물류자산 Lease-up 방안 협의

D-TF Line은 2026년 5건 전부 이오타 관련으로 정리된다. 4건은 `iota-seoul` 프로젝트로 직접 매칭했고, 1건은 기존에 `421호` 펀드(`112614`)로 이미 매칭되어 있었다.

잔여 확인 필요:

- C2 Line `광화문 K-Project 신규 딜` 1건은 현재 SQL 마스터에서 확정 대상이 확인되지 않아 `raw_unmatched`로 남겼다.
- C2 Line `용산프라임 임차`, `케이트윈타워/The Quad`는 현재 SQL 마스터 확정 대상이 없어 `general_work` 상태로 남아 있다.

## 12. E Line 운용자산 별칭 보강

E Line의 2026년 잔여 미매칭 71건은 대부분 프로젝트 개발명이 아니라 운용자산/펀드/포트폴리오 약칭이었다. `t5t_manual_aliases.json`에 다음 자산운용 별칭을 보강하고, 신규 Notion 동기화 스크립트(`sync_notion_raw_to_sql.py`)도 같은 별칭 사전을 먼저 적용하도록 변경했다.

주요 보강 별칭:

- `남산소월/남산소월타워 -> 남산소월타워`
- `몰오브케이 -> 건대 몰오브케이`
- `원그로브 -> 마곡 원그로브`
- `양지물류/VPLEX -> 아레나스 양지 또는 V플렉스`
- `OPUS459/백암빌딩`, `OPUS407/오퍼스407`
- `평택아디다스 -> 평택 아디다스 물류센터`
- `원센티널`, `논현두산`, `창원두동`, `여주본두리`, `지밸리`
- `코어플랫폼`, `인컴앤그로스`, `안성홈플러스`, `인천석남물류`
- `용산나진/용산특계8 -> 팩토리얼 용산`
- `Exit TF`, `홈플러스 자산`, `회계/세무 이슈 관리`, `CJ CGV 미디어사업`, `중소기업중앙회 블라인드펀드` 등은 `미션`

반영 결과:

| 범위 | 보정 전 raw_unmatched | 보정 후 raw_unmatched |
|---|---:|---:|
| E Line 2026 | 71 | 6 |
| 전체 2026 | 207 | 142 |
| 전체 기간 | 729 | 664 |

E Line 2026 최종 상태:

| 상태 | 건수 |
|---|---:|
| `matched` | 177 |
| `mission` | 15 |
| `general_work` | 11 |
| `raw_unmatched` | 6 |

잔여 6건은 현재 SQL 마스터에서 정확한 대상이 확인되지 않은 자산명이다.

- 평촌 지스퀘어 2건
- 고양스타필드/지스퀘어 1건
- 선릉 Wework타워 1건
- 부산 비스퀘어 1건
- 코너136(홍대 화평빌딩) 1건

## 13. 주기 실행 파이프라인

T5T 처리 과정을 `01. RA Portal/run_t5t_pipeline.py`로 묶었다. 운영 순서는 다음과 같다.

1. `sync_notion_raw_to_sql.py`: Notion 원본 T5T를 `t5t_form_submissions`, `t5t_form_items`에 적재한다.
2. `apply_t5t_manual_aliases.py`: 별칭 사전 기준으로 프로젝트/펀드/미션/특수 일반업무를 우선 매칭한다.
3. `apply_t5t_manual_aliases.py --status general_work`: 과거 일반업무로 들어간 항목 중 별칭으로 프로젝트/미션 승격 가능한 항목을 재분류한다.
4. `classify_t5t_general_work.py`: 남은 비프로젝트성 업무를 일반업무로 분류한다.
5. `match_t5t_entities.py`: 남은 항목을 `projects`, `funds`, `asset_master`와 재매칭한다. `mission`은 재매칭 대상에서 제외한다.
6. `normalize_t5t_logs.py`: 대시보드용 `t5t_logs`, `t5t_log_project_links`, `t5t_log_stakeholders`를 갱신한다.

주차 계산은 기존 CSV 처리 기준과 동일하게 화요일~월요일을 1주로 본다. `week_end_date`는 해당 주의 월요일이며, `week_key`는 그 월요일의 ISO 주차를 사용한다. 예를 들어 2026-05-12(화)부터 2026-05-18(월)까지는 모두 `week_end_date=2026-05-18`, `week_key=2026-W21`이다.

GitHub Actions는 주간 운영 흐름에 맞춰 세 번 실행되도록 설정했다. 수동 실행은 `workflow_dispatch`, 외부 트리거는 `repository_dispatch: sync_notion_data`로 유지한다.

| 목적 | 한국시간 | UTC cron |
|---|---|---|
| 중간집계 | 토요일 00:00, 금요일 밤 12시 | `0 15 * * 5` |
| 1차완료 | 월요일 08:00 | `0 23 * * 0` |
| 최종완료 | 화요일 09:00 | `0 0 * * 2` |

현재 실행 결과:

| 항목 | 건수 |
|---|---:|
| `t5t_form_items.matched` | 1,536 |
| `t5t_form_items.general_work` | 863 |
| `t5t_form_items.mission` | 21 |
| `t5t_form_items.raw_unmatched` | 655 |
| `t5t_log_project_links` | 593 |
| 2026년 `raw_unmatched` | 134 |
