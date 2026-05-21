# 자산 위치/PNU/건축물대장 업데이트 후보 비교

- 입력 후보: `asset_name_recovery_adoption_candidates.csv`
- 출력 CSV: `asset_location_building_update_candidates.csv`
- 전체 후보 행: 329행
- 제안 위치값 보유: 302행
- 기존 asset_master 위치값 보유(PNU+좌표): 302행
- asset_master 위치 갱신 필요 후보: 284행
- 제안 PNU 기준 건축물대장 재조회/연결 필요 후보: 278행
- 같은 asset_id+PNU의 기존 ledger 존재: 24행
- 같은 PNU의 ledger가 다른 asset_id 등에 존재: 54행

## 권장 DB 작업 유형

| recommended_db_action | 행 수 |
|---|---:|
| `create_or_link_underlying_asset_with_location` | 283 |
| `update_existing_asset_master_location` | 19 |
| `create_or_link_underlying_asset_name_only` | 14 |
| `update_name_only_pending_location` | 7 |
| `adopt_name_only_pending_location` | 6 |

## 후보 출처

| adoption_source | 행 수 |
|---|---:|
| `domestic_excel_fund_code_match` | 296 |
| `worklist_proposed_name_unmatched` | 27 |
| `worklist_proposed_name_matched_domestic_excel_by_name` | 6 |

## 주의

- `split_or_drawer_list` 행은 같은 `asset_id`에 여러 PNU를 덮어쓰는 용도가 아닙니다. 별도 underlying asset 생성 또는 기존 underlying asset 연결 후보로 봐야 합니다.
- `needs_building_ledger_fetch_by_pnu=true`인 행은 제안 PNU는 있으나 같은 `asset_id+pnu` ledger가 없어 건축물대장 재조회 또는 ledger row 연결 검토가 필요합니다.
- `has_any_ledger_for_proposed_pnu=true`인데 같은 asset_id ledger가 없는 행은 동일 PNU 정보가 DB 어딘가에 이미 있으므로 중복 생성 전에 병합 가능성을 봐야 합니다.