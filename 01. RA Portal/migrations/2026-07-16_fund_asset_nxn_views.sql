-- Fund(vehicle) x asset N:N read model.
--
-- Principles:
-- 1. Preserve every source edge in asset_fund_links.
-- 2. Never merge assets on a similar name alone.
-- 3. Expose relationship-specific AUM only when an explicit amount or ratio exists.
-- 4. Keep unallocated/review edges searchable while excluding them from amount rollups.

create or replace view public.fund_asset_nxn_edges_v1 as
with asset_identity as (
    select
        am.*,
        lower(
            regexp_replace(
                btrim(coalesce(nullif(am.canonical_name, ''), nullif(am.physical_asset_name, ''), nullif(am.non_physical_asset_label, ''), am.asset_id)),
                '\s+',
                ' ',
                'g'
            )
        ) as exact_name_key
    from public.asset_master am
),
fund_degree as (
    select fund_id::text as fund_id, count(distinct asset_id)::integer as asset_count
    from public.asset_fund_links
    group by fund_id
),
asset_degree as (
    select asset_id::text as asset_id, count(distinct fund_id)::integer as fund_count
    from public.asset_fund_links
    group by asset_id
),
pair_degree as (
    select fund_id::text as fund_id, asset_id::text as asset_id, count(*)::integer as relation_row_count
    from public.asset_fund_links
    group by fund_id, asset_id
),
name_degree as (
    select exact_name_key, count(distinct asset_id)::integer as asset_id_count
    from asset_identity
    where exact_name_key is not null and exact_name_key <> ''
    group by exact_name_key
),
fund_name_degree as (
    select
        afl.fund_id::text as fund_id,
        ai.exact_name_key,
        count(distinct afl.asset_id)::integer as asset_id_count
    from public.asset_fund_links afl
    join asset_identity ai on ai.asset_id = afl.asset_id
    where ai.exact_name_key is not null and ai.exact_name_key <> ''
    group by afl.fund_id, ai.exact_name_key
)
select
    md5(concat_ws('|', afl.fund_id, afl.asset_id, coalesce(afl.relation_type, 'fund_asset'))) as relationship_key,
    afl.fund_id::text as fund_id,
    coalesce(nullif(f.short_name, ''), nullif(f.fund_name, ''), f.fund_id::text) as fund_display_name,
    f.fund_name,
    f.status as fund_status,
    coalesce(f.fund_type, f.fund_class, f.notion_vehicle_class) as vehicle_type,
    f.parent_fund_id::text as parent_fund_id,
    coalesce(nullif(parent_fund.short_name, ''), nullif(parent_fund.fund_name, ''), parent_fund.fund_id::text) as parent_fund_display_name,
    f.aum_base_date,
    f.benchmark_aum as fund_benchmark_aum,
    f.invested_aum as fund_invested_aum,
    afl.asset_id::text as asset_id,
    coalesce(nullif(ai.physical_asset_name, ''), nullif(ai.non_physical_asset_label, ''), nullif(ai.canonical_name, ''), nullif(ai.asset_code, ''), ai.asset_id) as asset_display_name,
    ai.canonical_name as asset_source_name,
    ai.asset_code,
    ai.asset_type,
    ai.asset_kind,
    ai.is_physical,
    ai.is_synthetic,
    ai.portfolio_region,
    ai.business_stage,
    ai.pnu,
    ai.address_text,
    coalesce(fd.asset_count, 0) as fund_asset_count,
    coalesce(ad.fund_count, 0) as asset_vehicle_count,
    case
        when coalesce(fd.asset_count, 0) > 1 and coalesce(ad.fund_count, 0) > 1 then 'N:N'
        when coalesce(fd.asset_count, 0) > 1 then '1:N'
        when coalesce(ad.fund_count, 0) > 1 then 'N:1'
        else '1:1'
    end as relationship_shape,
    afl.relation_type,
    afl.exposure_role,
    afl.directness,
    afl.confidence,
    afl.source_table,
    afl.source_id,
    afl.include_in_asset_aum,
    afl.allocation_status,
    afl.allocation_ratio,
    afl.needs_allocation_review,
    case
        when afl.include_in_asset_aum is false then 'excluded'
        when afl.needs_allocation_review is true or coalesce(afl.allocation_status, '') = 'mixed_requires_review' then 'review_required'
        when afl.benchmark_aum_allocated is not null
          or afl.invested_aum_allocated is not null
          or afl.allocation_ratio is not null then 'allocated'
        else 'unallocated'
    end as amount_status,
    (
        afl.include_in_asset_aum is true
        and coalesce(afl.needs_allocation_review, false) is false
        and coalesce(afl.allocation_status, '') <> 'mixed_requires_review'
        and (
            afl.benchmark_aum_allocated is not null
            or afl.invested_aum_allocated is not null
            or afl.allocation_ratio is not null
        )
    ) as include_in_amount_rollup,
    coalesce(
        afl.benchmark_aum_allocated,
        case
            when afl.allocation_ratio is not null then round(coalesce(f.benchmark_aum, 0) * afl.allocation_ratio)::bigint
        end
    ) as relationship_benchmark_aum,
    coalesce(
        afl.invested_aum_allocated,
        case
            when afl.allocation_ratio is not null then round(coalesce(f.invested_aum, 0) * afl.allocation_ratio)::bigint
        end
    ) as relationship_invested_aum,
    coalesce(pd.relation_row_count, 1) as pair_relation_row_count,
    coalesce(nd.asset_id_count, 1) as exact_name_asset_id_count,
    coalesce(fnd.asset_id_count, 1) > 1 as same_fund_exact_name_multiple_ids,
    ai.review_status as asset_review_status,
    ai.exact_name_key
from public.asset_fund_links afl
join public.v_funds_enriched f on f.fund_id = afl.fund_id
join asset_identity ai on ai.asset_id = afl.asset_id
left join public.v_funds_enriched parent_fund on parent_fund.fund_id = f.parent_fund_id
left join fund_degree fd on fd.fund_id = afl.fund_id::text
left join asset_degree ad on ad.asset_id = afl.asset_id::text
left join pair_degree pd on pd.fund_id = afl.fund_id::text and pd.asset_id = afl.asset_id::text
left join name_degree nd on nd.exact_name_key = ai.exact_name_key
left join fund_name_degree fnd on fnd.fund_id = afl.fund_id::text and fnd.exact_name_key = ai.exact_name_key;

create or replace view public.fund_asset_nxn_by_fund_v1 as
select
    f.fund_id::text as fund_id,
    coalesce(nullif(f.short_name, ''), nullif(f.fund_name, ''), f.fund_id::text) as fund_display_name,
    f.fund_name,
    f.status as fund_status,
    coalesce(f.fund_type, f.fund_class, f.notion_vehicle_class) as vehicle_type,
    f.parent_fund_id::text as parent_fund_id,
    f.aum_base_date,
    f.benchmark_aum,
    f.invested_aum,
    count(distinct edge.asset_id)::integer as linked_asset_count,
    count(edge.relationship_key)::integer as relationship_row_count,
    count(*) filter (where edge.amount_status = 'allocated')::integer as allocated_relationship_count,
    count(*) filter (where edge.amount_status = 'unallocated')::integer as unallocated_relationship_count,
    count(*) filter (where edge.amount_status = 'review_required')::integer as review_relationship_count,
    count(*) filter (where edge.amount_status = 'excluded')::integer as excluded_relationship_count,
    coalesce(
        jsonb_agg(
            jsonb_build_object(
                'asset_id', edge.asset_id,
                'asset_name', edge.asset_display_name,
                'relationship_shape', edge.relationship_shape,
                'relation_type', edge.relation_type,
                'amount_status', edge.amount_status,
                'relationship_benchmark_aum', edge.relationship_benchmark_aum,
                'relationship_invested_aum', edge.relationship_invested_aum,
                'same_fund_exact_name_multiple_ids', edge.same_fund_exact_name_multiple_ids
            )
            order by edge.asset_display_name, edge.asset_id
        ) filter (where edge.relationship_key is not null),
        '[]'::jsonb
    ) as assets
from public.v_funds_enriched f
left join public.fund_asset_nxn_edges_v1 edge on edge.fund_id = f.fund_id::text
group by
    f.fund_id,
    f.short_name,
    f.fund_name,
    f.status,
    f.fund_type,
    f.fund_class,
    f.notion_vehicle_class,
    f.parent_fund_id,
    f.aum_base_date,
    f.benchmark_aum,
    f.invested_aum;

create or replace view public.fund_asset_nxn_by_asset_v1 as
with asset_identity as (
    select
        am.*,
        lower(
            regexp_replace(
                btrim(coalesce(nullif(am.canonical_name, ''), nullif(am.physical_asset_name, ''), nullif(am.non_physical_asset_label, ''), am.asset_id)),
                '\s+',
                ' ',
                'g'
            )
        ) as exact_name_key
    from public.asset_master am
),
name_degree as (
    select exact_name_key, count(distinct asset_id)::integer as asset_id_count
    from asset_identity
    where exact_name_key is not null and exact_name_key <> ''
    group by exact_name_key
)
select
    am.asset_id::text as asset_id,
    coalesce(nullif(am.physical_asset_name, ''), nullif(am.non_physical_asset_label, ''), nullif(am.canonical_name, ''), nullif(am.asset_code, ''), am.asset_id) as asset_display_name,
    am.canonical_name as asset_source_name,
    am.asset_code,
    am.asset_type,
    am.asset_kind,
    am.is_physical,
    am.is_synthetic,
    am.portfolio_region,
    am.business_stage,
    am.pnu,
    am.address_text,
    am.review_status,
    count(distinct edge.fund_id)::integer as linked_vehicle_count,
    count(edge.relationship_key)::integer as relationship_row_count,
    count(distinct edge.fund_id) filter (where edge.fund_status = '운용')::integer as active_vehicle_count,
    count(*) filter (where edge.amount_status = 'allocated')::integer as allocated_relationship_count,
    count(*) filter (where edge.amount_status = 'unallocated')::integer as unallocated_relationship_count,
    count(*) filter (where edge.amount_status = 'review_required')::integer as review_relationship_count,
    count(*) filter (where edge.amount_status = 'excluded')::integer as excluded_relationship_count,
    coalesce(nd.asset_id_count, 1)::integer as exact_name_asset_id_count,
    coalesce(
        jsonb_agg(
            jsonb_build_object(
                'fund_id', edge.fund_id,
                'fund_name', edge.fund_display_name,
                'fund_status', edge.fund_status,
                'relationship_shape', edge.relationship_shape,
                'relation_type', edge.relation_type,
                'amount_status', edge.amount_status,
                'relationship_benchmark_aum', edge.relationship_benchmark_aum,
                'relationship_invested_aum', edge.relationship_invested_aum
            )
            order by edge.fund_display_name, edge.fund_id
        ) filter (where edge.relationship_key is not null),
        '[]'::jsonb
    ) as vehicles
from asset_identity am
left join name_degree nd on nd.exact_name_key = am.exact_name_key
left join public.fund_asset_nxn_edges_v1 edge on edge.asset_id = am.asset_id::text
group by
    am.asset_id,
    am.physical_asset_name,
    am.non_physical_asset_label,
    am.canonical_name,
    am.asset_code,
    am.asset_type,
    am.asset_kind,
    am.is_physical,
    am.is_synthetic,
    am.portfolio_region,
    am.business_stage,
    am.pnu,
    am.address_text,
    am.review_status,
    nd.asset_id_count;

create or replace view public.fund_asset_nxn_reconciliation_v1 as
select 'fund_total'::text as metric, count(*)::bigint as value from public.v_funds_enriched
union all
select 'fund_linked', count(*) from public.fund_asset_nxn_by_fund_v1 where linked_asset_count > 0
union all
select 'fund_unlinked', count(*) from public.fund_asset_nxn_by_fund_v1 where linked_asset_count = 0
union all
select 'asset_total', count(*) from public.asset_master
union all
select 'asset_linked', count(*) from public.fund_asset_nxn_by_asset_v1 where linked_vehicle_count > 0
union all
select 'asset_unlinked', count(*) from public.fund_asset_nxn_by_asset_v1 where linked_vehicle_count = 0
union all
select 'relationship_rows', count(*) from public.fund_asset_nxn_edges_v1
union all
select 'relationship_source_rows', count(*) from public.asset_fund_links
union all
select
    'relationship_row_delta',
    (select count(*) from public.fund_asset_nxn_edges_v1)
    - (select count(*) from public.asset_fund_links)
union all
select 'relationship_unique_pairs', count(distinct fund_id || '|' || asset_id) from public.fund_asset_nxn_edges_v1
union all
select 'relationship_unallocated', count(*) from public.fund_asset_nxn_edges_v1 where amount_status = 'unallocated'
union all
select 'relationship_review_required', count(*) from public.fund_asset_nxn_edges_v1 where amount_status = 'review_required'
union all
select 'relationship_excluded', count(*) from public.fund_asset_nxn_edges_v1 where amount_status = 'excluded'
union all
select 'relationship_orphan', count(*)
from public.asset_fund_links afl
left join public.v_funds_enriched f on f.fund_id = afl.fund_id
left join public.asset_master am on am.asset_id = afl.asset_id
where f.fund_id is null or am.asset_id is null;

comment on view public.fund_asset_nxn_edges_v1 is
    'One row per source fund-asset relationship. Unallocated relationships remain visible but have no relationship-specific AUM.';

comment on view public.fund_asset_nxn_by_fund_v1 is
    'Fund-centric N:N read model with linked asset rows stored as JSON.';

comment on view public.fund_asset_nxn_by_asset_v1 is
    'Asset-centric N:N read model with linked vehicle rows stored as JSON.';

comment on view public.fund_asset_nxn_reconciliation_v1 is
    'Relationship-layer reconciliation metrics for source-row, entity, allocation, and orphan checks.';
