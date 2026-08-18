-- Internal fund look-through shell contract.
--
-- IGIS Asset Management beneficiary rows represent an internal fund/vehicle
-- attribution layer, not a second external financial-institution investor.
-- Keep the source rows for relationship evidence, exclude the shell from the
-- external-investor rollup, and count the underlying LP rows exactly once.

begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';

alter table public.party_capital_scope_overrides
  drop constraint if exists party_capital_scope_overrides_capital_scope_check;

update public.party_capital_scope_overrides
set
  capital_scope = 'internal_fund_lookthrough_shell',
  include_in_external_investor_rollup = false,
  resolution_basis = 'business_confirmed_internal_fund_lookthrough_shell',
  confidence = 1.000,
  review_status = 'confirmed',
  source_note = 'IGIS Asset Management is a manager-name shell for an IGIS-raised fund/vehicle investment. Preserve the row as relationship evidence, exclude it from external investor rankings, and count the underlying LP rows once.',
  updated_at = now()
where party_id = 'pty_fd1712a508dbd8e44c2441fd'
  and role_type = 'beneficiary';

alter table public.party_capital_scope_overrides
  add constraint party_capital_scope_overrides_capital_scope_check
  check (
    capital_scope in ('external_party', 'internal_managed_fund', 'internal_fund_lookthrough_shell')
  );

create table if not exists public.party_capital_scope_override_targets (
  party_id text not null,
  role_type text not null check (role_type in ('beneficiary', 'lender')),
  fund_id text not null,
  capital_scope text not null check (capital_scope = 'internal_fund_lookthrough_shell'),
  include_in_external_investor_rollup boolean not null default false,
  resolution_basis text not null,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  review_status text not null check (review_status in ('confirmed', 'review')),
  source_note text,
  updated_at timestamptz not null default now(),
  primary key (party_id, role_type, fund_id)
);

comment on table public.party_capital_scope_override_targets is
  'Exposure-target scope decisions. Manager-name rows are excluded only for reviewed target funds, so future genuine GP capital is not automatically suppressed.';

insert into public.party_capital_scope_override_targets (
  party_id,
  role_type,
  fund_id,
  capital_scope,
  include_in_external_investor_rollup,
  resolution_basis,
  confidence,
  review_status,
  source_note,
  updated_at
)
select distinct
  current_row.party_id,
  current_row.role_type,
  current_row.fund_id,
  'internal_fund_lookthrough_shell',
  false,
  'business_confirmed_current_fund_lookthrough_target',
  1.000,
  'confirmed',
  'Current IGIS manager-name beneficiary row represents an IGIS-raised intermediate fund/vehicle shell, not additive external-investor capital.',
  now()
from public.party_exposure_commitment_current current_row
where current_row.party_id = 'pty_fd1712a508dbd8e44c2441fd'
  and current_row.role_type = 'beneficiary'
  and not exists (
    select 1
    from public.party_capital_scope_override_targets existing_target
    where existing_target.party_id = 'pty_fd1712a508dbd8e44c2441fd'
      and existing_target.role_type = 'beneficiary'
  )
on conflict (party_id, role_type, fund_id) do update
set
  capital_scope = excluded.capital_scope,
  include_in_external_investor_rollup = excluded.include_in_external_investor_rollup,
  resolution_basis = excluded.resolution_basis,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  source_note = excluded.source_note,
  updated_at = excluded.updated_at;

do $$
begin
  if to_regclass('public.party_internal_manager_capital_resolution_v1') is not null
     and to_regclass('public.party_internal_fund_lookthrough_shell_resolution_v1') is null then
    alter view public.party_internal_manager_capital_resolution_v1
      rename to party_internal_fund_lookthrough_shell_resolution_v1;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_exposure_external_current_v1'
      and column_name = 'is_internal_manager_capital'
  ) then
    alter view public.party_exposure_external_current_v1
      rename column is_internal_manager_capital to is_internal_fund_lookthrough_shell;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_exposure_external_current_v1'
      and column_name = 'internal_manager_resolution_basis'
  ) then
    alter view public.party_exposure_external_current_v1
      rename column internal_manager_resolution_basis to internal_fund_shell_resolution_basis;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_exposure_external_current_v1'
      and column_name = 'internal_manager_resolution_confidence'
  ) then
    alter view public.party_exposure_external_current_v1
      rename column internal_manager_resolution_confidence to internal_fund_shell_resolution_confidence;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'party_external_investor_scope_reconciliation_v1'
      and column_name = 'internal_manager_rows'
  ) then
    alter view public.party_external_investor_scope_reconciliation_v1
      rename column internal_manager_rows to internal_fund_shell_rows;
    alter view public.party_external_investor_scope_reconciliation_v1
      rename column internal_manager_committed_amt to internal_fund_shell_committed_amt;
    alter view public.party_external_investor_scope_reconciliation_v1
      rename column internal_manager_invested_amt to internal_fund_shell_invested_amt;
    alter view public.party_external_investor_scope_reconciliation_v1
      rename column internal_manager_drawn_amt to internal_fund_shell_drawn_amt;
    alter view public.party_external_investor_scope_reconciliation_v1
      rename column internal_manager_remaining_amt to internal_fund_shell_remaining_amt;
  end if;
end
$$;

create or replace view public.party_internal_fund_lookthrough_shell_target_v1 as
with beneficiary_rows as (
  select
    exposure_row.*,
    public.normalize_party_key(
      regexp_replace(
        coalesce(exposure_row.fund_name, ''),
        '[[:space:]]*\(([0-9]+(의[0-9]+)?종|운용|class[[:space:]]+[[:alnum:]-]+|c[0-9]+)\)[[:space:]]*$',
        '',
        'gi'
      )
    ) as fund_family_key
  from public.party_exposure_commitment_current exposure_row
  where exposure_row.role_type = 'beneficiary'
),
actual_lp_rows as (
  select beneficiary.*
  from beneficiary_rows beneficiary
  left join public.party_managed_fund_resolution_v1 managed_fund
    on managed_fund.party_id = beneficiary.party_id
  left join public.party_capital_scope_overrides scope
    on scope.party_id = beneficiary.party_id
   and scope.role_type = beneficiary.role_type
  where managed_fund.party_id is null
    and coalesce(scope.include_in_external_investor_rollup, true)
),
shell_targets as (
  select
    target_scope.party_id,
    target_scope.role_type,
    beneficiary.fund_id,
    min(beneficiary.fund_name) as fund_name,
    min(beneficiary.fund_family_key) as fund_family_key,
    count(distinct beneficiary.exposure_uid)::int as shell_rows,
    coalesce(sum(beneficiary.committed_amt), 0)::bigint as shell_committed_amt,
    coalesce(sum(beneficiary.invested_amt), 0)::bigint as shell_invested_amt,
    coalesce(sum(beneficiary.drawn_amt), 0)::bigint as shell_drawn_amt,
    coalesce(sum(beneficiary.remaining_amt), 0)::bigint as shell_remaining_amt
  from public.party_capital_scope_override_targets target_scope
  join beneficiary_rows beneficiary
    on beneficiary.party_id = target_scope.party_id
   and beneficiary.role_type = target_scope.role_type
   and beneficiary.fund_id = target_scope.fund_id
  where target_scope.capital_scope = 'internal_fund_lookthrough_shell'
  group by target_scope.party_id, target_scope.role_type, beneficiary.fund_id
),
same_fund_other as (
  select
    target.party_id,
    target.fund_id,
    count(distinct other_row.exposure_uid)::int as beneficiary_rows,
    count(distinct other_row.party_id)::int as beneficiary_parties,
    coalesce(sum(other_row.committed_amt), 0)::bigint as committed_amt,
    array_agg(distinct other_row.role_class order by other_row.role_class)
      filter (where other_row.role_class is not null) as role_classes
  from shell_targets target
  left join actual_lp_rows other_row
    on other_row.fund_id = target.fund_id
  group by target.party_id, target.fund_id
),
same_family_other as (
  select
    target.party_id,
    target.fund_id,
    count(distinct other_row.exposure_uid)::int as beneficiary_rows,
    count(distinct other_row.party_id)::int as beneficiary_parties,
    coalesce(sum(other_row.committed_amt), 0)::bigint as committed_amt,
    array_agg(distinct other_row.role_class order by other_row.role_class)
      filter (where other_row.role_class is not null) as role_classes
  from shell_targets target
  left join actual_lp_rows other_row
    on other_row.fund_family_key = target.fund_family_key
   and target.fund_family_key <> ''
  group by target.party_id, target.fund_id
),
intermediate_actual_lp as (
  select distinct
    target.party_id as shell_party_id,
    target.fund_id as target_fund_id,
    actual.exposure_uid,
    actual.party_id,
    actual.role_class,
    actual.committed_amt
  from shell_targets target
  join beneficiary_rows intermediate
    on intermediate.fund_id = target.fund_id
    or (
      target.fund_family_key <> ''
      and intermediate.fund_family_key = target.fund_family_key
    )
  join public.party_managed_fund_resolution_v1 managed_fund
    on managed_fund.party_id = intermediate.party_id
  cross join lateral unnest(managed_fund.managed_fund_ids) upstream_fund_id
  join actual_lp_rows actual
    on actual.fund_id = upstream_fund_id
),
intermediate_fund_other as (
  select
    shell_party_id as party_id,
    target_fund_id as fund_id,
    count(distinct exposure_uid)::int as beneficiary_rows,
    count(distinct party_id)::int as beneficiary_parties,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    array_agg(distinct role_class order by role_class)
      filter (where role_class is not null) as role_classes
  from intermediate_actual_lp
  group by shell_party_id, target_fund_id
)
select
  target.*,
  coalesce(same_fund.beneficiary_rows, 0)::int as same_fund_beneficiary_rows,
  coalesce(same_fund.beneficiary_parties, 0)::int as same_fund_beneficiary_parties,
  coalesce(family.beneficiary_rows, 0)::int as family_beneficiary_rows,
  coalesce(family.beneficiary_parties, 0)::int as family_beneficiary_parties,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then 'intermediate_fund_lp_candidates'
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then 'same_fund_lp_candidates'
    when coalesce(family.beneficiary_rows, 0) > 0 then 'share_class_family_lp_candidates'
    else 'lookthrough_unresolved'
  end as lookthrough_coverage_status,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then intermediate.beneficiary_rows
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then same_fund.beneficiary_rows
    when coalesce(family.beneficiary_rows, 0) > 0 then family.beneficiary_rows
    else 0
  end::int as lookthrough_beneficiary_rows,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then intermediate.beneficiary_parties
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then same_fund.beneficiary_parties
    when coalesce(family.beneficiary_rows, 0) > 0 then family.beneficiary_parties
    else 0
  end::int as lookthrough_beneficiary_parties,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then intermediate.committed_amt
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then same_fund.committed_amt
    when coalesce(family.beneficiary_rows, 0) > 0 then family.committed_amt
    else 0
  end::bigint as lookthrough_committed_amt,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then intermediate.role_classes
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then same_fund.role_classes
    when coalesce(family.beneficiary_rows, 0) > 0 then family.role_classes
    else null
  end as lookthrough_role_classes,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then 'candidate_intermediate_managed_fund_to_upstream_lp_rows'
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then 'candidate_same_target_fund_lp_rows'
    when coalesce(family.beneficiary_rows, 0) > 0 then 'candidate_same_fund_share_class_family_lp_rows'
    else 'source_relationship_preserved_but_lp_path_missing'
  end as resolution_basis,
  case
    when coalesce(intermediate.beneficiary_rows, 0) > 0 then 0.800
    when coalesce(same_fund.beneficiary_rows, 0) > 0 then 0.750
    when coalesce(family.beneficiary_rows, 0) > 0 then 0.650
    else 0.500
  end::numeric(4, 3) as resolution_confidence,
  false as include_in_amount_rollup
from shell_targets target
left join same_fund_other same_fund
  on same_fund.party_id = target.party_id
 and same_fund.fund_id = target.fund_id
left join same_family_other family
  on family.party_id = target.party_id
 and family.fund_id = target.fund_id
left join intermediate_fund_other intermediate
  on intermediate.party_id = target.party_id
 and intermediate.fund_id = target.fund_id;

comment on view public.party_internal_fund_lookthrough_shell_target_v1 is
  'Per-target candidate paths from manager-name shell rows toward LP rows. Candidate amounts are relationship evidence only and must never be added to KPI totals.';

comment on column public.party_internal_fund_lookthrough_shell_target_v1.lookthrough_committed_amt is
  'Non-additive candidate-path amount. This can repeat across target funds and is excluded from all amount rollups.';

create schema if not exists ra_internal;

do $shell_target_cache$
begin
  if not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'ra_internal'
      and relation.relname = 'party_internal_fund_lookthrough_shell_target_cache_v1'
      and relation.relkind = 'm'
  ) then
    execute 'create materialized view ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 '
         || 'as select * from public.party_internal_fund_lookthrough_shell_target_v1 with no data';
  end if;
end;
$shell_target_cache$;

refresh materialized view ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1;

create unique index if not exists party_internal_fund_shell_target_cache_uq
  on ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 (party_id, role_type, fund_id);
create index if not exists party_internal_fund_shell_target_cache_fund_idx
  on ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 (fund_id);
create index if not exists party_internal_fund_shell_target_cache_status_idx
  on ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 (lookthrough_coverage_status);

create or replace view public.party_internal_fund_lookthrough_shell_resolution_v1 as
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
  coalesce(sum(target.shell_rows), 0)::int as exposure_rows,
  count(distinct target.fund_id)::int as target_fund_count,
  coalesce(sum(target.shell_committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(target.shell_invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(target.shell_drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(target.shell_remaining_amt), 0)::bigint as remaining_amt,
  count(*) filter (where target.lookthrough_coverage_status = 'same_fund_lp_candidates')::int as same_fund_covered_count,
  count(*) filter (where target.lookthrough_coverage_status = 'share_class_family_lp_candidates')::int as share_class_family_covered_count,
  count(*) filter (where target.lookthrough_coverage_status = 'lookthrough_unresolved')::int as unresolved_target_count,
  count(*) filter (where target.lookthrough_coverage_status = 'intermediate_fund_lp_candidates')::int as intermediate_fund_covered_count
from public.party_capital_scope_overrides scope
join public.party_master pm
  on pm.party_id = scope.party_id
left join ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1 target
  on target.party_id = scope.party_id
 and target.role_type = scope.role_type
where scope.capital_scope = 'internal_fund_lookthrough_shell'
group by
  scope.party_id,
  scope.role_type,
  scope.capital_scope,
  scope.include_in_external_investor_rollup,
  scope.resolution_basis,
  scope.confidence,
  scope.review_status,
  scope.source_note;

comment on view public.party_internal_fund_lookthrough_shell_resolution_v1 is
  'Internal fund look-through shell identities and candidate LP paths. Shell and candidate-path amounts are relationship evidence, not additive external-investor capital.';

create or replace view public.party_exposure_external_current_v1 as
select
  current_row.*,
  coalesce(managed_fund.managed_fund_ids, array[]::text[]) as investor_managed_fund_ids,
  coalesce(managed_fund.managed_fund_names, array[]::text[]) as investor_managed_fund_names,
  managed_fund.resolution_type as internal_fund_resolution_type,
  managed_fund.confidence as internal_fund_resolution_confidence,
  case
    when shell_target.party_id is not null then 'internal_fund_lookthrough_shell'
    when scope.party_id is not null and scope.capital_scope <> 'internal_fund_lookthrough_shell' then scope.capital_scope
    when managed_fund.party_id is not null then 'internal_managed_fund'
    else 'external_party'
  end as capital_scope,
  case
    when current_row.role_type <> 'beneficiary' then true
    when shell_target.party_id is not null then false
    when scope.party_id is not null and scope.capital_scope <> 'internal_fund_lookthrough_shell' then scope.include_in_external_investor_rollup
    else managed_fund.party_id is null
  end as include_in_external_investor_rollup,
  (managed_fund.party_id is not null) as is_managed_fund_party,
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
  'Direct exposure rows with external-investor rollup scope. Internal managed funds and fund look-through shell rows are preserved as relationship evidence but excluded from additive external-investor totals.';

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
    count(*) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell')::bigint as internal_fund_shell_rows,
    coalesce(sum(committed_amt), 0)::bigint as direct_committed_amt,
    coalesce(sum(committed_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_committed_amt,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_committed_amt,
    coalesce(sum(committed_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell'), 0)::bigint as internal_fund_shell_committed_amt,
    coalesce(sum(invested_amt), 0)::bigint as direct_invested_amt,
    coalesce(sum(invested_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_invested_amt,
    coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_invested_amt,
    coalesce(sum(invested_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell'), 0)::bigint as internal_fund_shell_invested_amt,
    coalesce(sum(drawn_amt), 0)::bigint as direct_drawn_amt,
    coalesce(sum(drawn_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_drawn_amt,
    coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_drawn_amt,
    coalesce(sum(drawn_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell'), 0)::bigint as internal_fund_shell_drawn_amt,
    coalesce(sum(remaining_amt), 0)::bigint as direct_remaining_amt,
    coalesce(sum(remaining_amt) filter (where include_in_external_investor_rollup), 0)::bigint as external_remaining_amt,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_remaining_amt,
    coalesce(sum(remaining_amt) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell'), 0)::bigint as internal_fund_shell_remaining_amt
  from public.party_exposure_external_current_v1
  group by role_type
), primary_totals as (
  select
    role_type,
    coalesce(sum(primary_amount), 0)::bigint as direct_primary_amt,
    coalesce(sum(primary_amount) filter (where include_in_external_investor_rollup), 0)::bigint as external_primary_amt,
    coalesce(sum(primary_amount) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_managed_fund'), 0)::bigint as internal_managed_fund_primary_amt,
    coalesce(sum(primary_amount) filter (where not include_in_external_investor_rollup and capital_scope = 'internal_fund_lookthrough_shell'), 0)::bigint as internal_fund_shell_primary_amt
  from public.party_exposure_external_current_v1
  group by role_type
)
select
  totals.*,
  direct_rows = external_rows + internal_managed_fund_rows + internal_fund_shell_rows as row_partition_valid,
  direct_committed_amt = external_committed_amt + internal_managed_fund_committed_amt + internal_fund_shell_committed_amt as committed_partition_valid,
  direct_invested_amt = external_invested_amt + internal_managed_fund_invested_amt + internal_fund_shell_invested_amt as invested_partition_valid,
  direct_drawn_amt = external_drawn_amt + internal_managed_fund_drawn_amt + internal_fund_shell_drawn_amt as drawn_partition_valid,
  direct_remaining_amt = external_remaining_amt + internal_managed_fund_remaining_amt + internal_fund_shell_remaining_amt as remaining_partition_valid,
  primary_totals.direct_primary_amt,
  primary_totals.external_primary_amt,
  primary_totals.internal_managed_fund_primary_amt,
  primary_totals.internal_fund_shell_primary_amt,
  primary_totals.direct_primary_amt = primary_totals.external_primary_amt
    + primary_totals.internal_managed_fund_primary_amt
    + primary_totals.internal_fund_shell_primary_amt as primary_partition_valid
from totals
join primary_totals using (role_type);

comment on view public.party_external_investor_scope_reconciliation_v1 is
  'Control equation for source-row preservation. Direct source rows equal external investors plus excluded internal managed-fund and look-through shell rows; excluded shell amounts are not additive economic capital.';

create or replace function public.refresh_party_exposure_surfaces()
returns void
language plpgsql
security definer
set search_path = public, ra_internal
set statement_timeout = 0
as $$
begin
  refresh materialized view ra_internal.party_exposure_fact_cache;
  refresh materialized view ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1;
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.refresh_party_exposure_surfaces() from public;
grant execute on function public.refresh_party_exposure_surfaces() to service_role;

do $$
declare
  source_shell_rows bigint;
  resolved_shell_rows bigint;
  unresolved_targets bigint;
  invalid_exclusions bigint;
  invalid_reconciliations bigint;
  legacy_scope_rows bigint;
  source_surface_mismatches bigint;
  duplicate_surface_exposures bigint;
begin
  select count(*) into source_shell_rows
  from public.party_exposure_commitment_current source_row
  join public.party_capital_scope_override_targets target_scope
    on target_scope.party_id = source_row.party_id
   and target_scope.role_type = source_row.role_type
   and target_scope.fund_id = source_row.fund_id
  where target_scope.capital_scope = 'internal_fund_lookthrough_shell';

  select count(*) into resolved_shell_rows
  from public.party_exposure_external_current_v1
  where role_type = 'beneficiary'
    and party_id = 'pty_fd1712a508dbd8e44c2441fd'
    and is_internal_fund_lookthrough_shell
    and not include_in_external_investor_rollup;

  if source_shell_rows = 0 or source_shell_rows <> resolved_shell_rows then
    raise exception 'Internal fund shell resolution mismatch: source %, resolved %', source_shell_rows, resolved_shell_rows;
  end if;

  with source_totals as (
    select
      role_type,
      count(*)::bigint as exposure_rows,
      coalesce(sum(committed_amt), 0)::bigint as committed_amt,
      coalesce(sum(invested_amt), 0)::bigint as invested_amt,
      coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
      coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
      coalesce(sum(primary_amount), 0)::bigint as primary_amount
    from public.party_exposure_commitment_current
    group by role_type
  ), surface_totals as (
    select
      role_type,
      count(*)::bigint as exposure_rows,
      coalesce(sum(committed_amt), 0)::bigint as committed_amt,
      coalesce(sum(invested_amt), 0)::bigint as invested_amt,
      coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
      coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
      coalesce(sum(primary_amount), 0)::bigint as primary_amount
    from public.party_exposure_external_current_v1
    group by role_type
  )
  select count(*) into source_surface_mismatches
  from source_totals source
  full join surface_totals surface using (role_type)
  where source.exposure_rows is distinct from surface.exposure_rows
     or source.committed_amt is distinct from surface.committed_amt
     or source.invested_amt is distinct from surface.invested_amt
     or source.drawn_amt is distinct from surface.drawn_amt
     or source.remaining_amt is distinct from surface.remaining_amt
     or source.primary_amount is distinct from surface.primary_amount;

  if source_surface_mismatches <> 0 then
    raise exception 'Source-to-external-surface grain or amount mismatch for % role(s)', source_surface_mismatches;
  end if;

  select count(*) into duplicate_surface_exposures
  from (
    select exposure_uid
    from public.party_exposure_external_current_v1
    group by exposure_uid
    having count(*) <> 1
  ) duplicate_exposure;

  if duplicate_surface_exposures <> 0 then
    raise exception 'External surface duplicated or lost exposure UIDs: %', duplicate_surface_exposures;
  end if;

  select count(*) into unresolved_targets
  from ra_internal.party_internal_fund_lookthrough_shell_target_cache_v1
  where lookthrough_coverage_status = 'lookthrough_unresolved';

  if unresolved_targets > 0 then
    raise notice 'Internal fund shell look-through remains unresolved for % target fund(s); rows stay excluded from additive totals and are flagged for review', unresolved_targets;
  end if;

  select count(*) into invalid_exclusions
  from public.party_exposure_external_current_v1
  where not include_in_external_investor_rollup
    and (
      role_type <> 'beneficiary'
      or capital_scope not in ('internal_managed_fund', 'internal_fund_lookthrough_shell')
    );

  if invalid_exclusions <> 0 then
    raise exception 'Invalid external-investor exclusions: %', invalid_exclusions;
  end if;

  select count(*) into legacy_scope_rows
  from public.party_capital_scope_overrides
  where capital_scope = 'internal_manager_capital';

  if legacy_scope_rows <> 0 then
    raise exception 'Legacy internal_manager_capital scope remains: %', legacy_scope_rows;
  end if;

  select count(*) into invalid_reconciliations
  from public.party_external_investor_scope_reconciliation_v1
  where not row_partition_valid
     or not committed_partition_valid
     or not invested_partition_valid
     or not drawn_partition_valid
     or not remaining_partition_valid
     or not primary_partition_valid;

  if invalid_reconciliations <> 0 then
    raise exception 'External-investor scope reconciliation failed for % role(s)', invalid_reconciliations;
  end if;
end
$$;

grant select on public.party_internal_fund_lookthrough_shell_target_v1 to anon, authenticated;
grant select on public.party_internal_fund_lookthrough_shell_resolution_v1 to anon, authenticated;
grant select on public.party_exposure_external_current_v1 to anon, authenticated;
grant select on public.party_external_investor_rollup_audit to anon, authenticated;
grant select on public.party_external_investor_scope_reconciliation_v1 to anon, authenticated;

notify pgrst, 'reload schema';

commit;
