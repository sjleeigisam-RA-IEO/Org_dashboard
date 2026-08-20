-- External-investor rollup contract.
--
-- Direct beneficiary exposure rows remain unchanged. This layer identifies
-- IGIS-managed funds that appear as investors in another managed fund so the
-- dashboard can exclude internal capital-transfer legs from investor totals.

create or replace view public.party_managed_fund_resolution_v1 as
with fund_keys as (
  select
    f.fund_id::text as fund_id,
    f.fund_name,
    public.normalize_party_key(f.fund_name) as exact_name_key,
    public.normalize_party_key(
      regexp_replace(
        f.fund_name,
        '[[:space:]]*\(([0-9]+(의[0-9]+)?종|운용|class[[:space:]]+[[:alnum:]-]+|c[0-9]+)\)[[:space:]]*$',
        '',
        'gi'
      )
    ) as vehicle_name_key
  from public.funds f
  where nullif(btrim(f.fund_name), '') is not null
),
fund_lookup as (
  select
    fund_id,
    fund_name,
    exact_name_key as match_key,
    'exact_name'::text as match_type,
    1.000::numeric(4, 3) as confidence
  from fund_keys
  union all
  select
    fund_id,
    fund_name,
    vehicle_name_key as match_key,
    'share_class_suffix'::text as match_type,
    0.980::numeric(4, 3) as confidence
  from fund_keys
  where vehicle_name_key <> exact_name_key
),
matches as (
  select
    pm.party_id,
    pm.display_name as party_name,
    lookup.fund_id,
    lookup.fund_name,
    lookup.match_type,
    lookup.confidence
  from public.party_master pm
  join fund_lookup lookup
    on lookup.match_key = pm.party_key
),
resolved as (
  select
    party_id,
    min(party_name) as party_name,
    array_agg(distinct fund_id order by fund_id) as managed_fund_ids,
    array_agg(distinct fund_name order by fund_name) as managed_fund_names,
    case
      when bool_or(match_type = 'exact_name') then 'exact_name'
      else 'share_class_suffix'
    end as resolution_type,
    max(confidence)::numeric(4, 3) as confidence,
    'confirmed'::text as resolution_status,
    'fund_master_name_contract'::text as resolution_basis
  from matches
  group by party_id
),
resolved_funds as (
  select
    resolved.party_id,
    unnest(resolved.managed_fund_ids) as fund_id
  from resolved
),
upstream_coverage as (
  select
    resolved_funds.party_id,
    count(distinct upstream.exposure_uid)::int as upstream_beneficiary_rows,
    count(distinct upstream.party_id)::int as upstream_beneficiary_parties,
    coalesce(sum(upstream.committed_amt), 0)::bigint as upstream_committed_amt
  from resolved_funds
  join public.party_exposure_commitment_current upstream
    on upstream.role_type = 'beneficiary'
   and upstream.fund_id::text = resolved_funds.fund_id
  group by resolved_funds.party_id
)
select
  resolved.*,
  coalesce(upstream_coverage.upstream_beneficiary_rows, 0)::int as upstream_beneficiary_rows,
  coalesce(upstream_coverage.upstream_beneficiary_parties, 0)::int as upstream_beneficiary_parties,
  coalesce(upstream_coverage.upstream_committed_amt, 0)::bigint as upstream_committed_amt,
  case
    when coalesce(upstream_coverage.upstream_beneficiary_rows, 0) > 0 then 'direct_upstream_available'
    else 'direct_upstream_missing'
  end as lookthrough_coverage_status
from resolved
left join upstream_coverage
  on upstream_coverage.party_id = resolved.party_id;

comment on view public.party_managed_fund_resolution_v1 is
  'Canonical resolution of a party identity to one or more IGIS-managed fund/share-class IDs. Used to identify internal fund-to-fund capital legs.';

create or replace view public.party_exposure_external_current_v1 as
select
  current_row.*,
  coalesce(resolution.managed_fund_ids, array[]::text[]) as investor_managed_fund_ids,
  coalesce(resolution.managed_fund_names, array[]::text[]) as investor_managed_fund_names,
  resolution.resolution_type as internal_fund_resolution_type,
  resolution.confidence as internal_fund_resolution_confidence,
  case
    when resolution.party_id is not null then 'internal_managed_fund'
    else 'external_party'
  end as capital_scope,
  not (
    current_row.role_type = 'beneficiary' and resolution.party_id is not null
  ) as include_in_external_investor_rollup,
  (resolution.party_id is not null) as is_managed_fund_party,
  case
    when resolution.party_id is null then 'not_applicable'
    else resolution.lookthrough_coverage_status
  end as lookthrough_coverage_status,
  coalesce(resolution.upstream_beneficiary_rows, 0)::int as upstream_beneficiary_rows,
  coalesce(resolution.upstream_beneficiary_parties, 0)::int as upstream_beneficiary_parties,
  coalesce(resolution.upstream_committed_amt, 0)::bigint as upstream_committed_amt
from public.party_exposure_commitment_current current_row
left join public.party_managed_fund_resolution_v1 resolution
  on resolution.party_id = current_row.party_id;

comment on view public.party_exposure_external_current_v1 is
  'Direct exposure rows with managed-fund identity flags. Amounts remain at legal exposure grain; include_in_external_investor_rollup removes internal managed-fund investment legs from investor KPIs without deleting relationship evidence.';

create or replace view public.party_external_investor_rollup_audit as
select
  role_type,
  role_class,
  capital_scope,
  include_in_external_investor_rollup,
  count(*)::int as exposure_rows,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as target_fund_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  lookthrough_coverage_status
from public.party_exposure_external_current_v1
group by role_type, role_class, capital_scope, include_in_external_investor_rollup, lookthrough_coverage_status;

comment on view public.party_external_investor_rollup_audit is
  'Control totals separating external investor capital from internal managed-fund capital-transfer legs.';

grant select on public.party_managed_fund_resolution_v1 to anon, authenticated;
grant select on public.party_exposure_external_current_v1 to anon, authenticated;
grant select on public.party_external_investor_rollup_audit to anon, authenticated;

notify pgrst, 'reload schema';
