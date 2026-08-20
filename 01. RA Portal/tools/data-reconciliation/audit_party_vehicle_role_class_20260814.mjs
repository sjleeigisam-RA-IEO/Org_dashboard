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

const vehiclePattern = "(리츠|부동산투자회사|투자신탁|사모|펀드|PFV|위탁관리|REIT|TRUST)";

const candidates = await query(`
  with source_categories as (
    select
      exposure.party_id,
      array_agg(distinct metadata.source_beneficiary_type)
        filter (where nullif(btrim(metadata.source_beneficiary_type), '') is not null) as source_types,
      array_agg(distinct metadata.source_beneficiary_category)
        filter (where nullif(btrim(metadata.source_beneficiary_category), '') is not null) as source_categories
    from public.beneficiary_exposures exposure
    left join public.beneficiary_exposure_source_metadata metadata
      on metadata.exposure_id = exposure.id
    group by exposure.party_id
  )
  select
    current_row.party_id,
    current_row.party_name,
    current_row.role_class,
    current_row.role_subtype,
    current_row.party_origin,
    current_row.capital_scope,
    current_row.include_in_external_investor_rollup,
    current_row.is_managed_fund_party,
    coalesce(source_categories.source_types, array[]::text[]) as source_types,
    coalesce(source_categories.source_categories, array[]::text[]) as source_categories,
    count(*)::int as exposure_rows,
    sum(current_row.committed_amt)::bigint as committed_amt,
    array_agg(distinct current_row.fund_id order by current_row.fund_id) as target_fund_ids
  from public.party_exposure_external_current_v1 current_row
  left join source_categories on source_categories.party_id = current_row.party_id
  where current_row.role_type = 'beneficiary'
    and current_row.party_name ~* '${vehiclePattern}'
  group by
    current_row.party_id, current_row.party_name, current_row.role_class,
    current_row.role_subtype, current_row.party_origin, current_row.capital_scope,
    current_row.include_in_external_investor_rollup, current_row.is_managed_fund_party,
    source_categories.source_types, source_categories.source_categories
  order by committed_amt desc, current_row.party_name
`);

const candidateSummary = await query(`
  select
    role_class,
    capital_scope,
    include_in_external_investor_rollup,
    count(distinct party_id)::int as party_count,
    count(*)::int as exposure_rows,
    sum(committed_amt)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and party_name ~* '${vehiclePattern}'
  group by role_class, capital_scope, include_in_external_investor_rollup
  order by role_class, capital_scope
`);

const exactRows = await query(`
  select
    party_id, party_name, role_class, role_subtype, party_origin,
    capital_scope, include_in_external_investor_rollup,
    is_managed_fund_party, investor_managed_fund_ids,
    count(*)::int as exposure_rows,
    sum(committed_amt)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and party_name in (
      '이지스밸류리츠',
      '이지스밸류플러스위탁관리부동산투자회사'
    )
  group by party_id, party_name, role_class, role_subtype, party_origin,
    capital_scope, include_in_external_investor_rollup,
    is_managed_fund_party, investor_managed_fund_ids
  order by party_name
`);

const internalClasses = await query(`
  select
    role_class,
    count(distinct party_id)::int as party_count,
    count(*)::int as exposure_rows,
    sum(committed_amt)::bigint as committed_amt
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary' and is_managed_fund_party
  group by role_class
  order by committed_amt desc
`);

const lenderClasses = await query(`
  select
    role_class,
    count(distinct party_id)::int as party_count,
    count(*)::int as exposure_rows,
    sum(drawn_amt)::bigint as drawn_amt
  from public.party_exposure_external_current_v1
  where role_type = 'lender'
  group by role_class
  order by drawn_amt desc
`);

const externalVehicleCandidates = await query(`
  with source_categories as (
    select
      exposure.party_id,
      array_agg(distinct metadata.source_beneficiary_category)
        filter (where nullif(btrim(metadata.source_beneficiary_category), '') is not null) as source_categories
    from public.beneficiary_exposures exposure
    left join public.beneficiary_exposure_source_metadata metadata
      on metadata.exposure_id = exposure.id
    group by exposure.party_id
  )
  select
    current_row.party_id,
    current_row.party_name,
    current_row.role_class,
    current_row.party_origin,
    coalesce(source_categories.source_categories, array[]::text[]) as source_categories,
    count(*)::int as exposure_rows,
    sum(current_row.committed_amt)::bigint as committed_amt
  from public.party_exposure_external_current_v1 current_row
  left join source_categories on source_categories.party_id = current_row.party_id
  where current_row.role_type = 'beneficiary'
    and current_row.include_in_external_investor_rollup
    and current_row.party_name ~* '${vehiclePattern}'
  group by current_row.party_id, current_row.party_name, current_row.role_class,
    current_row.party_origin, source_categories.source_categories
  order by committed_amt desc, current_row.party_name
`);

const possibleManagedVehicleFunds = await query(`
  select fund_id, fund_name, short_name
  from public.funds
  where fund_name ~* '(밸류리츠|밸류플러스|레지던스|리빙플랫폼|리얼에셋)'
     or coalesce(short_name, '') ~* '(밸류리츠|밸류플러스|레지던스|리빙플랫폼|리얼에셋)'
  order by fund_id
`);

const exactPartyContract = await query(`
  select
    party.party_id,
    party.display_name,
    party.party_key,
    classification.classification_id,
    classification.role_class,
    classification.role_subtype,
    classification.source_role_class,
    classification.source_role_subtype,
    classification.source_standard_id,
    classification.source_standard_name,
    classification.classification_basis,
    classification.confidence,
    classification.review_status,
    coalesce(array_agg(distinct identifier.identifier_type || ':' || identifier.identifier_value)
      filter (where identifier.external_identifier_id is not null), array[]::text[]) as external_identifiers,
    coalesce(array_agg(distinct identity.source_name)
      filter (where identity.identity_id is not null), array[]::text[]) as identity_names
  from public.party_master party
  left join public.party_role_classifications classification
    on classification.party_id = party.party_id
   and classification.role_type = 'beneficiary'
   and classification.valid_to is null
  left join public.party_external_identifiers identifier
    on identifier.party_id = party.party_id
  left join public.party_identity_map identity
    on identity.party_id = party.party_id
   and identity.role_type = 'beneficiary'
  where party.party_id in (
    'pty_d7e1a32e819234b4086cd73d',
    'pty_d639888cf6259ede1be1a685'
  )
  group by party.party_id, party.display_name, party.party_key,
    classification.classification_id, classification.role_class,
    classification.role_subtype, classification.source_role_class,
    classification.source_role_subtype, classification.source_standard_id,
    classification.source_standard_name, classification.classification_basis,
    classification.confidence, classification.review_status
  order by party.display_name
`);

const report = {
  auditedAt: new Date().toISOString(),
  projectRef,
  vehiclePattern,
  candidateSummary,
  exactRows,
  internalClasses,
  lenderClasses,
  externalVehicleCandidates,
  possibleManagedVehicleFunds,
  exactPartyContract,
  candidates,
};

if (process.argv.includes('--compact')) {
  delete report.candidates;
}

console.log(JSON.stringify(report, null, 2));
