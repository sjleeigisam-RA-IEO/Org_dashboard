import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shellPartyId = "pty_fd1712a508dbd8e44c2441fd";

function parseEnv(text) {
  return Object.fromEntries(
    text.replace(/^\uFEFF/, "").split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const env = parseEnv(await fs.readFile(path.join(repoRoot, ".env"), "utf8"));
if (!env.SUPABASE_URL || !env.SUPABASE_TOKEN) {
  throw new Error("SUPABASE_URL or SUPABASE_TOKEN is missing from .env");
}

const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];
async function query(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const [contract] = await query(`
  select
    to_regclass('public.party_internal_fund_lookthrough_shell_target_v1') is not null as has_target_view,
    to_regclass('public.party_internal_fund_lookthrough_shell_resolution_v1') is not null as has_resolution_view,
    to_regclass('public.party_capital_scope_override_targets') is not null as has_target_scope_table,
    to_regclass('ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1') is not null as has_target_cache,
    to_regclass('public.party_internal_manager_capital_resolution_v1') is null as legacy_resolution_removed,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'party_exposure_external_current_v1'
        and column_name = 'is_internal_fund_lookthrough_shell'
    ) as has_shell_flag,
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'party_exposure_external_current_v1'
        and column_name = 'is_internal_manager_capital'
    ) as legacy_flag_removed
`);

const [shell] = await query(`
  with source as (
    select
      count(*)::bigint as rows,
      count(distinct source_row.fund_id)::bigint as funds,
      coalesce(sum(source_row.committed_amt), 0)::bigint as committed,
      coalesce(sum(source_row.invested_amt), 0)::bigint as invested,
      coalesce(sum(source_row.drawn_amt), 0)::bigint as drawn,
      coalesce(sum(source_row.remaining_amt), 0)::bigint as remaining,
      coalesce(sum(source_row.primary_amount), 0)::bigint as primary_amount
    from public.party_exposure_commitment_current source_row
    join public.party_capital_scope_override_targets target_scope
      on target_scope.party_id = source_row.party_id
     and target_scope.role_type = source_row.role_type
     and target_scope.fund_id = source_row.fund_id
    where target_scope.capital_scope = 'internal_fund_lookthrough_shell'
  ), surface as (
    select
      count(*)::bigint as rows,
      count(distinct fund_id)::bigint as funds,
      count(*) filter (where is_internal_fund_lookthrough_shell)::bigint as flagged_rows,
      count(*) filter (where not include_in_external_investor_rollup)::bigint as excluded_rows,
      count(*) filter (where include_in_external_investor_rollup)::bigint as included_rows,
      count(*) filter (where is_managed_fund_party)::bigint as managed_fund_overlap_rows,
      coalesce(sum(committed_amt), 0)::bigint as committed,
      coalesce(sum(invested_amt), 0)::bigint as invested,
      coalesce(sum(drawn_amt), 0)::bigint as drawn,
      coalesce(sum(remaining_amt), 0)::bigint as remaining,
      coalesce(sum(primary_amount), 0)::bigint as primary_amount
    from public.party_exposure_external_current_v1
    where role_type = 'beneficiary'
      and party_id = '${shellPartyId}'
  ), target as (
    select
      count(*)::bigint as funds,
      coalesce(sum(shell_rows), 0)::bigint as rows,
      count(*) filter (where lookthrough_coverage_status = 'same_fund_lp_candidates')::bigint as same_fund,
      count(*) filter (where lookthrough_coverage_status = 'share_class_family_lp_candidates')::bigint as share_class_family,
      count(*) filter (where lookthrough_coverage_status = 'intermediate_fund_lp_candidates')::bigint as intermediate_fund,
      count(*) filter (where lookthrough_coverage_status = 'lookthrough_unresolved')::bigint as unresolved,
      coalesce(sum(shell_committed_amt), 0)::bigint as committed,
      bool_and(not include_in_amount_rollup)::boolean as candidate_amount_rollup_disabled
    from ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1
    where party_id = '${shellPartyId}'
  )
  select
    source.rows as source_rows,
    source.funds as source_funds,
    source.committed as source_committed,
    source.invested as source_invested,
    source.drawn as source_drawn,
    source.remaining as source_remaining,
    source.primary_amount as source_primary,
    surface.rows as surface_rows,
    surface.funds as surface_funds,
    surface.flagged_rows,
    surface.excluded_rows,
    surface.included_rows,
    surface.managed_fund_overlap_rows,
    surface.committed as surface_committed,
    surface.invested as surface_invested,
    surface.drawn as surface_drawn,
    surface.remaining as surface_remaining,
    surface.primary_amount as surface_primary,
    target.funds as target_funds,
    target.rows as target_rows,
    target.same_fund,
    target.share_class_family,
    target.intermediate_fund,
    target.unresolved,
    target.committed as target_committed,
    target.candidate_amount_rollup_disabled
  from source cross join surface cross join target
`);

const reconciliation = await query(`
  select *
  from public.party_external_investor_scope_reconciliation_v1
  order by role_type
`);

const [scopeAudit] = await query(`
  select
    count(*) filter (where capital_scope = 'internal_manager_capital')::bigint as legacy_scope_rows,
    count(*) filter (
      where not include_in_external_investor_rollup
        and (role_type <> 'beneficiary' or capital_scope not in ('internal_managed_fund', 'internal_fund_lookthrough_shell'))
    )::bigint as invalid_exclusions,
    count(*) filter (
      where role_type = 'beneficiary'
        and include_in_external_investor_rollup
        and capital_scope in ('internal_managed_fund', 'internal_fund_lookthrough_shell')
    )::bigint as internal_rows_in_external_rollup,
    count(*) filter (
      where role_type = 'lender'
        and not include_in_external_investor_rollup
    )::bigint as excluded_lender_rows,
    count(*) filter (
      where role_type = 'beneficiary'
        and party_id = '${shellPartyId}'
        and include_in_external_investor_rollup
    )::bigint as shell_rows_in_external_rollup
  from public.party_exposure_external_current_v1
`);

const assertions = [];
function assert(name, valid, detail) {
  assertions.push({ name, valid, detail });
  if (!valid) process.exitCode = 1;
}
function amount(value) {
  return BigInt(value ?? 0);
}

assert("new_contract_surface_present", Object.values(contract).every(Boolean), contract);
assert(
  "shell_source_rows_preserved",
  amount(shell.source_rows) > 0n
    && amount(shell.source_rows) === amount(shell.surface_rows)
    && amount(shell.source_rows) === amount(shell.flagged_rows)
    && amount(shell.source_rows) === amount(shell.excluded_rows)
    && amount(shell.included_rows) === 0n,
  shell,
);
assert(
  "shell_amounts_preserved",
  ["committed", "invested", "drawn", "remaining", "primary"].every(
    (metric) => amount(shell[`source_${metric}`]) === amount(shell[`surface_${metric}`]),
  ),
  shell,
);
assert(
  "shell_target_candidate_paths_are_controlled",
  amount(shell.target_funds) === amount(shell.source_funds)
    && amount(shell.target_rows) === amount(shell.source_rows)
    && amount(shell.target_committed) === amount(shell.source_committed)
    && amount(shell.same_fund)
      + amount(shell.share_class_family)
      + amount(shell.intermediate_fund)
      + amount(shell.unresolved) === amount(shell.target_funds)
    && amount(shell.unresolved) <= 1n,
  shell,
);
assert("candidate_path_amount_rollup_disabled", shell.candidate_amount_rollup_disabled === true, shell);
assert("shell_not_double_classified", amount(shell.managed_fund_overlap_rows) === 0n, shell);
assert(
  "scope_exclusions_valid",
  Object.values(scopeAudit).every((value) => amount(value) === 0n),
  scopeAudit,
);
assert(
  "all_role_partitions_reconcile",
  reconciliation.length > 0 && reconciliation.every((row) => (
    row.row_partition_valid
    && row.committed_partition_valid
    && row.invested_partition_valid
    && row.drawn_partition_valid
    && row.remaining_partition_valid
    && row.primary_partition_valid
  )),
  reconciliation,
);

console.log(JSON.stringify({
  verifiedAt: new Date().toISOString(),
  projectRef,
  shellPartyId,
  contract,
  shell,
  scopeAudit,
  reconciliation,
  assertions,
  passed: assertions.every((row) => row.valid),
}, null, 2));
