# 자산 위치/PNU/건축물대장 병합 계획

- 입력 대조표: `asset_location_building_update_candidates.csv`
- 출력 병합 계획: `asset_location_merge_plan.csv`
- 전체 후보 행: 329행

## 액션별 건수

| merge_action | count |
|---|---:|
| `create_underlying_asset_then_fetch_ledger` | 242 |
| `link_existing_underlying_asset_by_pnu` | 30 |
| `create_or_link_underlying_asset_name_only` | 14 |
| `update_asset_master_location` | 13 |
| `link_existing_underlying_asset_same_asset_pnu` | 11 |
| `update_asset_name_only` | 7 |
| `hold_name_only_no_location` | 6 |
| `update_asset_master_then_fetch_ledger` | 6 |

## 위험도

| risk_level | count |
|---|---:|
| `medium` | 278 |
| `review` | 25 |
| `low` | 20 |
| `hold` | 6 |

## 대상 테이블 기준 후보 수

| table | candidate rows |
|---|---:|
| `asset_master` | 312 |
| `asset_fund_links` | 297 |
| `fund_assets` | 283 |
| `asset_building_ledger` | 248 |
| `search_alias_or_asset_name` | 6 |

## 병합 순서 제안

1. `update_asset_name_only`, `update_asset_master_location`부터 반영합니다.
2. `update_asset_master_then_fetch_ledger`는 asset_master 갱신 후 PNU 기준 건축물대장 재조회 큐에 넣습니다.
3. `link_existing_underlying_asset_by_pnu`는 같은 PNU의 기존 asset/ledger를 먼저 확인하고 관계만 연결합니다.
4. `create_underlying_asset_then_fetch_ledger`는 다자산 펀드 하위자산으로 신규 asset을 만들고 fund link 후 ledger를 조회합니다.
5. `hold_name_only_no_location`은 검색 별칭/표시명만 반영하고 위치/PNU 업데이트에서는 제외합니다.

## 주의

- `create_or_link_underlying_*` 계열은 기존 대표 asset_id에 PNU를 덮어쓰면 안 됩니다.
- 같은 PNU가 이미 DB에 있는 행은 신규 생성보다 기존 asset/ledger 재사용을 우선 검토합니다.
- 이 파일은 실행 계획표이며, 아직 Supabase 업데이트를 수행하지 않습니다.