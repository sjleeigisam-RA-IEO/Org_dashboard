import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targetParty = {
  id: "pty_fd1712a508dbd8e44c2441fd",
  name: "\uC774\uC9C0\uC2A4\uC790\uC0B0\uC6B4\uC6A9",
};
const amountFields = [
  "committed",
  "invested",
  "drawn",
  "remaining",
  "primary",
];

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

function serializeBigInts(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? String(item) : item,
    ),
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

  if (!response.ok) {
    throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function assert(assertions, id, passed, details) {
  assertions.push({ id, passed: Boolean(passed), details });
}

function amountsMatch(left, right, leftPrefix, rightPrefix) {
  return amountFields.every(
    (metric) =>
      amount(left[`${leftPrefix}_${metric}`]) ===
      amount(right[`${rightPrefix}_${metric}`]),
  );
}

async function verify() {
  const requiredColumns = [
    "exposure_uid",
    "role_type",
    "party_id",
    "party_name",
    "fund_id",
    "committed_amt",
    "invested_amt",
    "drawn_amt",
    "remaining_amt",
    "primary_amount",
    "capital_scope",
    "include_in_external_investor_rollup",
    "is_managed_fund_party",
    "is_internal_manager_capital",
  ];

  const objects = (await query(`
    select
      to_regclass('public.party_exposure_commitment_current') is not null as has_base_view,
      to_regclass('public.party_exposure_external_current_v1') is not null as has_external_view
  `))[0] ?? {};

  if (!objects.has_base_view || !objects.has_external_view) {
    throw new Error(
      `Live contract is not ready: required views are missing (${JSON.stringify(objects)}).`,
    );
  }

  const availableColumns = await query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_exposure_external_current_v1'
    order by ordinal_position
  `);
  const availableColumnNames = new Set(
    availableColumns.map((row) => row.column_name),
  );
  const missingColumns = requiredColumns.filter(
    (column) => !availableColumnNames.has(column),
  );

  if (missingColumns.length) {
    throw new Error(
      "Live internal-manager-capital contract is not ready. " +
        "public.party_exposure_external_current_v1 is missing: " +
        `${missingColumns.join(", ")}. Apply the internal manager capital migration, ` +
        "reload the PostgREST schema, and rerun this verifier.",
    );
  }

  const baseTarget = (await query(`
    select
      count(*)::bigint as base_rows,
      count(distinct exposure_uid)::bigint as base_unique_exposures,
      count(distinct fund_id)::bigint as base_funds,
      coalesce(sum(committed_amt), 0)::bigint as base_committed,
      coalesce(sum(invested_amt), 0)::bigint as base_invested,
      coalesce(sum(drawn_amt), 0)::bigint as base_drawn,
      coalesce(sum(remaining_amt), 0)::bigint as base_remaining,
      coalesce(sum(primary_amount), 0)::bigint as base_primary
    from public.party_exposure_commitment_current
    where role_type = 'beneficiary'
      and party_id = '${targetParty.id}'
  `))[0] ?? {};

  const externalTarget = (await query(`
    select
      count(*)::bigint as surface_rows,
      count(distinct exposure_uid)::bigint as surface_unique_exposures,
      count(distinct fund_id)::bigint as surface_funds,
      count(*) filter (where is_internal_manager_capital)::bigint as manager_flagged_rows,
      count(*) filter (where not include_in_external_investor_rollup)::bigint as excluded_rows,
      count(*) filter (where include_in_external_investor_rollup)::bigint as external_rollup_rows,
      count(*) filter (where capital_scope = 'internal_manager_capital')::bigint as manager_scope_rows,
      count(*) filter (where is_managed_fund_party)::bigint as managed_fund_overlap_rows,
      coalesce(sum(committed_amt), 0)::bigint as surface_committed,
      coalesce(sum(invested_amt), 0)::bigint as surface_invested,
      coalesce(sum(drawn_amt), 0)::bigint as surface_drawn,
      coalesce(sum(remaining_amt), 0)::bigint as surface_remaining,
      coalesce(sum(primary_amount), 0)::bigint as surface_primary
    from public.party_exposure_external_current_v1
    where role_type = 'beneficiary'
      and party_id = '${targetParty.id}'
  `))[0] ?? {};

  const targetPreservation = (await query(`
    with base as (
      select exposure_uid
      from public.party_exposure_commitment_current
      where role_type = 'beneficiary'
        and party_id = '${targetParty.id}'
    ), surface as (
      select exposure_uid
      from public.party_exposure_external_current_v1
      where role_type = 'beneficiary'
        and party_id = '${targetParty.id}'
    )
    select
      (select count(*) from base left join surface using (exposure_uid)
        where surface.exposure_uid is null)::bigint as base_rows_missing_from_surface,
      (select count(*) from surface left join base using (exposure_uid)
        where base.exposure_uid is null)::bigint as surface_rows_missing_from_base
  `))[0] ?? {};

  const beneficiaryPartition = (await query(`
    with direct as (
      select
        count(*)::bigint as direct_rows,
        count(distinct exposure_uid)::bigint as direct_unique_exposures,
        coalesce(sum(committed_amt), 0)::bigint as direct_committed,
        coalesce(sum(invested_amt), 0)::bigint as direct_invested,
        coalesce(sum(drawn_amt), 0)::bigint as direct_drawn,
        coalesce(sum(remaining_amt), 0)::bigint as direct_remaining,
        coalesce(sum(primary_amount), 0)::bigint as direct_primary
      from public.party_exposure_commitment_current
      where role_type = 'beneficiary'
    ), surface as (
      select
        count(*)::bigint as surface_rows,
        count(distinct exposure_uid)::bigint as surface_unique_exposures,
        count(*) filter (where include_in_external_investor_rollup)::bigint as external_rows,
        count(*) filter (
          where not include_in_external_investor_rollup
            and is_managed_fund_party
            and not is_internal_manager_capital
        )::bigint as internal_managed_fund_rows,
        count(*) filter (
          where not include_in_external_investor_rollup
            and is_internal_manager_capital
            and not is_managed_fund_party
        )::bigint as internal_manager_capital_rows,
        count(*) filter (
          where not include_in_external_investor_rollup
            and is_managed_fund_party
            and is_internal_manager_capital
        )::bigint as overlapping_internal_scope_rows,
        count(*) filter (
          where not include_in_external_investor_rollup
            and not is_managed_fund_party
            and not is_internal_manager_capital
        )::bigint as unclassified_excluded_rows,
        count(*) filter (
          where include_in_external_investor_rollup
            and (is_managed_fund_party or is_internal_manager_capital)
        )::bigint as internal_scope_rows_in_external_rollup,
        coalesce(sum(committed_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_committed,
        coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and is_managed_fund_party and not is_internal_manager_capital), 0)::bigint as internal_managed_fund_committed,
        coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and is_internal_manager_capital and not is_managed_fund_party), 0)::bigint as internal_manager_capital_committed,
        coalesce(sum(invested_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_invested,
        coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and is_managed_fund_party and not is_internal_manager_capital), 0)::bigint as internal_managed_fund_invested,
        coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and is_internal_manager_capital and not is_managed_fund_party), 0)::bigint as internal_manager_capital_invested,
        coalesce(sum(drawn_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_drawn,
        coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and is_managed_fund_party and not is_internal_manager_capital), 0)::bigint as internal_managed_fund_drawn,
        coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and is_internal_manager_capital and not is_managed_fund_party), 0)::bigint as internal_manager_capital_drawn,
        coalesce(sum(remaining_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_remaining,
        coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and is_managed_fund_party and not is_internal_manager_capital), 0)::bigint as internal_managed_fund_remaining,
        coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and is_internal_manager_capital and not is_managed_fund_party), 0)::bigint as internal_manager_capital_remaining,
        coalesce(sum(primary_amount) filter (where include_in_external_investor_rollup), 0)::bigint as external_primary,
        coalesce(sum(primary_amount) filter (where not include_in_external_investor_rollup and is_managed_fund_party and not is_internal_manager_capital), 0)::bigint as internal_managed_fund_primary,
        coalesce(sum(primary_amount) filter (where not include_in_external_investor_rollup and is_internal_manager_capital and not is_managed_fund_party), 0)::bigint as internal_manager_capital_primary
      from public.party_exposure_external_current_v1
      where role_type = 'beneficiary'
    )
    select * from direct cross join surface
  `))[0] ?? {};

  const lenderIntegrity = (await query(`
    with direct as (
      select
        count(*)::bigint as direct_rows,
        coalesce(sum(committed_amt), 0)::bigint as direct_committed,
        coalesce(sum(invested_amt), 0)::bigint as direct_invested,
        coalesce(sum(drawn_amt), 0)::bigint as direct_drawn,
        coalesce(sum(remaining_amt), 0)::bigint as direct_remaining,
        coalesce(sum(primary_amount), 0)::bigint as direct_primary
      from public.party_exposure_commitment_current
      where role_type = 'lender'
    ), surface as (
      select
        count(*)::bigint as surface_rows,
        count(*) filter (where include_in_external_investor_rollup)::bigint as included_rows,
        count(*) filter (where not include_in_external_investor_rollup)::bigint as excluded_rows,
        count(*) filter (where is_internal_manager_capital)::bigint as manager_flagged_rows,
        coalesce(sum(committed_amt), 0)::bigint as surface_committed,
        coalesce(sum(invested_amt), 0)::bigint as surface_invested,
        coalesce(sum(drawn_amt), 0)::bigint as surface_drawn,
        coalesce(sum(remaining_amt), 0)::bigint as surface_remaining,
        coalesce(sum(primary_amount), 0)::bigint as surface_primary
      from public.party_exposure_external_current_v1
      where role_type = 'lender'
    )
    select * from direct cross join surface
  `))[0] ?? {};

  const assertions = [];
  const baseRows = amount(baseTarget.base_rows);
  const surfaceRows = amount(externalTarget.surface_rows);

  assert(
    assertions,
    "base_beneficiary_facts_preserved",
    baseRows > 0n &&
      baseRows === amount(baseTarget.base_unique_exposures) &&
      baseRows === surfaceRows &&
      baseRows === amount(externalTarget.surface_unique_exposures) &&
      amount(targetPreservation.base_rows_missing_from_surface) === 0n &&
      amount(targetPreservation.surface_rows_missing_from_base) === 0n &&
      amountsMatch(baseTarget, externalTarget, "base", "surface"),
    { baseTarget, externalTarget, targetPreservation },
  );

  assert(
    assertions,
    "target_is_internal_manager_capital",
    surfaceRows > 0n &&
      amount(externalTarget.manager_flagged_rows) === surfaceRows &&
      amount(externalTarget.manager_scope_rows) === surfaceRows &&
      amount(externalTarget.excluded_rows) === surfaceRows &&
      amount(externalTarget.managed_fund_overlap_rows) === 0n,
    externalTarget,
  );

  assert(
    assertions,
    "target_absent_from_external_rollup",
    amount(externalTarget.external_rollup_rows) === 0n,
    externalTarget,
  );

  const partitionRowsMatch =
    amount(beneficiaryPartition.direct_rows) ===
    amount(beneficiaryPartition.surface_rows) &&
    amount(beneficiaryPartition.direct_rows) ===
    amount(beneficiaryPartition.external_rows) +
      amount(beneficiaryPartition.internal_managed_fund_rows) +
      amount(beneficiaryPartition.internal_manager_capital_rows);
  const partitionAmountsMatch = amountFields.every((metric) => {
    const direct = amount(beneficiaryPartition[`direct_${metric}`]);
    const partitioned =
      amount(beneficiaryPartition[`external_${metric}`]) +
      amount(beneficiaryPartition[`internal_managed_fund_${metric}`]) +
      amount(beneficiaryPartition[`internal_manager_capital_${metric}`]);
    return direct === partitioned;
  });
  assert(
    assertions,
    "beneficiary_direct_equals_external_plus_two_internal_scopes",
    partitionRowsMatch &&
      partitionAmountsMatch &&
      amount(beneficiaryPartition.direct_rows) ===
        amount(beneficiaryPartition.direct_unique_exposures) &&
      amount(beneficiaryPartition.surface_rows) ===
        amount(beneficiaryPartition.surface_unique_exposures) &&
      amount(beneficiaryPartition.overlapping_internal_scope_rows) === 0n &&
      amount(beneficiaryPartition.unclassified_excluded_rows) === 0n &&
      amount(beneficiaryPartition.internal_scope_rows_in_external_rollup) === 0n,
    beneficiaryPartition,
  );

  assert(
    assertions,
    "lender_surface_unchanged",
    amount(lenderIntegrity.direct_rows) > 0n &&
      amount(lenderIntegrity.direct_rows) === amount(lenderIntegrity.surface_rows) &&
      amount(lenderIntegrity.surface_rows) === amount(lenderIntegrity.included_rows) &&
      amount(lenderIntegrity.excluded_rows) === 0n &&
      amount(lenderIntegrity.manager_flagged_rows) === 0n &&
      amountsMatch(lenderIntegrity, lenderIntegrity, "direct", "surface"),
    lenderIntegrity,
  );

  const report = serializeBigInts({
    verifiedAt: new Date().toISOString(),
    projectRef,
    targetParty,
    baseTarget,
    externalTarget,
    targetPreservation,
    beneficiaryPartition,
    lenderIntegrity,
    assertions,
    passed: assertions.every((item) => item.passed),
  });

  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

try {
  await verify();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        projectRef,
        targetParty,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
