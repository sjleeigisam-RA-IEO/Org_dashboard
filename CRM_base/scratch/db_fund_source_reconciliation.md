# DB-Fund Source Reconciliation

## DB funds Summary

- rows: 580
- unique funds: 580
- status counts: {'운용': 536, '청산': 36, '미설정': 7, '(blank)': 1}
- DB metadata benchmark_aum non-null: 377
- DB metadata benchmark_aum positive: 374
- DB metadata benchmark_aum sum: 72,977,731,926,291
- project_mission_name non-null: 221

## Source Coverage

| Source | Source funds | DB intersection | DB only | Source only |
|---|---:|---:|---:|---:|
| fund_management_20260424 | 1,099 | 579 | 1 | 520 |
| aum_all_20251224 | 863 | 546 | 34 | 317 |
| aum_active_20260112 | 377 | 377 | 203 | 0 |

## Status Mismatches

- `fund_management_20260424`: overlap 579, diff 0
- `aum_all_20251224`: overlap 546, diff 17
- `aum_active_20260112`: overlap 377, diff 17

## AUM Reconciliation

- `aum_all_20251224`: overlap 546, DB AUM non-null 376, source AUM non-null 546, exact match 316, total abs diff 8,825,265,665,487
- `aum_active_20260112`: overlap 377, DB AUM non-null 377, source AUM non-null 376, exact match 377, total abs diff 0

## Interpretation

- The current `funds` table is not a complete lifecycle universe. It contains 580 funds versus 1,099 funds in the fund management source.
- The DB is suitable for current dashboard search/exposure analysis, but it is not sufficient for lifecycle, liquidation, or runoff analysis without adding lifecycle and AUM snapshot tables.
- Fund management should be treated as the master universe for lifecycle/status/date fields.
- AUM files should be treated as dated financial snapshots, not as the master fund universe.
- Tomorrow's updated AUM file should be loaded as an additional snapshot rather than overwriting historical AUM files.
