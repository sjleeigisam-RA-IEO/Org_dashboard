# 프로젝트명 정리 기준 CSV

- 기준 관계 행: 4601행
- 출력: `project_name_cleanup_basis.csv`
- 프로젝트 검토 후보: `project_name_cleanup_review_candidates.csv` (1761행)

## 펀드명 상태

| status | row count |
|---|---:|
| `fund_name_verified` | 3919 |
| `missing_fund_relationship` | 682 |

## 프로젝트 표시 분류

| class | row count |
|---|---:|
| `pseudo_project_same_as_asset` | 1248 |
| `missing_project_relationship` | 922 |
| `actual_project_keep` | 843 |
| `pseudo_project_business_label` | 749 |
| `pseudo_project_vehicle_or_fund_context` | 694 |
| `pseudo_project_display_label` | 136 |
| `actual_project_vehicle_like_review` | 9 |

## 작업 원칙

- 펀드명은 `fund_id`가 있는 행에서 DB 기준으로 검증되었으므로 `final_fund_name`을 기준으로 사용합니다.
- 자산명은 수동 판단까지 반영한 `final_asset_name`을 기준으로 사용합니다.
- 프로젝트명은 실제 프로젝트, pseudo fund context, 누락 관계를 분리합니다.
- `pseudo_project_*`는 실제 프로젝트 row로 간주하지 않고 drawer의 fund context 또는 business label로 표시합니다.
- `missing_project_relationship`은 이름을 억지 생성하기보다 프로젝트 관계 발굴 대상으로 둡니다.