-- Exclude IGIS-managed vehicles from Account rollups for every capital role.
-- This affects the capital-relationship serving view only; Portfolio AUM remains beneficiary-only.

begin;

insert into public.party_capital_scope_overrides (
  party_id,
  role_type,
  capital_scope,
  include_in_external_investor_rollup,
  resolution_basis,
  confidence,
  review_status,
  source_note,
  updated_at
) values (
  'pty_f0e415fa5fb4caf208f152a7',
  'lender',
  'internal_managed_fund',
  false,
  'confirmed_igis_managed_lender_vehicle_name',
  0.950,
  'confirmed',
  '이지스전문사모121호: 내부 운용 vehicle은 대주 Account 집계에서 제외하고 관계 lineage에만 보존',
  now()
)
on conflict (party_id, role_type) do update set
  capital_scope = excluded.capital_scope,
  include_in_external_investor_rollup = excluded.include_in_external_investor_rollup,
  resolution_basis = excluded.resolution_basis,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  source_note = excluded.source_note,
  updated_at = now();

create or replace view public.party_exposure_external_current_v1 as
select
  current_row.*,
  coalesce(managed_fund.managed_fund_ids, array[]::text[]) as investor_managed_fund_ids,
  coalesce(managed_fund.managed_fund_names, array[]::text[]) as investor_managed_fund_names,
  coalesce(
    managed_fund.resolution_type,
    case when scope.capital_scope = 'internal_managed_fund' then 'capital_scope_override' end
  ) as internal_fund_resolution_type,
  coalesce(
    managed_fund.confidence,
    case when scope.capital_scope = 'internal_managed_fund' then scope.confidence end
  )::numeric(4, 3) as internal_fund_resolution_confidence,
  case
    when shell_target.party_id is not null then 'internal_fund_lookthrough_shell'
    when scope.party_id is not null and scope.capital_scope <> 'internal_fund_lookthrough_shell' then scope.capital_scope
    when managed_fund.party_id is not null then 'internal_managed_fund'
    else 'external_party'
  end as capital_scope,
  case
    when shell_target.party_id is not null then false
    when scope.party_id is not null and scope.capital_scope <> 'internal_fund_lookthrough_shell'
      then scope.include_in_external_investor_rollup
    else managed_fund.party_id is null
  end as include_in_external_investor_rollup,
  (managed_fund.party_id is not null or scope.capital_scope = 'internal_managed_fund') as is_managed_fund_party,
  case
    when shell_target.party_id is not null then shell_target.lookthrough_coverage_status
    when managed_fund.party_id is not null then managed_fund.lookthrough_coverage_status
    else 'not_applicable'
  end as lookthrough_coverage_status,
  case
    when shell_target.party_id is not null then shell_target.lookthrough_beneficiary_rows
    else coalesce(managed_fund.upstream_beneficiary_rows, 0)
  end::int as upstream_beneficiary_rows,
  case
    when shell_target.party_id is not null then shell_target.lookthrough_beneficiary_parties
    else coalesce(managed_fund.upstream_beneficiary_parties, 0)
  end::int as upstream_beneficiary_parties,
  case
    when shell_target.party_id is not null then 0
    else coalesce(managed_fund.upstream_committed_amt, 0)
  end::bigint as upstream_committed_amt,
  (shell_target.party_id is not null) as is_internal_fund_lookthrough_shell,
  coalesce(
    shell_target.resolution_basis,
    case when scope.capital_scope <> 'internal_fund_lookthrough_shell' then scope.resolution_basis end
  ) as internal_fund_shell_resolution_basis,
  coalesce(
    shell_target.resolution_confidence,
    case when scope.capital_scope <> 'internal_fund_lookthrough_shell' then scope.confidence end
  )::numeric(4, 3) as internal_fund_shell_resolution_confidence
from public.party_exposure_commitment_current current_row
left join public.party_managed_fund_resolution_v1 managed_fund
  on managed_fund.party_id = current_row.party_id
left join public.party_capital_scope_overrides scope
  on scope.party_id = current_row.party_id
 and scope.role_type = current_row.role_type
left join ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 shell_target
  on shell_target.party_id = current_row.party_id
 and shell_target.role_type = current_row.role_type
 and shell_target.fund_id = current_row.fund_id;

comment on view public.party_exposure_external_current_v1 is
  'Direct exposure rows with Account rollup scope. Internal IGIS-managed funds and look-through shells are preserved as relationship evidence but excluded from Account totals for every role.';

notify pgrst, 'reload schema';
commit;
