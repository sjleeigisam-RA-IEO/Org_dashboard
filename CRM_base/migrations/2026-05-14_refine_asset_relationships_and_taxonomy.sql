-- 2026-05-14 Refinement of asset relationships and introduction of canonical taxonomy.
-- Implements multi-asset array representation and standardized virtual portfolio assets.

-- 1. Extend funds and projects with primary_asset_ids array to support 1-2 multi-asset vehicles.
alter table public.funds
    add column if not exists primary_asset_ids text[];

alter table public.projects
    add column if not exists primary_asset_ids text[];

create index if not exists idx_funds_primary_asset_ids on public.funds using gin(primary_asset_ids);
create index if not exists idx_projects_primary_asset_ids on public.projects using gin(primary_asset_ids);

-- 2. Update summary views to reflect multiple linked assets seamlessly.
create or replace view public.fund_asset_summary as
select
    f.fund_id,
    f.fund_name,
    f.short_name,
    f.notion_base_asset_class,
    f.notion_holding_type_class,
    f.status,
    f.benchmark_aum,
    f.primary_asset_id as single_primary_asset_id,
    coalesce(f.primary_asset_ids, array_remove(array_agg(distinct afl.asset_id), null)) as asset_ids,
    array_remove(array_agg(distinct am.canonical_name), null) as asset_names,
    count(distinct afl.asset_id) as linked_asset_count
from public.funds f
left join public.asset_fund_links afl on afl.fund_id = f.fund_id
left join public.asset_master am on am.asset_id = afl.asset_id
group by f.fund_id, f.fund_name, f.short_name, f.notion_base_asset_class, f.notion_holding_type_class, f.status, f.benchmark_aum, f.primary_asset_id, f.primary_asset_ids;

comment on view public.fund_asset_summary is
    'Summarizes funds with their array of linked canonical assets (supporting 1-2 multi-asset vehicles).';
