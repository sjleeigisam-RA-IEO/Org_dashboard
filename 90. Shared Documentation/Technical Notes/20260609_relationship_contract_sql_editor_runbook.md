# RA Dashboard Relationship Contract SQL Editor Runbook

Generated: 2026-06-09

## Purpose

Apply the relationship/search contract to live Supabase so the dashboard can query one clean DB surface instead of stitching raw tables together in the browser.

This runbook does not delete source information columns. It adds helper columns and replaces/creates contract views.

## Pre-Apply Evidence

Latest read-only schema gate:

- existing required surfaces: available
  - `funds`
  - `v_funds_enriched`
  - `asset_master`
  - `asset_aliases`
  - `asset_fund_links`
  - `asset_project_links`
  - `projects`
  - `lender_exposures`
  - `beneficiary_exposures`
  - `iota_seoul_log_links`
- contract surfaces: not yet live
  - `portfolio_search_results_canonical`
  - `portfolio_search_index`
  - `asset_project_link_resolution`
  - `asset_exposure_edges`
  - `relationship_contract_audit_v1`
  - `dashboard_search_result_contract_audit`

The pre-apply report is regenerated at:

```text
01. RA Portal/output/relationship_contract_20260608/live_schema_verification.md
```

## Apply Order

Run these files in Supabase SQL Editor in this exact order.

### 1. Asset Name Display Contract

```text
01. RA Portal/migrations/2026-06-09_asset_name_cleanup_contract.sql
```

Creates/adds:

- `asset_master.physical_asset_name`
- `asset_master.non_physical_asset_label`
- `asset_master.asset_name_cleanup_action`
- `asset_master.asset_name_cleanup_reason`
- `asset_master.asset_name_cleaned_at`
- `asset_name_contract`
- `asset_name_cleanup_audit`
- refreshed `asset_relationship_summary`

Expected effect:

- physical real estate names become dashboard asset titles
- non-physical assets use instrument/product labels
- original `canonical_name` remains as provenance

### 2. Raw Search Token Surface

```text
01. RA Portal/migrations/2026-06-08_portfolio_search_index.sql
```

Creates/replaces:

- `portfolio_search_index`
- initial `portfolio_search_results_canonical`
- `dashboard_relationship_contract_audit`

Expected effect:

- dashboard can discover fund/asset/project/lender/beneficiary tokens
- canonical result view groups duplicate raw tokens by `entity_type + entity_id`

### 3. Relationship Resolution Contract

```text
01. RA Portal/migrations/2026-06-08_relationship_contract_v1.sql
```

Creates/adds:

- `funds.primary_asset_ids`
- `projects.primary_asset_ids`
- `iota_seoul_log_links.metadata`
- `asset_project_links.target_code`
- `asset_project_links.target_type`
- `asset_project_links.resolved_project_id`
- `asset_project_links.resolved_fund_id`
- `asset_project_links.resolution_status`
- `asset_project_links.resolution_note`
- `asset_project_link_resolution`
- `project_asset_relationships`
- `fund_as_project_asset_relationships`
- `asset_exposure_edges`
- refreshed `asset_exposure_summary`
- `iota_target_resolution`
- final `portfolio_search_results_canonical`
- `dashboard_search_result_contract_audit`
- `relationship_contract_audit_v1`

Expected effect:

- mixed `asset_project_links.project_id` is no longer treated as a direct project FK
- parent project routes such as `iota-seoul -> child project -> asset -> fund` become SQL-visible
- exposure rows without direct `asset_id` can be traced through `fund_id -> asset_fund_links`
- search results remain one row per `entity_type + entity_id`

### 4. Confirmed Relationship Index

```text
01. RA Portal/migrations/2026-06-09_relationship_index_v1.sql
```

Creates/replaces:

- `relationship_index_entities`
- `relationship_index_edges`
- `relationship_index_tokens`
- `relationship_index_search_results`
- `relationship_index_audit`
- final `portfolio_search_results_canonical` backed by the relationship index

Expected effect:

- interpreted entity rows are separated from interpreted relationship edges
- all search tokens point back to canonical entities
- parent project tokens propagate through `parent -> child -> asset -> fund`
- direct/derived exposure edges remain searchable, while amount rollup is disabled for review-required fanout

### 5. Search Result Cache

```text
01. RA Portal/migrations/2026-06-09_relationship_index_search_cache.sql
```

Creates/replaces:

- `relationship_index_search_results_cache`
- indexed `relationship_index_search_results`
- indexed `portfolio_search_results_canonical`

Expected effect:

- final search result aggregation is computed once instead of on every Supabase REST request
- dashboard searches use a one-row-per-canonical-entity cached surface
- `token_text` search has a trigram index for responsive `ilike` lookup

### 6. Non-Physical Label Noise Hotfix

```text
01. RA Portal/migrations/2026-06-09_asset_nonphysical_label_suffix_hotfix.sql
```

Updates/refreshes:

- removes trailing asset-code suffixes such as `A112...` from `asset_master.non_physical_asset_label`
- refreshes `relationship_index_search_results_cache`

Expected effect:

- non-physical asset labels stay at `instrument + fund short label`
- short numeric searches avoid asset-code noise and remain fund/project centered

### 7. Relationship Audit Cache

```text
01. RA Portal/migrations/2026-06-09_relationship_audit_cache.sql
```

Creates/replaces:

- `relationship_index_audit_cache`
- indexed `relationship_index_audit`

Expected effect:

- relationship audit rows are available through Supabase REST without statement timeout
- dashboard search remains unchanged; this is a verification/reporting performance patch

## Post-Apply Verification

After SQL Editor completes, wait briefly for Supabase/PostgREST schema cache refresh, then run these from the repo root:

```powershell
& 'C:\Users\10137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 01. RA Portal\tools\data-reconciliation\verify_relationship_contract_live_schema.py
```

Expected:

- `portfolio_search_results_canonical`: available
- `portfolio_search_index`: available
- `asset_project_link_resolution`: available
- `asset_exposure_edges`: available
- `relationship_index_entities`: available
- `relationship_index_edges`: available
- `relationship_index_tokens`: available
- `relationship_index_search_results`: available
- `relationship_index_audit`: available
- `relationship_contract_audit_v1`: available
- `dashboard_search_result_contract_audit`: available

Then run:

```powershell
& 'C:\Users\10137\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 01. RA Portal\tools\data-reconciliation\audit_dashboard_relationship_contract.py --limit 20
```

Expected:

- query summary no longer reports `portfolio_search_results_canonical unavailable`
- `이오타서울` returns canonical project/asset/fund candidates
- `눈스퀘어`, `국민연금`, `홈플러스`, `1120` produce grouped result rows without duplicate entity cards

Then run local dashboard search logic check:

```powershell
& 'C:\Users\10137\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 01. RA Portal\tools\data-reconciliation\verify_dashboard_search_determinism.js
```

Expected:

```json
{
  "ok": true
}
```

## Dashboard Behavior After Apply

Search:

1. `portfolio_search_results_canonical`
2. `portfolio_search_index`
3. legacy fallback only when contract views are unavailable

Drawer:

- Fund: `fund_id -> asset_fund_links -> asset_master`
- Asset: `asset_id -> fund/project/exposure edges`
- Project: `project_id -> child projects -> project_asset_relationships -> asset_fund_links`
- Exposure: exposure row -> fund -> asset edge

## Rollback Shape

This migration is additive for columns and replace-based for views.

If the search contract needs to be disabled temporarily:

1. leave source/master/link/fact tables as-is
2. restore the previous dashboard bundle or let the dashboard fall back to legacy mode
3. drop/recreate only views after review

Do not drop source tables or original source columns.

## Completion Gate

The relationship rebuild is complete only when:

- all post-apply contract surfaces are available in REST
- dashboard search uses `portfolio_search_results_canonical`
- result cards are unique by `entity_type + entity_id`
- IOTA parent-child-asset-fund route is visible from SQL and drawer
- exposure direct/derived asset links are auditable through `asset_exposure_edges`
- remaining unresolved rows are reported in audit views rather than silently hidden
