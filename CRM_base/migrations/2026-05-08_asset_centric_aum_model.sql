-- Asset-centric AUM model.
-- This migration extends the existing canonical asset model without dropping
-- logistics-test or other experimental tables.

alter table public.asset_master
    add column if not exists asset_kind text not null default 'physical_asset',
    add column if not exists is_physical boolean not null default true,
    add column if not exists is_synthetic boolean not null default false,
    add column if not exists portfolio_theme text,
    add column if not exists portfolio_region text,
    add column if not exists business_stage text,
    add column if not exists data_completeness text not null default 'unknown',
    add column if not exists manual_input_required boolean not null default false,
    add column if not exists api_enrichment_status text not null default 'not_checked',
    add column if not exists last_api_enriched_at timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_master_asset_kind_chk'
    ) then
        alter table public.asset_master
            add constraint asset_master_asset_kind_chk
            check (asset_kind in ('physical_asset', 'portfolio_asset', 'fund_interest', 'synthetic_bucket'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_master_data_completeness_chk'
    ) then
        alter table public.asset_master
            add constraint asset_master_data_completeness_chk
            check (data_completeness in ('unknown', 'incomplete', 'api_enriched', 'manual_enriched', 'verified'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_master_api_enrichment_status_chk'
    ) then
        alter table public.asset_master
            add constraint asset_master_api_enrichment_status_chk
            check (api_enrichment_status in ('not_checked', 'pending', 'found', 'not_found', 'failed', 'stale'));
    end if;
end $$;

update public.asset_master
set
    is_physical = case when asset_kind = 'physical_asset' then true else false end,
    is_synthetic = case when asset_kind in ('portfolio_asset', 'fund_interest', 'synthetic_bucket') then true else false end
where asset_kind <> 'physical_asset';

create index if not exists idx_asset_master_asset_kind on public.asset_master(asset_kind);
create index if not exists idx_asset_master_asset_type on public.asset_master(asset_type);
create index if not exists idx_asset_master_portfolio_theme on public.asset_master(portfolio_theme);
create index if not exists idx_asset_master_business_stage on public.asset_master(business_stage);

-- Keep current dashboard-compatible AUM fields available as physical columns.
-- Existing upload scripts may still store these values in metadata; this
-- backfills safely where values are numeric/date-shaped.
alter table public.funds
    add column if not exists aum_base_date date,
    add column if not exists base_price numeric,
    add column if not exists net_asset_value numeric,
    add column if not exists aum_input_date date,
    add column if not exists equity_won bigint,
    add column if not exists loan_won bigint,
    add column if not exists deposit_won bigint,
    add column if not exists benchmark_aum bigint,
    add column if not exists invested_equity_won bigint,
    add column if not exists invested_loan_won bigint,
    add column if not exists invested_deposit_won bigint,
    add column if not exists invested_aum bigint,
    add column if not exists termination_date date,
    add column if not exists aum_status text,
    add column if not exists aum_source text;

update public.funds
set
    aum_base_date = coalesce(aum_base_date, case when metadata->>'aum_base_date' ~ '^\d{4}-\d{2}-\d{2}$' then (metadata->>'aum_base_date')::date end),
    base_price = coalesce(base_price, case when metadata->>'base_price' ~ '^-?\d+(\.\d+)?$' then (metadata->>'base_price')::numeric end),
    net_asset_value = coalesce(net_asset_value, case when metadata->>'net_asset_value' ~ '^-?\d+(\.\d+)?$' then (metadata->>'net_asset_value')::numeric end),
    aum_input_date = coalesce(aum_input_date, case when metadata->>'aum_input_date' ~ '^\d{4}-\d{2}-\d{2}$' then (metadata->>'aum_input_date')::date end),
    equity_won = coalesce(equity_won, case when metadata->>'equity_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'equity_won')::numeric)::bigint end),
    loan_won = coalesce(loan_won, case when metadata->>'loan_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'loan_won')::numeric)::bigint end),
    deposit_won = coalesce(deposit_won, case when metadata->>'deposit_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'deposit_won')::numeric)::bigint end),
    benchmark_aum = coalesce(benchmark_aum, case when metadata->>'benchmark_aum' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'benchmark_aum')::numeric)::bigint end),
    invested_equity_won = coalesce(invested_equity_won, case when metadata->>'invested_equity_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'invested_equity_won')::numeric)::bigint end),
    invested_loan_won = coalesce(invested_loan_won, case when metadata->>'invested_loan_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'invested_loan_won')::numeric)::bigint end),
    invested_deposit_won = coalesce(invested_deposit_won, case when metadata->>'invested_deposit_won' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'invested_deposit_won')::numeric)::bigint end),
    invested_aum = coalesce(invested_aum, case when metadata->>'invested_aum' ~ '^-?\d+(\.\d+)?$' then round((metadata->>'invested_aum')::numeric)::bigint end),
    termination_date = coalesce(termination_date, case when metadata->>'termination_date' ~ '^\d{4}-\d{2}-\d{2}$' then (metadata->>'termination_date')::date end),
    aum_status = coalesce(aum_status, metadata->>'aum_status'),
    aum_source = coalesce(aum_source, metadata->>'aum_source')
where metadata ?| array[
    'aum_base_date', 'base_price', 'net_asset_value', 'aum_input_date',
    'equity_won', 'loan_won', 'deposit_won', 'benchmark_aum',
    'invested_equity_won', 'invested_loan_won', 'invested_deposit_won',
    'invested_aum', 'termination_date', 'aum_status', 'aum_source'
];

create index if not exists idx_funds_benchmark_aum on public.funds(benchmark_aum);
create index if not exists idx_funds_invested_aum on public.funds(invested_aum);
create index if not exists idx_funds_aum_status on public.funds(aum_status);

-- Relation-level AUM allocation and classification.
alter table public.asset_fund_links
    add column if not exists exposure_role text not null default 'direct_owner',
    add column if not exists directness text not null default 'direct',
    add column if not exists allocation_ratio numeric,
    add column if not exists allocation_status text not null default 'unallocated',
    add column if not exists include_in_asset_aum boolean not null default true,
    add column if not exists benchmark_aum_allocated bigint,
    add column if not exists invested_aum_allocated bigint,
    add column if not exists equity_won_allocated bigint,
    add column if not exists loan_won_allocated bigint,
    add column if not exists deposit_won_allocated bigint,
    add column if not exists invested_equity_won_allocated bigint,
    add column if not exists invested_loan_won_allocated bigint,
    add column if not exists invested_deposit_won_allocated bigint,
    add column if not exists aum_basis_source text,
    add column if not exists needs_allocation_review boolean not null default false;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_fund_links_allocation_ratio_chk'
    ) then
        alter table public.asset_fund_links
            add constraint asset_fund_links_allocation_ratio_chk
            check (allocation_ratio is null or (allocation_ratio >= 0 and allocation_ratio <= 1));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_fund_links_exposure_role_chk'
    ) then
        alter table public.asset_fund_links
            add constraint asset_fund_links_exposure_role_chk
            check (exposure_role in ('direct_owner', 'portfolio_exposure', 'fund_interest', 'synthetic_exposure', 'reference_only'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_fund_links_directness_chk'
    ) then
        alter table public.asset_fund_links
            add constraint asset_fund_links_directness_chk
            check (directness in ('direct', 'inferred_direct', 'look_through', 'synthetic', 'reference'));
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'asset_fund_links_allocation_status_chk'
    ) then
        alter table public.asset_fund_links
            add constraint asset_fund_links_allocation_status_chk
            check (allocation_status in ('unallocated', 'full', 'ratio', 'amount', 'mixed_requires_review', 'not_applicable'));
    end if;
end $$;

update public.asset_fund_links
set
    exposure_role = case
        when relation_type in ('underlying_asset', 'direct_underlying_asset', 'inferred_underlying_asset') then 'direct_owner'
        when relation_type in ('portfolio_exposure') then 'portfolio_exposure'
        when relation_type in ('fund_interest') then 'fund_interest'
        else exposure_role
    end,
    directness = case
        when relation_type = 'inferred_underlying_asset' then 'inferred_direct'
        when relation_type in ('portfolio_exposure', 'fund_interest') then 'synthetic'
        else directness
    end
where exposure_role = 'direct_owner' and directness = 'direct';

create index if not exists idx_asset_fund_links_asset_role on public.asset_fund_links(asset_id, exposure_role);
create index if not exists idx_asset_fund_links_include_aum on public.asset_fund_links(include_in_asset_aum);
create index if not exists idx_asset_fund_links_allocation_status on public.asset_fund_links(allocation_status);

-- Fund-to-fund look-through relation. This captures portfolio/fund-of-fund
-- vehicles investing into a direct asset-owning fund.
create table if not exists public.fund_fund_links (
    link_id bigserial primary key,
    investor_fund_id text not null references public.funds(fund_id) on delete cascade,
    target_fund_id text not null references public.funds(fund_id) on delete cascade,
    relation_type text not null default 'investor_in_fund',
    commitment_amount bigint,
    invested_amount bigint,
    ownership_ratio numeric,
    confidence numeric not null default 0,
    source_table text,
    source_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (investor_fund_id, target_fund_id, relation_type)
);

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'fund_fund_links_ownership_ratio_chk'
    ) then
        alter table public.fund_fund_links
            add constraint fund_fund_links_ownership_ratio_chk
            check (ownership_ratio is null or (ownership_ratio >= 0 and ownership_ratio <= 1));
    end if;
end $$;

create index if not exists idx_fund_fund_links_investor on public.fund_fund_links(investor_fund_id);
create index if not exists idx_fund_fund_links_target on public.fund_fund_links(target_fund_id);

-- Minimal manual development-asset input. API-fillable physical details remain
-- in asset_master / asset_building_ledger and can be refreshed after completion.
create table if not exists public.asset_development_details (
    asset_id text primary key references public.asset_master(asset_id) on delete cascade,
    development_project_name text,
    planned_main_usage text,
    planned_gross_floor_area numeric,
    expected_completion_date date,
    development_stage text,
    data_confidence text,
    notes text,
    input_source text not null default 'manual_modal',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.asset_manual_input_log (
    input_id bigserial primary key,
    asset_id text not null references public.asset_master(asset_id) on delete cascade,
    input_context text not null default 'development_asset_modal',
    input_payload jsonb not null default '{}'::jsonb,
    input_by text,
    created_at timestamptz not null default now()
);

create index if not exists idx_asset_development_expected_completion on public.asset_development_details(expected_completion_date);
create index if not exists idx_asset_manual_input_asset on public.asset_manual_input_log(asset_id);

-- Public view for asset-centric AUM calculation. The dashboard should migrate
-- from fund-row summation to this relation-level view.
create or replace view public.asset_fund_aum_inputs as
select
    afl.asset_id,
    am.canonical_name,
    am.asset_kind,
    am.asset_type,
    am.portfolio_theme,
    am.portfolio_region,
    am.business_stage,
    am.is_physical,
    am.is_synthetic,
    afl.fund_id,
    f.fund_name,
    f.short_name,
    f.status as fund_status,
    coalesce(f.aum_status, f.metadata->>'aum_status', f.status) as aum_status,
    f.notion_holding_type_class,
    f.notion_base_asset_class,
    f.notion_business_stage_class,
    afl.relation_type,
    afl.exposure_role,
    afl.directness,
    afl.allocation_ratio,
    afl.allocation_status,
    afl.include_in_asset_aum,
    afl.needs_allocation_review,
    coalesce(
        afl.benchmark_aum_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.benchmark_aum, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.benchmark_aum end
    ) as benchmark_aum_effective,
    coalesce(
        afl.invested_aum_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.invested_aum, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.invested_aum end
    ) as invested_aum_effective,
    coalesce(
        afl.equity_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.equity_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.equity_won end
    ) as equity_won_effective,
    coalesce(
        afl.loan_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.loan_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.loan_won end
    ) as loan_won_effective,
    coalesce(
        afl.deposit_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.deposit_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.deposit_won end
    ) as deposit_won_effective,
    coalesce(
        afl.invested_equity_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.invested_equity_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.invested_equity_won end
    ) as invested_equity_won_effective,
    coalesce(
        afl.invested_loan_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.invested_loan_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.invested_loan_won end
    ) as invested_loan_won_effective,
    coalesce(
        afl.invested_deposit_won_allocated,
        case when afl.allocation_ratio is not null then round(coalesce(f.invested_deposit_won, 0) * afl.allocation_ratio)::bigint end,
        case when afl.include_in_asset_aum and afl.allocation_status in ('full', 'unallocated') then f.invested_deposit_won end
    ) as invested_deposit_won_effective,
    afl.confidence,
    afl.aum_basis_source,
    afl.metadata as relation_metadata
from public.asset_fund_links afl
join public.asset_master am on am.asset_id = afl.asset_id
join public.funds f on f.fund_id = afl.fund_id
where afl.include_in_asset_aum = true;

create or replace view public.asset_aum_summary as
select
    asset_id,
    canonical_name,
    asset_kind,
    asset_type,
    portfolio_theme,
    portfolio_region,
    business_stage,
    is_physical,
    is_synthetic,
    count(distinct fund_id) as fund_count,
    coalesce(sum(benchmark_aum_effective), 0) as benchmark_aum,
    coalesce(sum(invested_aum_effective), 0) as invested_aum,
    coalesce(sum(equity_won_effective), 0) as equity_won,
    coalesce(sum(loan_won_effective), 0) as loan_won,
    coalesce(sum(deposit_won_effective), 0) as deposit_won,
    coalesce(sum(invested_equity_won_effective), 0) as invested_equity_won,
    coalesce(sum(invested_loan_won_effective), 0) as invested_loan_won,
    coalesce(sum(invested_deposit_won_effective), 0) as invested_deposit_won,
    bool_or(needs_allocation_review) as needs_allocation_review
from public.asset_fund_aum_inputs
group by
    asset_id,
    canonical_name,
    asset_kind,
    asset_type,
    portfolio_theme,
    portfolio_region,
    business_stage,
    is_physical,
    is_synthetic;

create or replace view public.fund_lookthrough_asset_aum as
select
    ffl.investor_fund_id,
    investor.fund_name as investor_fund_name,
    ffl.target_fund_id,
    target.fund_name as target_fund_name,
    afi.asset_id,
    afi.canonical_name,
    afi.asset_kind,
    afi.asset_type,
    afi.portfolio_theme,
    afi.portfolio_region,
    ffl.relation_type,
    ffl.ownership_ratio,
    coalesce(
        case when ffl.ownership_ratio is not null then round(coalesce(afi.benchmark_aum_effective, 0) * ffl.ownership_ratio)::bigint end,
        ffl.commitment_amount,
        0
    ) as benchmark_aum_lookthrough,
    coalesce(
        case when ffl.ownership_ratio is not null then round(coalesce(afi.invested_aum_effective, 0) * ffl.ownership_ratio)::bigint end,
        ffl.invested_amount,
        0
    ) as invested_aum_lookthrough,
    ffl.confidence,
    ffl.metadata
from public.fund_fund_links ffl
join public.funds investor on investor.fund_id = ffl.investor_fund_id
join public.funds target on target.fund_id = ffl.target_fund_id
left join public.asset_fund_aum_inputs afi on afi.fund_id = ffl.target_fund_id;

comment on table public.fund_fund_links is
    'Fund-to-fund look-through links. Used to connect FoF/portfolio vehicles to direct asset-owning funds.';

comment on table public.asset_development_details is
    'Minimal manual input for development assets. API-fillable physical details should stay in asset_master or asset_building_ledger.';

comment on view public.asset_aum_summary is
    'Asset-centric AUM summary for dashboard filters. Includes physical and synthetic portfolio assets.';
