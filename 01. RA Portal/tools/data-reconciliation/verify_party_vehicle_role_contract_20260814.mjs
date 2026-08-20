import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

const requiredObjects = await query(`
  select
    to_regclass('public.beneficiary_vehicle_role_resolution_v1') is not null as has_vehicle_resolution,
    to_regclass('public.party_managed_fund_resolution_v1') is not null as has_managed_resolution,
    to_regclass('public.party_exposure_external_current_v1') is not null as has_external_surface,
    to_regclass('public.party_vehicle_role_contract_audit') is not null as has_contract_audit
`);

const contractAudit = await query(`
  select * from public.party_vehicle_role_contract_audit order by role_type
`);

const reconciliation = await query(`
  select
    role_type,
    count(*)::int as direct_rows,
    count(*) filter (where include_in_external_investor_rollup)::int as external_rows,
    count(*) filter (where not include_in_external_investor_rollup)::int as internal_rows,
    coalesce(sum(committed_amt), 0)::bigint as direct_committed,
    coalesce(sum(committed_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_committed,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_committed,
    coalesce(sum(primary_amount), 0)::bigint as direct_primary,
    coalesce(sum(primary_amount) filter (where include_in_external_investor_rollup), 0)::bigint as external_primary,
    coalesce(sum(primary_amount) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_primary,
    coalesce(sum(remaining_amt), 0)::bigint as direct_remaining,
    coalesce(sum(remaining_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_remaining,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup), 0)::bigint as internal_remaining
  from public.party_exposure_external_current_v1
  group by role_type
  order by role_type
`);

const classTotals = await query(`
  select
    role_type,
    role_class,
    count(distinct party_id)::int as party_count,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(primary_amount), 0)::bigint as primary_amount,
    coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
  from public.party_exposure_external_current_v1
  where role_type = 'lender' or include_in_external_investor_rollup
  group by role_type, role_class
  order by role_type, role_class
`);

const exactRows = await query(`
  select
    party_name, role_class, role_subtype, party_origin,
    capital_scope, include_in_external_investor_rollup,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and party_name in ('이지스밸류리츠', '이지스밸류플러스위탁관리부동산투자회사')
  group by party_name, role_class, role_subtype, party_origin,
    capital_scope, include_in_external_investor_rollup
  order by party_name
`);

const contamination = await query(`
  select
    count(distinct row.party_id)::int as resolved_vehicle_parties_in_lp,
    count(*)::int as resolved_vehicle_rows_in_lp
  from public.party_exposure_external_current_v1 row
  join public.beneficiary_vehicle_role_resolution_v1 vehicle
    on vehicle.party_id = row.party_id
  where row.role_type = 'beneficiary'
    and row.role_class in ('국내LP', '해외LP')
`);

const vehicleRoleLeakage = await query(`
  select
    party_id,
    party_name,
    role_class,
    role_subtype,
    capital_scope,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and public.is_beneficiary_investment_vehicle_name(party_name)
    and role_class <> '펀드·리츠·SPC'
  group by party_id, party_name, role_class, role_subtype, capital_scope
  order by committed_amt desc, party_name
`);

const nonVehicleIdentityLeakage = await query(`
  select
    party_id,
    party_name,
    role_class,
    role_subtype,
    capital_scope,
    count(*)::int as exposure_rows,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and role_class = '펀드·리츠·SPC'
    and not public.is_beneficiary_investment_vehicle_name(party_name)
  group by party_id, party_name, role_class, role_subtype, capital_scope
  order by committed_amt desc, party_name
`);

const assertions = [];
function assert(id, passed, details) {
  assertions.push({ id, passed: Boolean(passed), details });
}

assert(
  "required_objects_present",
  Object.values(requiredObjects[0] ?? {}).every(Boolean),
  requiredObjects[0] ?? {},
);

for (const row of contractAudit) {
  assert(`${row.role_type}_contract_audit`,
    row.direct_scope_totals_match === true
      && Number(row.managed_vehicles_still_classified_as_lp) === 0
      && Number(row.resolved_vehicles_still_classified_as_lp) === 0
      && Number(row.invalid_value_reit_rows) === 0,
    row);
}

for (const row of reconciliation) {
  for (const metric of ["committed", "primary", "remaining"]) {
    assert(
      `${row.role_type}_${metric}_reconciles`,
      amount(row[`direct_${metric}`])
        === amount(row[`external_${metric}`]) + amount(row[`internal_${metric}`]),
      row,
    );
  }
}

for (const role of ["beneficiary", "lender"]) {
  const direct = reconciliation.find((row) => row.role_type === role);
  const subtotal = classTotals.filter((row) => row.role_type === role).reduce(
    (totals, row) => ({
      committed: totals.committed + amount(row.committed_amt),
      primary: totals.primary + amount(row.primary_amount),
      remaining: totals.remaining + amount(row.remaining_amt),
    }),
    { committed: 0n, primary: 0n, remaining: 0n },
  );
  const expectedPrefix = role === "beneficiary" ? "external" : "direct";
  assert(`${role}_role_class_subtotals_match`,
    direct
      && subtotal.committed === amount(direct[`${expectedPrefix}_committed`])
      && subtotal.primary === amount(direct[`${expectedPrefix}_primary`])
      && subtotal.remaining === amount(direct[`${expectedPrefix}_remaining`]),
    { direct, subtotal: Object.fromEntries(Object.entries(subtotal).map(([key, value]) => [key, String(value)])) });
}

assert("value_reits_classified_as_vehicle",
  exactRows.length === 2
    && exactRows.every((row) => row.role_class === "펀드·리츠·SPC"),
  exactRows);
assert("value_reits_excluded_from_external_rollup",
  exactRows.length === 2
    && exactRows.every((row) => row.capital_scope === "internal_managed_fund"
      && row.include_in_external_investor_rollup === false),
  exactRows);
assert("vehicle_lp_contamination_zero",
  Number(contamination[0]?.resolved_vehicle_rows_in_lp ?? -1) === 0,
  contamination[0] ?? {});
assert("vehicle_role_leakage_zero",
  vehicleRoleLeakage.length === 0,
  vehicleRoleLeakage);
assert("non_vehicle_identity_leakage_zero",
  nonVehicleIdentityLeakage.length === 0,
  nonVehicleIdentityLeakage);

const bankClass = classTotals.find((row) => row.role_type === "lender" && row.role_class === "은행");
assert("bank_individual_stack_available",
  Number(bankClass?.party_count ?? 0) > 1,
  bankClass ?? {});

const report = {
  verifiedAt: new Date().toISOString(),
  projectRef,
  contractAudit,
  reconciliation,
  classTotals,
  exactRows,
  contamination: contamination[0] ?? {},
  vehicleRoleLeakage,
  nonVehicleIdentityLeakage,
  assertions,
  passed: assertions.every((item) => item.passed),
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
