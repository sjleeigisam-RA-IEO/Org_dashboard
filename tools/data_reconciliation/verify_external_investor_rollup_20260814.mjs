import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseEnv(text) {
  return Object.fromEntries(
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
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

function amount(value) {
  return BigInt(String(value ?? 0).replace(/\.0+$/, ""));
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

const relations = await query(`
  select
    to_regclass('public.party_exposure_commitment_current') is not null as has_direct_view,
    to_regclass('public.party_managed_fund_resolution_v1') is not null as has_resolution_view,
    to_regclass('public.party_exposure_external_current_v1') is not null as has_external_view,
    to_regclass('public.party_external_investor_rollup_audit') is not null as has_audit_view,
    to_regclass('public.party_internal_manager_capital_resolution_v1') is not null as has_manager_scope_view,
    to_regclass('public.party_external_investor_scope_reconciliation_v1') is not null as has_scope_reconciliation_view
`);

const reconciliation = await query(`
  select
    role_type,
    count(*)::int as direct_rows,
    count(*) filter (where include_in_external_investor_rollup)::int as external_rows,
    count(*) filter (where not include_in_external_investor_rollup)::int as internal_rows,
    count(distinct party_id) filter (where not include_in_external_investor_rollup)::int as internal_parties,
    coalesce(sum(committed_amt), 0)::bigint as direct_committed,
    coalesce(sum(committed_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_committed,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_committed,
    coalesce(sum(invested_amt), 0)::bigint as direct_invested,
    coalesce(sum(invested_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_invested,
    coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_invested,
    coalesce(sum(drawn_amt), 0)::bigint as direct_drawn,
    coalesce(sum(drawn_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_drawn,
    coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_drawn,
    coalesce(sum(remaining_amt), 0)::bigint as direct_remaining,
    coalesce(sum(remaining_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_remaining,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_remaining
  from public.party_exposure_external_current_v1
  group by role_type
  order by role_type
`);

const integrity = await query(`
  select
    (select count(*) from public.party_exposure_commitment_current) as source_rows,
    (select count(*) from public.party_exposure_external_current_v1) as external_view_rows,
    (select count(*) from (
      select exposure_uid
      from public.party_exposure_external_current_v1
      group by exposure_uid
      having count(*) > 1
    ) duplicated) as duplicate_exposure_uids,
    (select count(*) from public.party_exposure_external_current_v1
      where not include_in_external_investor_rollup
        and (
          role_type <> 'beneficiary'
          or capital_scope not in ('internal_managed_fund', 'internal_manager_capital')
          or not (is_managed_fund_party or is_internal_manager_capital)
        )
    ) as invalid_exclusions,
    (select count(*) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary'
        and include_in_external_investor_rollup
        and capital_scope in ('internal_managed_fund', 'internal_manager_capital')
    ) as internal_rows_in_external_rollup,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary' and not include_in_external_investor_rollup
        and is_managed_fund_party
        and lookthrough_coverage_status = 'direct_upstream_available'
    ) as internal_parties_with_upstream,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary' and not include_in_external_investor_rollup
        and is_managed_fund_party
        and lookthrough_coverage_status = 'direct_upstream_missing'
    ) as internal_parties_without_upstream,
    (select coalesce(sum(committed_amt), 0)::bigint from public.party_exposure_external_current_v1
      where role_type = 'beneficiary' and not include_in_external_investor_rollup
        and is_managed_fund_party
        and lookthrough_coverage_status = 'direct_upstream_missing'
    ) as internal_committed_without_upstream,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary'
        and not include_in_external_investor_rollup
        and is_managed_fund_party
    ) as internal_managed_fund_parties,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary'
        and not include_in_external_investor_rollup
        and is_internal_manager_capital
    ) as internal_manager_parties,
    (select count(*) from public.party_exposure_external_current_v1
      where role_type = 'lender' and is_managed_fund_party
        and not include_in_external_investor_rollup
    ) as managed_fund_lender_rows_excluded,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary' and role_class = '국내LP'
        and include_in_external_investor_rollup
    ) as domestic_lp_parties,
    (select count(distinct party_id) from public.party_exposure_external_current_v1
      where role_type = 'beneficiary' and role_class = '해외LP'
        and include_in_external_investor_rollup
    ) as foreign_lp_parties
`);

const assertions = [];
function assert(id, passed, details) {
  assertions.push({ id, passed: Boolean(passed), details });
}

const relationRow = relations[0] ?? {};
assert("required_views_present", Object.values(relationRow).every(Boolean), relationRow);

for (const row of reconciliation) {
  for (const metric of ["committed", "invested", "drawn", "remaining"]) {
    const direct = amount(row[`direct_${metric}`]);
    const external = amount(row[`external_${metric}`]);
    const internal = amount(row[`internal_${metric}`]);
    assert(
      `${row.role_type}_${metric}_reconciles`,
      direct === external + internal,
      { direct: String(direct), external: String(external), internal: String(internal) },
    );
  }
}

const lender = reconciliation.find((row) => row.role_type === "lender");
assert("lender_rollup_unchanged", lender && Number(lender.internal_rows) === 0, lender ?? {});

const integrityRow = integrity[0] ?? {};
assert("source_grain_preserved", integrityRow.source_rows === integrityRow.external_view_rows, integrityRow);
assert("exposure_uid_unique", Number(integrityRow.duplicate_exposure_uids) === 0, integrityRow);
assert("exclusions_are_supported_internal_beneficiaries", Number(integrityRow.invalid_exclusions) === 0, integrityRow);
assert("external_rollup_has_no_internal_rows", Number(integrityRow.internal_rows_in_external_rollup) === 0, integrityRow);
assert(
  "lookthrough_coverage_partitions_internal_parties",
  Number(integrityRow.internal_parties_with_upstream) + Number(integrityRow.internal_parties_without_upstream)
    === Number(integrityRow.internal_managed_fund_parties),
  integrityRow,
);
assert("internal_manager_scope_present", Number(integrityRow.internal_manager_parties) > 0, integrityRow);
assert("managed_fund_lenders_remain_included", Number(integrityRow.managed_fund_lender_rows_excluded) === 0, integrityRow);
assert(
  "lp_individual_series_available",
  Number(integrityRow.domestic_lp_parties) > 0 && Number(integrityRow.foreign_lp_parties) > 0,
  integrityRow,
);

const report = {
  verifiedAt: new Date().toISOString(),
  projectRef,
  reconciliation,
  integrity: integrityRow,
  assertions,
  passed: assertions.every((item) => item.passed),
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
