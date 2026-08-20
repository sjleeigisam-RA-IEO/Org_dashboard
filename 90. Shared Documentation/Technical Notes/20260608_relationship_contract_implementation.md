# 2026-06-08 RA Dashboard Relationship Contract Implementation

## Summary

Implemented a non-destructive relationship contract layer for the RA dashboard. The goal is deterministic search and display: the same canonical entity should appear once, with the same title and relationship path, regardless of whether the user starts from a broad search, direct fund code, asset alias, project, lender, or beneficiary.

## Implemented Artifacts

- `01. RA Portal/tools/data-reconciliation/build_20260608_relationship_contract.py`
  - Reads the six `00. Raw Data/*_20260608.xlsx` files through worksheet XML, ignoring broken Excel dimension metadata.
  - Emits raw source rows, normalized staging CSVs, relationship candidates, aliases, AUM snapshot facts, exposure facts, and contract audit rows.
- `01. RA Portal/migrations/2026-06-08_relationship_contract_v1.sql`
  - Adds non-destructive resolution fields to `asset_project_links`.
  - Creates explicit project/fund/pilot resolution views.
  - Rebuilds the dashboard search result contract through `portfolio_search_results_canonical`, a one-row-per-entity view with `relation_paths` provenance.
  - Replaces `asset_exposure_summary` with pre-aggregated lender/beneficiary joins to avoid N x M amount inflation.
  - Adds `relationship_contract_audit_v1` and search display contract audit views.
- Dashboard JS
  - Search result dedupe now uses stable entity keys rather than display names.
  - Final result grouping now uses stable entity IDs (`fund_id`, `asset_id`, `project_id`, exposure row id/name group) rather than `parent_fund_id` or display labels.
  - Search card titles/IDs use shared canonical display helpers.
  - Canonical asset result dedupe now prioritizes `asset_id`, not `name + address`.
  - Asset display names now prefer `physical_asset_name`; suppressed financial/security names fall back to `asset_code/asset_id`.
- `01. RA Portal/migrations/2026-06-09_asset_name_cleanup_contract.sql`
  - Adds a non-destructive asset-name contract.
  - Promotes only physical real estate names to `physical_asset_name`.
  - Suppresses financial instruments, securities, fund interests, and fund-like names from the physical asset-name contract while preserving the original `canonical_name` as provenance.
  - Adds `non_physical_asset_label`, proposed as instrument/security type plus linked fund short name, never the full fund name.
- `01. RA Portal/tools/data-reconciliation/plan_asset_name_cleanup.py`
  - Reads live `asset_master` and writes cleanup candidates/audit counts.
- `01. RA Portal/tools/data-reconciliation/verify_dashboard_search_determinism.js`
  - Verifies pure search/display contract without a browser.
  - Checks fund/asset/project ID convergence, institution card grouping, exposure row retention, and canonical title formatting.
- `01. RA Portal/tools/data-reconciliation/verify_relationship_contract_live_schema.py`
  - Verifies the live Supabase REST schema without mutating data.
  - Separates existing required surfaces from columns/views that are expected only after the SQL migrations are applied.

## Deterministic Search Contract

The dashboard search/result contract is:

| entity | grouping key | display title |
|---|---|---|
| fund | `fund_id` | `[short_name] fund_name` when both exist, otherwise `fund_name/short_name/fund_id` |
| asset | `asset_id` | `physical_asset_name`, otherwise `non_physical_asset_label` or `asset_code/asset_id` when the physical name is suppressed |
| project | `project_id` | `project_name/project_mission_name/project_id` |
| lender | exposure row id for row identity; institution name for relationship drawer grouping | `lender_clean/lender_raw` |
| beneficiary | exposure row id for row identity; institution name for relationship drawer grouping | `beneficiary_clean/beneficiary_raw` |

This means broad search, direct code search, alias search, and relationship-token search should converge to the same canonical card and title. Display strings are not lookup keys.

There are now two DB search grains:

| surface | grain | dashboard role |
|---|---|---|
| `portfolio_search_index` | raw searchable token/path row | provenance and emergency fallback |
| `portfolio_search_results_canonical` | one row per `entity_type/entity_id` | primary dashboard search surface |

`portfolio_search_results_canonical` keeps raw relationship paths in `relation_paths`, so a fund, asset, or project can have many matching paths without appearing as duplicate result cards.

## Asset Name Cleanup Contract

Current policy: asset names used for dashboard display/search should mean physical real estate names only.
For non-physical assets, the dashboard title should not copy the full fund name. It should use a compact label such as `전환사채/공모주/RCPS · 멀티인컴1호`, `펀드지분 · 세컨더리1호`, or `크레딧펀드 · 21호`.

| action | rows | meaning |
|---|---:|---|
| `keep_physical_name` | 944 | keep the current name as a physical real estate display name |
| `strip_instrument_terms` | 44 | keep the property/location part and remove loan/security wording |
| `suppress_non_physical_name` | 13 | hide non-physical financial/security asset names |
| `suppress_fund_like_name` | 90 | hide fund-like names with no address/PNU evidence |
| `suppress_financial_name` | 112 | hide financial/security names with no physical evidence |
| `review_financial_name_with_physical_evidence` | 29 | physical evidence exists, but the name still needs manual cleanup |
| `review_unknown_name` | 70 | not enough evidence for automatic promotion |

Generated artifacts:

- `01. RA Portal/output/asset_name_cleanup_20260609/asset_name_cleanup_candidates.csv`
- `01. RA Portal/output/asset_name_cleanup_20260609/asset_name_cleanup_plan.md`
- `01. RA Portal/output/asset_name_cleanup_20260609/asset_name_cleanup_summary.json`

## Generated Baseline

Generated under `01. RA Portal/output/relationship_contract_20260608/`:

| artifact | rows |
|---|---:|
| `source_raw_rows.csv` | 4,788 |
| `fund_master_staging.csv` | 1,111 |
| `asset_master_staging.csv` | 788 |
| `fund_asset_link_staging.csv` | 693 |
| `asset_alias_candidates.csv` | 1,281 |
| `fund_aum_snapshot_staging.csv` | 368 |
| `lender_exposure_staging.csv` | 687 |
| `beneficiary_exposure_staging.csv` | 1,139 |
| `relationship_contract_audit.csv` | 12 |

Key source contracts:

- `fund_master`: `펀드코드` unique, 1,111 / 1,111.
- `asset_master`: `자산코드` unique, 788 / 788.
- `fund_asset_link`: `펀드코드 + 순번` unique, 693 / 693.
- `fund_aum_snapshot`: `펀드코드` unique, 368 / 368.

Warnings intentionally preserved:

- 63 fund-asset rows match duplicate asset names and need review before canonical promotion.
- Lender and beneficiary natural keys are not unique enough, so exposure facts must retain row hash/source row identity.
- Comma-separated source fields remain display aggregates and are not used to generate relationships.

## Apply Status

The SQL migration was not applied to live Supabase because `public.exec_sql` is not exposed through REST (`404 Not Found`). Run the SQL files in Supabase SQL Editor in this order:

1. `01. RA Portal/migrations/2026-06-09_asset_name_cleanup_contract.sql`
2. `01. RA Portal/migrations/2026-06-08_portfolio_search_index.sql`
3. `01. RA Portal/migrations/2026-06-08_relationship_contract_v1.sql`

After applying, run:

```powershell
& 'C:\Users\10137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 01. RA Portal\tools\data-reconciliation\audit_dashboard_relationship_contract.py
& 'C:\Users\10137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 01. RA Portal\tools\data-reconciliation\verify_relationship_contract_live_schema.py
```

Current live read-only verification shows the existing base surfaces are available (`funds`, `asset_master`, `asset_fund_links`, `asset_project_links`, `projects`, exposures, `v_funds_enriched`). The new contract columns/views are not yet present on the server:

- `portfolio_search_results_canonical`
- `portfolio_search_index`
- `asset_project_link_resolution`
- `relationship_contract_audit_v1`
- `dashboard_search_result_contract_audit`
- `funds.primary_asset_ids`
- `projects.primary_asset_ids`
- `iota_seoul_log_links.metadata`
- `asset_project_links.target_code/target_type/resolved_project_id/resolved_fund_id/resolution_status/resolution_note`

The dashboard keeps fallback paths so the current UI does not fail before SQL apply. Deterministic relationship-aware discovery requires `portfolio_search_results_canonical` to exist in live Supabase. If that view is unavailable, the UI marks the mode as `raw_token_fallback` or `legacy_fallback` internally and the read-only audit reports the contract as missing.

## Verification

- `node --check` passed for:
  - `01. RA Portal/portfolio-analysis/js/search-results.js`
  - `01. RA Portal/portfolio-analysis/js/asset-canonical.js`
  - `01. RA Portal/portfolio-analysis/js/detail-drawer.js`
- `py_compile` passed for:
  - `01. RA Portal/tools/data-reconciliation/build_20260608_relationship_contract.py`
  - `01. RA Portal/tools/data-reconciliation/audit_dashboard_relationship_contract.py`
  - `01. RA Portal/tools/data-reconciliation/verify_relationship_contract_live_schema.py`
- Source staging script completed successfully and regenerated the baseline outputs.
- `node 01. RA Portal/tools/data-reconciliation/verify_dashboard_search_determinism.js` passed.
- Read-only live schema verification completed and wrote `01. RA Portal/output/relationship_contract_20260608/live_schema_verification.md`.
- Read-only dashboard relationship audit completed and wrote `01. RA Portal/output/dashboard_relationship_contract/dashboard_relationship_contract_audit.md`.
