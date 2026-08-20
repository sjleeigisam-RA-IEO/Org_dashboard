-- Rebase capital analytics on relationship inception cohorts, not source snapshot dates.
begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';

drop view if exists public.party_exposure_timeseries;

create or replace view public.party_exposure_commitment_current as
with dated as (
  select
    fact.*,
    metadata.initial_commitment_date as source_initial_commitment_date,
    lender.drawdown_date as source_loan_drawdown_date,
    lender.start_date as source_loan_start_date,
    fund.setup_date as fund_setup_date,
    case
      when fact.role_type = 'beneficiary' then metadata.initial_commitment_date
      when fact.role_type = 'lender' then coalesce(lender.drawdown_date, lender.start_date)
      else null::date
    end as source_relationship_date
  from public.party_exposure_current fact
  left join public.beneficiary_exposure_source_metadata metadata
    on fact.role_type = 'beneficiary'
   and metadata.exposure_id::text = fact.source_exposure_id
  left join public.lender_exposures lender
    on fact.role_type = 'lender'
   and lender.id::text = fact.source_exposure_id
  left join public.funds fund
    on fund.fund_id::text = fact.fund_id
), resolved as (
  select
    dated.*,
    case
      when dated.source_relationship_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then dated.source_relationship_date
      when dated.fund_setup_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then dated.fund_setup_date
      else null::date
    end as commitment_cohort_date,
    case
      when dated.role_type = 'beneficiary'
       and dated.source_initial_commitment_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'initial_commitment_date'
      when dated.role_type = 'lender'
       and dated.source_loan_drawdown_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'loan_drawdown_date'
      when dated.role_type = 'lender'
       and dated.source_loan_start_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'loan_start_date'
      when dated.fund_setup_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'fund_setup_date_proxy'
      else 'unresolved'
    end as commitment_date_basis,
    case
      when dated.source_relationship_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'source_date'
      when dated.fund_setup_date between date '1990-01-01' and coalesce(dated.base_date, current_date)
        then 'proxy'
      else 'unresolved'
    end as commitment_date_quality
  from dated
)
select
  resolved.*,
  extract(year from resolved.commitment_cohort_date)::int as commitment_cohort_year,
  coalesce(extract(year from resolved.commitment_cohort_date)::int::text, '미상') as commitment_cohort_year_label
from resolved;

create or replace view public.party_exposure_commitment_timeseries as
select
  role_type,
  commitment_cohort_year,
  commitment_cohort_year_label,
  role_class,
  party_origin,
  count(*)::int as exposure_count,
  count(distinct party_id)::int as party_count,
  count(distinct fund_id)::int as fund_count,
  count(*) filter (where commitment_date_quality = 'source_date')::int as source_date_count,
  count(*) filter (where commitment_date_quality = 'proxy')::int as proxy_date_count,
  count(*) filter (where commitment_date_quality = 'unresolved')::int as unresolved_date_count,
  coalesce(sum(committed_amt), 0)::bigint as committed_amt,
  coalesce(sum(invested_amt), 0)::bigint as invested_amt,
  coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
  coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
  coalesce(sum(primary_amount), 0)::bigint as primary_amount
from public.party_exposure_commitment_current
group by role_type, commitment_cohort_year, commitment_cohort_year_label, role_class, party_origin;

create or replace view public.party_exposure_committed_rankings as
select
  ranking.*,
  dense_rank() over (
    partition by ranking.role_type
    order by ranking.committed_amt desc, ranking.party_name, ranking.party_id
  )::int as committed_rank
from public.party_exposure_rankings ranking;

create or replace view public.party_exposure_commitment_contract_audit as
with current_totals as (
  select
    role_type,
    count(*)::bigint as row_count,
    count(*) filter (where commitment_date_quality = 'source_date')::bigint as source_date_rows,
    count(*) filter (where commitment_date_quality = 'proxy')::bigint as proxy_date_rows,
    count(*) filter (where commitment_date_quality = 'unresolved')::bigint as unresolved_date_rows,
    min(commitment_cohort_year) as min_commitment_year,
    max(commitment_cohort_year) as max_commitment_year,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(invested_amt), 0)::bigint as invested_amt,
    coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
    coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
    coalesce(sum(primary_amount), 0)::bigint as primary_amount
  from public.party_exposure_commitment_current
  group by role_type
), timeseries_totals as (
  select
    role_type,
    coalesce(sum(exposure_count), 0)::bigint as row_count,
    coalesce(sum(committed_amt), 0)::bigint as committed_amt,
    coalesce(sum(invested_amt), 0)::bigint as invested_amt,
    coalesce(sum(drawn_amt), 0)::bigint as drawn_amt,
    coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
    coalesce(sum(primary_amount), 0)::bigint as primary_amount
  from public.party_exposure_commitment_timeseries
  group by role_type
)
select
  current_totals.*,
  timeseries_totals.row_count as timeseries_row_count,
  timeseries_totals.committed_amt as timeseries_committed_amt,
  timeseries_totals.invested_amt as timeseries_invested_amt,
  timeseries_totals.drawn_amt as timeseries_drawn_amt,
  timeseries_totals.remaining_amt as timeseries_remaining_amt,
  timeseries_totals.primary_amount as timeseries_primary_amount,
  current_totals.row_count = current_totals.source_date_rows + current_totals.proxy_date_rows + current_totals.unresolved_date_rows
    as date_basis_rows_match,
  current_totals.row_count = timeseries_totals.row_count
    and current_totals.committed_amt = timeseries_totals.committed_amt
    and current_totals.invested_amt = timeseries_totals.invested_amt
    and current_totals.drawn_amt = timeseries_totals.drawn_amt
    and current_totals.remaining_amt = timeseries_totals.remaining_amt
    and current_totals.primary_amount = timeseries_totals.primary_amount
    as timeseries_totals_match
from current_totals
join timeseries_totals using (role_type);

grant select on public.party_exposure_commitment_current to anon, authenticated;
grant select on public.party_exposure_commitment_timeseries to anon, authenticated;
grant select on public.party_exposure_committed_rankings to anon, authenticated;
grant select on public.party_exposure_commitment_contract_audit to authenticated;

comment on view public.party_exposure_commitment_current is
  'Current exposure rows enriched with relationship inception cohort. Beneficiary uses initial commitment date; lender uses drawdown/start date; missing or invalid dates use fund setup date as an explicit proxy.';
comment on view public.party_exposure_commitment_timeseries is
  'Commitment cohort year totals from current exposures. This is not a source snapshot time series.';
comment on view public.party_exposure_committed_rankings is
  'Canonical party rankings ordered by total committed amount within each role.';
comment on view public.party_exposure_commitment_contract_audit is
  'Reconciles commitment cohort basis rows and all amount subtotals to current exposure totals.';

notify pgrst, 'reload schema';
commit;
