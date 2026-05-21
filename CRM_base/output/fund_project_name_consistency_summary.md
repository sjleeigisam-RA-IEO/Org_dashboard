# 펀드명/프로젝트명 정합성 감사

- 기준 CSV: `ra_insight_db_asset_fund_project_relationships_cleanup.csv`
- 감사 행 수: 4601행
- DB funds: 1103개
- DB projects: 623개
- 후보/이슈 compact 행: 4440행
- 고유 펀드 이슈 키: 682개
- 고유 프로젝트 이슈 키: 1510개

## 큰 버킷

- fund_id 있는 행: 3919행
- fund_id 없는 행: 682행
- 실제 projects.project_id 행: 852행
- fund_id가 project_id로 들어간 pseudo project 행: 2827행
- project_id 없는 행: 922행
- fund_id는 있으나 project_id 없는 행: 240행
- 실제 project_id 행 중 추가 플래그가 있는 행: 9행

## 펀드명 이슈

| flag | row count |
|---|---:|
| `fund_missing_no_id` | 682 |

## 프로젝트명 이슈

| flag | row count |
|---|---:|
| `project_id_is_fund_id_pseudo_project` | 2827 |
| `project_missing_no_id` | 922 |
| `project_name_vehicle_like` | 674 |
| `project_name_mismatch_fund_context` | 175 |

## 결론

- 펀드명은 `fund_id`가 있는 행에서는 DB `funds.fund_name`과 불일치가 없습니다. 현재 문제는 682행의 펀드 관계 자체가 비어 있는 것입니다.
- 프로젝트명도 실제 `projects.project_id`가 있는 852행에서는 DB 프로젝트명과의 불일치가 없습니다.
- 가장 큰 문제는 2,827행의 `project_id_is_fund_id_pseudo_project`입니다. 이 행들은 실제 프로젝트가 아니라 펀드/비히클 맥락에서 온 표시명으로 분리해야 합니다.
- `project_missing_no_id` 922행 중 240행은 fund_id는 있으나 project_id가 없으므로, 펀드 drawer에서 프로젝트 없음 또는 프로젝트 후보 발굴 대상으로 다루면 됩니다.

## 해석

- `fund_missing_no_id`: 해당 asset row에 연결된 fund_id 자체가 없습니다. 이름 보정이 아니라 관계 발굴 문제입니다.
- `fund_name_blank_fill_from_db` / `fund_name_mismatch_db`: fund_id가 있으므로 DB funds 기준으로 CSV 표시명을 채울 수 있습니다.
- `project_missing_no_id`: 해당 asset row에 project_id 자체가 없습니다. 프로젝트 관계 발굴 문제입니다.
- `project_id_is_fund_id_pseudo_project`: 현재 project_id가 실제 projects.project_id가 아니라 fund_id입니다. 프로젝트 테이블의 실제 프로젝트가 아니라 fund context/pseudo project로 분리 표시해야 합니다.
- `project_name_vehicle_like`: 프로젝트명 칸에 펀드/비히클성 명칭이 들어간 것으로 보여 drawer 표시에서는 프로젝트와 비히클을 분리해야 합니다.