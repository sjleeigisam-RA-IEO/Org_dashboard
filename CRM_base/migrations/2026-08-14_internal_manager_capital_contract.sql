-- Internal-manager capital scope contract.
--
-- Entity classification and investor-rollup scope are separate concerns. An
-- asset manager remains a financial institution in the party taxonomy, while
-- manager/sponsor capital is excluded from the external-investor leaderboard.
-- The direct beneficiary facts and their fund/asset relationships are retained.

begin;

create table if not exists public.party_capital_scope_overrides (
  party_id text not null,
  role_type text not null check (role_type in ('beneficiary', 'lender')),
  capital_scope text not null check (
    capital_scope in ('external_party', 'internal_managed_fund', 'internal_manager_capital')
  ),
  include_in_external_investor_rollup boolean not null,
  resolution_basis text not null,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  source_note text,
  updated_at timestamptz not null default now(),
  primary key (party_id, role_type)
);

comment on table public.party_capital_scope_overrides is
  'Auditable business-scope overrides for party exposure rollups. This does not change the legal entity classification or delete exposure facts.';

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
)
values (
  'pty_fd1712a508dbd8e44c2441fd',
  'beneficiary',
  'internal_manager_capital',
  false,
  'authoritative_business_scope_override',
  1.000,
  'confirmed',
  'External-validation rows identify IGIS Asset Management / proprietary capital. Preserve direct relationships, but exclude manager/sponsor internal capital from the external-investor ranking.',
  now()
)
on conflict (party_id, role_type) do update
set
  capital_scope = excluded.capital_scope,
  include_in_external_investor_rollup = excluded.include_in_external_investor_rollup,
  resolution_basis = excluded.resolution_basis,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  source_note = excluded.source_note,
  updated_at = excluded.updated_at;

create or replace view public.party_internal_manager_capital_resolution_v1 as
select
  scope.party_id,
  min(pm.display_name) as party_name,
  scope.role_type,
  scope.capital_scope,
  scope.include_in_external_investor_rollup,
  scope.resolution_basis,
  scope.confidence,
  scope.review_status,
  scope.source_note,
  count(current_row.exposure_uid)::int as exposure_rows,
  count(distinct current_row.fund_id)::int as target_fund_count,
  coalesce(sum(current_row.committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(current_row.invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(current_row.drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(current_row.remaining_amt), 0)::bigint as remaining_amt
from public.party_capital_scope_overrides scope
join public.party_master pm
  on pm.party_id = scope.party_id
left join public.party_exposure_commitment_current current_row
  on current_row.party_id = scope.party_id
 and current_row.role_type = scope.role_type
where scope.capital_scope = 'internal_manager_capital'
group by
  scope.party_id,
  scope.role_type,
  scope.capital_scope,
  scope.include_in_external_investor_rollup,
  scope.resolution_basis,
  scope.confidence,
  scope.review_status,
  scope.source_note;

comment on view public.party_internal_manager_capital_resolution_v1 is
  'Manager/sponsor internal-capital identities and their preserved direct exposure totals.';

create or replace view public.party_exposure_external_current_v1 as
select
  current_row.*,
  coalesce(managed_fund.managed_fund_ids, array[]::text[]) as investor_managed_fund_ids,
  coalesce(managed_fund.managed_fund_names, array[]::text[]) as investor_managed_fund_names,
  managed_fund.resolution_type as internal_fund_resolution_type,
  managed_fund.confidence as internal_fund_resolution_confidence,
  case
    when scope.party_id is not null then scope.capital_scope
    when managed_fund.party_id is not null then 'internal_managed_fund'
    else 'external_party'
  end as capital_scope,
  case
    when current_row.role_type <> 'beneficiary' then true
    when scope.party_id is not null then scope.include_in_external_investor_rollup
    else managed_fund.party_id is null
  end as include_in_external_investor_rollup,
  (managed_fund.party_id is not null) as is_managed_fund_party,
  case
    when managed_fund.party_id is null then 'not_applicable'
    else managed_fund.lookthrough_coverage_status
  end as lookthrough_coverage_status,
  coalesce(managed_fund.upstream_beneficiary_rows, 0)::int as upstream_beneficiary_rows,
  coalesce(managed_fund.upstream_beneficiary_parties, 0)::int as upstream_beneficiary_parties,
  coalesce(managed_fund.upstream_committed_amt, 0)::bigint as upstream_committed_amt,
  coalesce(scope.capital_scope = 'internal_manager_capital', false) as is_internal_manager_capital,
  scope.resolution_basis as internal_manager_resolution_basis,
  scope.confidence as internal_manager_resolution_confidence
from public.party_exposure_commitment_current current_row
left join public.party_managed_fund_resolution_v1 managed_fund
  on managed_fund.party_id = current_row.party_id
left join public.party_capital_scope_overrides scope
  on scope.party_id = current_row.party_id
 and scope.role_type = current_row.role_type;

comment on view public.party_exposure_external_current_v1 is
  'Direct exposure rows with managed-fund and manager-capital scope flags. Facts remain at legal exposure grain; external-investor KPIs exclude internal capital without deleting relationship evidence.';

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

create or replace view public.party_external_investor_scope_reconciliation_v1 as
with totals as (
  select
    role_type,
    count(*)::bigint as direct_rows,
    count(*) filter (where include_in_external_investor_rollup)::bigint as external_rows,
    count(*) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund')::bigint as internal_managed_fund_rows,
    count(*) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_manager_capital')::bigint as internal_manager_rows,
    coalesce(sum(committed_amt), 0)::bigint as direct_committed_amt,
    coalesce(sum(committed_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_committed_amt,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_committed_amt,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_manager_capital'), 0)::bigint as internal_manager_committed_amt,
    coalesce(sum(invested_amt), 0)::bigint as direct_invested_amt,
    coalesce(sum(invested_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_invested_amt,
    coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_invested_amt,
    coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_manager_capital'), 0)::bigint as internal_manager_invested_amt,
    coalesce(sum(drawn_amt), 0)::bigint as direct_drawn_amt,
    coalesce(sum(drawn_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_drawn_amt,
    coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_drawn_amt,
    coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_manager_capital'), 0)::bigint as internal_manager_drawn_amt,
    coalesce(sum(remaining_amt), 0)::bigint as direct_remaining_amt,
    coalesce(sum(remaining_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_remaining_amt,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_remaining_amt,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_manager_capital'), 0)::bigint as internal_manager_remaining_amt
  from public.party_exposure_external_current_v1
  group by role_type
)
select
  totals.*,
  direct_rows = external_rows + internal_managed_fund_rows + internal_manager_rows as row_partition_valid,
  direct_committed_amt = external_committed_amt + internal_managed_fund_committed_amt + internal_manager_committed_amt as committed_partition_valid,
  direct_invested_amt = external_invested_amt + internal_managed_fund_invested_amt + internal_manager_invested_amt as invested_partition_valid,
  direct_drawn_amt = external_drawn_amt + internal_managed_fund_drawn_amt + internal_manager_drawn_amt as drawn_partition_valid,
  direct_remaining_amt = external_remaining_amt + internal_managed_fund_remaining_amt + internal_manager_remaining_amt as remaining_partition_valid
from totals;

comment on view public.party_external_investor_scope_reconciliation_v1 is
  'Control equation: direct exposure facts equal external investors plus internal managed-fund legs plus internal manager/sponsor capital.';

do $$
declare
  source_manager_rows bigint;
  resolved_manager_rows bigint;
  invalid_exclusions bigint;
  invalid_reconciliations bigint;
begin
  select count(*) into source_manager_rows
  from public.party_exposure_commitment_current
  where role_type = 'beneficiary'
    and party_id = 'pty_fd1712a508dbd8e44c2441fd';

  select count(*) into resolved_manager_rows
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and party_id = 'pty_fd1712a508dbd8e44c2441fd'
    and is_internal_manager_capital
    and not include_in_external_investor_rollup;

  if source_manager_rows = 0 or source_manager_rows <> resolved_manager_rows then
    raise exception 'Internal manager capital resolution mismatch: source %, resolved %', source_manager_rows, resolved_manager_rows;
  end if;

  select count(*) into invalid_exclusions
  from public.party_exposure_external_current_v1
  where not include_in_external_investor_rollup
    and (
      role_type <> 'beneficiary'
      or capital_scope not in ('internal_managed_fund', 'internal_manager_capital')
    );

  if invalid_exclusions <> 0 then
    raise exception 'Invalid external-investor exclusions: %', invalid_exclusions;
  end if;

  select count(*) into invalid_reconciliations
  from public.party_external_investor_scope_reconciliation_v1
  where not row_partition_valid
     or not committed_partition_valid
     or not invested_partition_valid
     or not drawn_partition_valid
     or not remaining_partition_valid;

  if invalid_reconciliations <> 0 then
    raise exception 'External-investor scope reconciliation failed for % role(s)', invalid_reconciliations;
  end if;
end
$$;

grant select on public.party_internal_manager_capital_resolution_v1 to anon, authenticated;
grant select on public.party_exposure_external_current_v1 to anon, authenticated;
grant select on public.party_external_investor_rollup_audit to anon, authenticated;
grant select on public.party_external_investor_scope_reconciliation_v1 to anon, authenticated;

notify pgrst, 'reload schema';

commit;
