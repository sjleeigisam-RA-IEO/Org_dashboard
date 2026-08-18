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

const summary = await query(`
  with shell_by_fund as (
    select
      fund_id,
      min(fund_name) as fund_name,
      count(*)::int as shell_rows,
      coalesce(sum(committed_amt), 0)::bigint as shell_committed_amt,
      coalesce(sum(invested_amt), 0)::bigint as shell_invested_amt
    from public.party_exposure_commitment_current
    where role_type = 'beneficiary'
      and party_id = '${shellPartyId}'
    group by fund_id
  ), other_by_fund as (
    select
      target.fund_id,
      count(other_row.exposure_uid)::int as other_rows,
      count(distinct other_row.party_id)::int as other_party_count,
      coalesce(sum(other_row.committed_amt), 0)::bigint as other_committed_amt,
      coalesce(sum(other_row.invested_amt), 0)::bigint as other_invested_amt
    from shell_by_fund target
    left join public.party_exposure_commitment_current other_row
      on other_row.role_type = 'beneficiary'
     and other_row.fund_id = target.fund_id
     and other_row.party_id <> '${shellPartyId}'
    group by target.fund_id
  )
  select
    count(*)::int as target_fund_count,
    count(*) filter (where other_by_fund.other_rows > 0)::int as funds_with_other_investors,
    count(*) filter (where other_by_fund.other_rows = 0)::int as funds_without_other_investors,
    coalesce(sum(shell_by_fund.shell_rows), 0)::int as shell_rows,
    coalesce(sum(shell_by_fund.shell_committed_amt), 0)::bigint as shell_committed_amt,
    coalesce(sum(shell_by_fund.shell_invested_amt), 0)::bigint as shell_invested_amt,
    coalesce(sum(other_by_fund.other_rows), 0)::int as other_investor_rows,
    count(distinct case when other_by_fund.other_rows > 0 then shell_by_fund.fund_id end)::int as lookthrough_covered_funds,
    coalesce(sum(other_by_fund.other_committed_amt), 0)::bigint as other_committed_amt,
    coalesce(sum(other_by_fund.other_invested_amt), 0)::bigint as other_invested_amt,
    coalesce(sum(shell_by_fund.shell_committed_amt) filter (where other_by_fund.other_rows = 0), 0)::bigint as shell_committed_without_other_investors
  from shell_by_fund
  join other_by_fund using (fund_id)
`);

const missing = await query(`
  with shell_funds as (
    select distinct fund_id, fund_name
    from public.party_exposure_commitment_current
    where role_type = 'beneficiary'
      and party_id = '${shellPartyId}'
  )
  select
    shell_funds.fund_id,
    shell_funds.fund_name,
    count(other_row.exposure_uid)::int as other_rows
  from shell_funds
  left join public.party_exposure_commitment_current other_row
    on other_row.role_type = 'beneficiary'
   and other_row.fund_id = shell_funds.fund_id
   and other_row.party_id <> '${shellPartyId}'
  group by shell_funds.fund_id, shell_funds.fund_name
  having count(other_row.exposure_uid) = 0
  order by shell_funds.fund_id
`);

const topFunds = await query(`
  with shell_by_fund as (
    select
      fund_id,
      min(fund_name) as fund_name,
      coalesce(sum(committed_amt), 0)::bigint as shell_committed_amt
    from public.party_exposure_commitment_current
    where role_type = 'beneficiary'
      and party_id = '${shellPartyId}'
    group by fund_id
  )
  select
    shell_by_fund.*,
    count(other_row.exposure_uid)::int as other_rows,
    count(distinct other_row.party_id)::int as other_party_count,
    coalesce(sum(other_row.committed_amt), 0)::bigint as other_committed_amt
  from shell_by_fund
  left join public.party_exposure_commitment_current other_row
    on other_row.role_type = 'beneficiary'
   and other_row.fund_id = shell_by_fund.fund_id
   and other_row.party_id <> '${shellPartyId}'
  group by shell_by_fund.fund_id, shell_by_fund.fund_name, shell_by_fund.shell_committed_amt
  order by shell_by_fund.shell_committed_amt desc, shell_by_fund.fund_id
  limit 20
`);

const uncoveredContext = await query(`
  select
    current_row.fund_id,
    current_row.fund_name,
    current_row.party_id,
    current_row.party_name,
    current_row.role_class,
    current_row.committed_amt,
    current_row.invested_amt
  from public.party_exposure_commitment_current current_row
  where current_row.role_type = 'beneficiary'
    and (
      current_row.fund_id = '120047'
      or current_row.fund_name ilike '%코어인프라1호%'
    )
  order by current_row.fund_id, current_row.party_name
`);

const strictResolution = await query(`
  with beneficiary_rows as (
    select
      exposure_row.*,
      public.normalize_party_key(
        regexp_replace(
          coalesce(exposure_row.fund_name, ''),
          '[[:space:]]*\\(([0-9]+(의[0-9]+)?종|운용|class[[:space:]]+[[:alnum:]-]+|c[0-9]+)\\)[[:space:]]*$',
          '',
          'gi'
        )
      ) as fund_family_key
    from public.party_exposure_commitment_current exposure_row
    where exposure_row.role_type = 'beneficiary'
  ), actual_lp_rows as (
    select beneficiary.*
    from beneficiary_rows beneficiary
    left join public.party_managed_fund_resolution_v1 managed_fund
      on managed_fund.party_id = beneficiary.party_id
    left join public.party_capital_scope_overrides scope
      on scope.party_id = beneficiary.party_id
     and scope.role_type = beneficiary.role_type
    where managed_fund.party_id is null
      and coalesce(scope.include_in_external_investor_rollup, true)
  ), shell_targets as (
    select distinct
      beneficiary.fund_id,
      beneficiary.fund_name,
      beneficiary.fund_family_key
    from beneficiary_rows beneficiary
    where beneficiary.party_id = '${shellPartyId}'
  )
  select
    target.fund_id,
    target.fund_name,
    target.fund_family_key,
    count(distinct raw_other.exposure_uid)::int as raw_other_rows,
    count(distinct actual_same.exposure_uid)::int as actual_same_fund_rows,
    count(distinct actual_family.exposure_uid)::int as actual_family_rows,
    array_agg(distinct raw_other.party_name order by raw_other.party_name)
      filter (where raw_other.party_name is not null) as raw_other_parties,
    array_agg(distinct actual_family.party_name order by actual_family.party_name)
      filter (where actual_family.party_name is not null) as actual_family_parties
  from shell_targets target
  left join beneficiary_rows raw_other
    on raw_other.fund_id = target.fund_id
   and raw_other.party_id <> '${shellPartyId}'
  left join actual_lp_rows actual_same
    on actual_same.fund_id = target.fund_id
  left join actual_lp_rows actual_family
    on actual_family.fund_family_key = target.fund_family_key
   and target.fund_family_key <> ''
  group by target.fund_id, target.fund_name, target.fund_family_key
  having count(distinct actual_same.exposure_uid) = 0
     and count(distinct actual_family.exposure_uid) = 0
  order by target.fund_id
`);

const recursiveCandidates = await query(`
  select
    current_row.fund_id as target_fund_id,
    current_row.fund_name as target_fund_name,
    current_row.party_id as intermediate_party_id,
    current_row.party_name as intermediate_party_name,
    resolution.managed_fund_ids,
    resolution.managed_fund_names,
    resolution.lookthrough_coverage_status,
    resolution.upstream_beneficiary_rows,
    resolution.upstream_beneficiary_parties,
    resolution.upstream_committed_amt
  from public.party_exposure_commitment_current current_row
  join public.party_managed_fund_resolution_v1 resolution
    on resolution.party_id = current_row.party_id
  where current_row.role_type = 'beneficiary'
    and current_row.fund_id in ('112214', '112681', '112683', '120085')
    and current_row.party_id <> '${shellPartyId}'
  order by current_row.fund_id, current_row.party_name
`);

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  projectRef,
  shellPartyId,
  summary: summary[0] ?? {},
  fundsWithoutOtherInvestors: missing,
  uncoveredContext,
  strictResolution,
  recursiveCandidates,
  topFunds,
}, null, 2));
