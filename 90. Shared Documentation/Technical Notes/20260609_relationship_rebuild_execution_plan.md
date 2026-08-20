# RA Dashboard Relationship Rebuild Execution Plan

Generated: 2026-06-09

## Goal

Make the database expose a clean, deterministic relationship table set for the dashboard without changing source information columns.

The dashboard should return the same canonical result regardless of whether a user starts from a fund, asset, project, lender, beneficiary, alias, or code. If the underlying data is not duplicated, relationships alone should be enough to retrieve the correct connected records.

## Current Diagnosis

Live DB already has source data and several link tables:

- `funds` / `v_funds_enriched`: fund master surface
- `asset_master`: asset master surface
- `asset_fund_links`: fund-to-asset link table
- `asset_project_links`: asset-to-target link table
- `projects`: project master surface
- `lender_exposures`, `beneficiary_exposures`: exposure fact surfaces

The main issue is not missing source records. The issue is that relationship meaning is mixed and the dashboard reads too many raw surfaces directly.

Observed current state:

- `asset_fund_links` has no orphan asset/fund rows in the latest audit.
- `asset_project_links.project_id` is not a pure project foreign key. It currently mixes:
  - actual `projects.project_id`
  - `funds.fund_id` used as a project-like target
- parent projects such as `iota-seoul` require expansion through child projects before related assets and funds are visible.
- exposure rows are reliable by `fund_id`, but some rows do not carry direct `asset_id`; these need fund-derived asset links.
- canonical search views are not yet live, so the dashboard still falls back to separate table searches and can miss relationships or show duplicates.

## Non-Negotiable Rules

1. Source columns are preserved.
2. Relationship columns and relationship views may be rebuilt aggressively.
3. Names, comma-separated strings, addresses, and free text are not relationship keys.
4. Canonical keys are:
   - fund: `fund_id`
   - asset: `asset_id`, with `asset_code` as source/business identifier
   - project: `project_id`
   - exposure: source row identity or stable exposure id
5. The dashboard must not infer relationships from display titles.
6. Search result identity is always `entity_type + entity_id`.
7. Search display is deterministic and deduplicated.

## Target DB Table Set

### 1. Preserved Source/Master Layer

These remain the source-bearing tables. Existing source columns are not removed or overwritten for cleanup purposes.

| table/view | role | source columns policy |
|---|---|---|
| `funds` | fund master | preserve |
| `v_funds_enriched` | fund display/hydration view | preserve |
| `asset_master` | asset master | preserve existing source columns; add display/relationship helper columns only |
| `projects` | project master | preserve |
| `lender_exposures` | lender exposure fact | preserve |
| `beneficiary_exposures` | beneficiary exposure fact | preserve |
| source snapshot/staging tables | provenance and reload trail | preserve |

### 2. Canonical Relationship Layer

These are the tables/views the dashboard relationship logic should trust.

| table/view | grain | purpose |
|---|---|---|
| `asset_fund_links` | one fund-asset relationship | canonical fund-to-asset edge |
| `asset_project_link_resolution` | one raw asset-project-link row with resolved meaning | interprets mixed `asset_project_links.project_id` |
| `project_asset_relationships` | one resolved project-asset relationship | pure project-to-asset edge for dashboard |
| `fund_as_project_asset_relationships` | one fund-like target-to-asset relationship | legacy compatibility edge, explicitly typed |
| `asset_exposure_edges` | one direct or derived exposure-to-asset edge | prevents exposure duplication while allowing asset lookup |
| `asset_relationship_summary` | one asset summary row | asset hydration surface |
| `fund_relationship_summary` | one fund summary row | optional fund drawer/search hydration surface |
| `project_relationship_summary` | one project summary row | optional project drawer/search hydration surface |
| `relationship_index_entities` | one interpreted searchable/display entity | canonical entity catalog for dashboard retrieval |
| `relationship_index_edges` | one interpreted relationship edge | graph layer connecting funds, assets, projects, lenders, and beneficiaries |
| `relationship_index_tokens` | one propagated search token/path | searchable relationship-aware token layer |
| `relationship_index_search_results` | one `entity_type + entity_id` result | final deduplicated result set before dashboard hydration |
| `relationship_index_audit` | one review/audit issue | unresolved/review/rollup-disabled relationship queue |

### 3. Search Contract Layer

The dashboard should search this layer first and only use legacy fallback when the contract view is missing.

| table/view | grain | purpose |
|---|---|---|
| `portfolio_search_index` | one raw searchable token/path | provenance, debugging, path evidence |
| `portfolio_search_results_canonical` | one `entity_type + entity_id` | actual dashboard search result surface |
| `dashboard_search_result_contract_audit` | one detected search contract issue | duplicate/missing-display audit |

## Relationship Column Rebuild

### `asset_project_links`

Keep existing source columns, but stop treating `project_id` as a direct FK.

Add relationship interpretation columns:

| column | meaning |
|---|---|
| `target_code` | copied/interpreted value from the mixed target field |
| `target_type` | `project`, `fund_as_project`, `pilot_code`, `review_project`, `unresolved` |
| `resolved_project_id` | populated only when the target resolves to `projects.project_id` |
| `resolved_fund_id` | populated only when the target resolves to `funds.fund_id` |
| `resolution_status` | `resolved`, `ambiguous`, `unresolved`, `review_required` |
| `resolution_note` | human-readable reason/evidence |

Dashboard rule:

- use `asset_project_link_resolution`, not raw `asset_project_links.project_id`
- parent project lookup expands `parent_project -> child project -> asset -> fund`
- `fund_as_project` remains visible only as a typed compatibility route

### `funds` and `projects`

Add array helper columns only as fallback, not as primary relationship truth:

| table | column | role |
|---|---|---|
| `funds` | `primary_asset_ids` | multi-asset fallback when link table is absent/incomplete |
| `projects` | `primary_asset_ids` | multi-asset fallback when resolved project links are absent/incomplete |

Dashboard rule:

- prefer link tables
- use `primary_asset_id` / `primary_asset_ids` only after canonical links are empty

### Exposure Edges

Create a view that normalizes lender and beneficiary exposure relationships:

| edge type | rule |
|---|---|
| direct asset exposure | exposure row has `asset_id` |
| derived asset exposure | exposure row has no `asset_id`, but `fund_id -> asset_fund_links -> asset_id` resolves |

Required fields:

- `exposure_type`: `lender` or `beneficiary`
- `exposure_id` or stable source row id
- `fund_id`
- `asset_id`
- `link_method`: `direct_asset_id` or `derived_via_fund_asset_link`
- `allocation_status`: `direct`, `derived`, `multi_asset_review_required`

Dashboard rule:

- direct and derived edges are shown separately in provenance
- summary totals dedupe by exposure row identity before aggregation

## Asset Display Contract

This does not delete source names. It only separates physical names from non-physical labels.

Add helper columns to `asset_master`:

| column | role |
|---|---|
| `physical_asset_name` | real estate display name only |
| `non_physical_asset_label` | securities/fund-interest/credit style label |
| `asset_name_cleanup_action` | `keep`, `strip`, `suppress`, `review` style action |
| `asset_name_cleanup_reason` | audit reason |

Display priority:

1. `physical_asset_name`
2. `non_physical_asset_label`
3. `asset_code`
4. `asset_id`

Non-physical naming rule:

- do not copy full fund names into asset names
- use `instrument/product type + fund short name`
- examples:
  - `전환사채/공모주/RCPS · 멀티인컴1호`
  - `펀드지분 · 세컨더리1호`
  - `크레딧펀드 · 21호`

## Dashboard Query Contract

### Search

Dashboard search should run in this order:

1. Query `portfolio_search_results_canonical`
2. Hydrate by `entity_type + entity_id`
3. If canonical view is missing, use `portfolio_search_index`
4. If both contract views are missing, use legacy fallback with internal state `legacy_fallback`

The displayed search card key is:

```text
entity_type + ':' + entity_id
```

Multiple matching tokens become `relation_paths`; they do not become duplicate cards.

### Drawer Routes

| drawer | primary route |
|---|---|
| Fund | `fund_id -> asset_fund_links -> asset_master` |
| Asset | `asset_id -> asset_fund_links`, `project_asset_relationships`, `asset_exposure_edges` |
| Project | `project_id -> child projects -> project_asset_relationships -> asset_fund_links` |
| Lender | exposure row -> fund -> asset edges |
| Beneficiary | exposure row -> fund -> asset edges |

Legacy fallback rules:

- `fund_assets` is display-only fallback, not canonical truth.
- `project_id = fund_id` is not used unless the relationship has `target_type = fund_as_project`.
- raw title/name matching is only a discovery token, not a link.

## IOTA Required Behavior

Canonical relationship path:

```text
iota-seoul
  -> child projects
    -> iota-427 -> ast_cd9937cc8678 -> funds 112706, 112707, 120016, 112614, 120113
    -> iota-421f -> ast_aefd81e93778 -> funds 112057, 112472, 112473
```

Required dashboard behavior:

- searching `이오타서울` returns the parent project once
- child projects are included in relation paths
- linked assets are returned once per asset
- related funds are returned once per fund
- drawer follows the same path and does not rely on title equality

## Execution Phases

### Phase 0. Freeze and Audit

Deliverables:

- baseline counts for master/link/fact tables
- orphan checks for `asset_fund_links`
- mixed-target classification for `asset_project_links`
- duplicate search-card audit from current dashboard logic

Gate:

- baseline audit file exists and can be regenerated

### Phase 1. Add Relationship Interpretation Columns

Deliverables:

- add non-destructive columns to `asset_project_links`
- add fallback array columns to `funds` and `projects`
- populate target interpretation without deleting source fields
- create `asset_project_link_resolution`

Gate:

- every `asset_project_links` row classified as one of:
  - `project`
  - `fund_as_project`
  - `pilot_code`
  - `review_project`
  - `unresolved`

### Phase 2. Rebuild Canonical Views

Deliverables:

- `project_asset_relationships`
- `fund_as_project_asset_relationships`
- `asset_exposure_edges`
- corrected `asset_exposure_summary`
- corrected `asset_relationship_summary`

Gate:

- IOTA parent-child-asset-fund route is visible from SQL alone
- exposure rows without direct `asset_id` can be traced by fund-derived asset edge

### Phase 3. Rebuild Search Contract

Deliverables:

- `portfolio_search_index`
- `portfolio_search_results_canonical`
- `dashboard_search_result_contract_audit`

Gate:

- no duplicate cards by `entity_type + entity_id`
- search paths remain visible in `relation_paths`
- short numeric searches are restricted to code-like tokens

### Phase 4. Update Dashboard Logic

Deliverables:

- search uses `portfolio_search_results_canonical` first
- card click routes by `entity_type + entity_id`
- fund/project/asset drawers use canonical relationship routes
- legacy fallback is visibly marked internally

Gate:

- same entity appears once even if matched through multiple paths
- drawer and search use the same relationship route

### Phase 5. Regression and Contract Tests

Required scenarios:

| query | expected behavior |
|---|---|
| `이오타서울` | parent project, child assets, related funds are traceable |
| `눈스퀘어` | fund, asset, project converge through the same asset |
| `국민연금` | beneficiary rows connect to fund and derived/direct assets |
| `홈플러스` | multiple assets/funds/projects group without duplicate cards |
| `1120` | code-centered results without broad asset noise |
| `멀티플러스`, `그린ON`, `NPL` | existing new fund search still works |

## Implementation Order

Apply SQL in this order:

1. `01. RA Portal/migrations/2026-06-09_asset_name_cleanup_contract.sql`
2. `01. RA Portal/migrations/2026-06-08_portfolio_search_index.sql`
3. `01. RA Portal/migrations/2026-06-08_relationship_contract_v1.sql`
4. `01. RA Portal/migrations/2026-06-09_relationship_index_v1.sql`

Then run:

1. live schema verification
2. dashboard relationship audit
3. search determinism test
4. targeted IOTA/known-query checks

## Success Definition

The rebuild is successful only when all are true:

- source data columns are preserved
- canonical relationship views exist in live DB
- dashboard search starts from `portfolio_search_results_canonical`
- search cards are unique by `entity_type + entity_id`
- relationship paths are visible but not duplicated as cards
- project drawer resolves parent/child assets and related funds
- asset drawer shows fund/project/exposure from the same asset relationship contract
- exposure links distinguish direct and fund-derived asset relationships
- audit views report remaining unresolved rows separately from normal results

## Open Risk

The current local implementation can define the contract, but live Supabase still needs SQL application through SQL Editor or another privileged DB execution path. Until the SQL is applied, the dashboard must continue using fallback mode, and the DB itself will not expose the clean relationship table set.
