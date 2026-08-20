-- RA dashboard relationship contract v1.
--
-- Non-destructive contract layer:
-- - Preserve source/master rows.
-- - Make mixed project/fund/pilot relationship targets explicit.
-- - Rebuild dashboard-facing views so different search paths converge on
--   canonical entity keys and deterministic display labels.

alter table public.funds
    add column if not exists primary_asset_ids text[];

alter table public.projects
    add column if not exists primary_asset_ids text[];

alter table public.iota_seoul_log_links
    add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.asset_project_links
    add column if not exists target_code text,
    add column if not exists target_type text,
    add column if not exists resolved_project_id text,
    add column if not exists resolved_fund_id text,
    add column if not exists resolution_status text not null default 'unresolved',
    add column if not exists resolution_note text;

update public.asset_project_links
set target_code = coalesce(target_code, project_id)
where target_code is null;

update public.asset_project_links apl
set
    target_type = case
        when p.project_id is not null then 'project'
        when f.fund_id is not null then 'fund_as_project'
        when apl.project_id ilike 'iota-%' then 'pilot_code'
        else coalesce(apl.target_type, 'unresolved')
    end,
    resolved_project_id = case when p.project_id is not null then p.project_id else apl.resolved_project_id end,
    resolved_fund_id = case when f.fund_id is not null then f.fund_id else apl.resolved_fund_id end,
    resolution_status = case
        when p.project_id is not null or f.fund_id is not null or apl.project_id ilike 'iota-%' then 'resolved'
        else coalesce(nullif(apl.resolution_status, ''), 'unresolved')
    end,
    resolution_note = coalesce(
        apl.resolution_note,
        case
            when p.project_id is not null then 'resolved against projects.project_id'
            when f.fund_id is not null then 'resolved against funds.fund_id'
            when apl.project_id ilike 'iota-%' then 'pilot code retained without hard FK'
            else 'unresolved target_code; review required'
        end
    )
from public.asset_project_links source_apl
left join public.projects p on p.project_id = source_apl.project_id
left join public.funds f on f.fund_id = source_apl.project_id
where apl.asset_id = source_apl.asset_id
  and apl.project_id = source_apl.project_id
  and apl.relation_type = source_apl.relation_type;

create index if not exists idx_asset_project_links_target_type
    on public.asset_project_links(target_type, resolution_status);
create index if not exists idx_asset_project_links_resolved_project
    on public.asset_project_links(resolved_project_id);
create index if not exists idx_asset_project_links_resolved_fund
    on public.asset_project_links(resolved_fund_id);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'asset_project_links_target_type_chk'
    ) then
        alter table public.asset_project_links
            add constraint asset_project_links_target_type_chk
            check (
                target_type is null
                or target_type in ('project', 'fund_as_project', 'pilot_code', 'review_project', 'unresolved')
            );
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'asset_project_links_resolution_status_chk'
    ) then
        alter table public.asset_project_links
            add constraint asset_project_links_resolution_status_chk
            check (
                resolution_status in ('resolved', 'needs_review', 'unresolved', 'ignored')
            );
    end if;
end $$;

drop view if exists public.relationship_contract_audit_v1;
drop view if exists public.dashboard_search_result_contract_audit;
drop view if exists public.portfolio_search_results_canonical;
drop view if exists public.iota_target_resolution;
drop view if exists public.asset_exposure_summary;
drop view if exists public.asset_exposure_edges;
drop view if exists public.fund_as_project_asset_relationships;
drop view if exists public.project_asset_relationships;
drop view if exists public.asset_project_link_resolution;

create or replace view public.asset_project_link_resolution as
select
    apl.asset_id,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id) as canonical_name,
    apl.project_id as legacy_project_id,
    coalesce(apl.target_code, apl.project_id) as target_code,
    coalesce(
        apl.target_type,
        case
            when p.project_id is not null then 'project'
            when f.fund_id is not null then 'fund_as_project'
            when apl.project_id ilike 'iota-%' then 'pilot_code'
            else 'unresolved'
        end
    ) as target_type,
    coalesce(apl.resolved_project_id, p.project_id) as resolved_project_id,
    coalesce(apl.resolved_fund_id, f.fund_id) as resolved_fund_id,
    coalesce(p.project_name, f.fund_name, apl.metadata->>'project_name', apl.project_id) as resolved_display_name,
    apl.relation_type,
    apl.confidence,
    apl.source_table,
    apl.source_id,
    coalesce(apl.resolution_status, case when p.project_id is not null or f.fund_id is not null then 'resolved' else 'unresolved' end) as resolution_status,
    apl.resolution_note
from public.asset_project_links apl
join public.asset_master am on am.asset_id = apl.asset_id
left join public.projects p on p.project_id = apl.project_id
left join public.funds f on f.fund_id = apl.project_id;

create or replace view public.project_asset_relationships as
select
    apl.asset_id,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id) as canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code,
    am.review_status,
    apl.resolved_project_id as project_id,
    coalesce(p.project_name, apl.resolved_display_name) as project_name,
    p.parent_project_id,
    p.project_type,
    p.status as project_status,
    apl.target_type,
    apl.target_code,
    apl.relation_type,
    apl.confidence,
    apl.source_table,
    apl.source_id,
    apl.resolution_status
from public.asset_project_link_resolution apl
join public.asset_master am on am.asset_id = apl.asset_id
left join public.projects p on p.project_id = apl.resolved_project_id
where apl.target_type in ('project', 'pilot_code')
  and apl.resolution_status in ('resolved', 'needs_review')
  and apl.resolved_project_id is not null;

create or replace view public.fund_as_project_asset_relationships as
select
    apl.asset_id,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id) as canonical_name,
    am.address_text,
    am.latitude,
    am.longitude,
    am.pnu,
    am.asset_code,
    am.review_status,
    apl.resolved_fund_id as fund_id,
    f.fund_name,
    f.short_name,
    apl.target_code,
    apl.relation_type,
    apl.confidence,
    apl.source_table,
    apl.source_id,
    apl.resolution_status
from public.asset_project_link_resolution apl
join public.asset_master am on am.asset_id = apl.asset_id
left join public.funds f on f.fund_id = apl.resolved_fund_id
where apl.target_type = 'fund_as_project'
  and apl.resolved_fund_id is not null;

-- Normalize exposure-to-asset edges before any aggregation. Exposure rows with
-- no direct asset_id are derived through fund_id -> asset_fund_links and kept
-- explicitly marked so drawer and audit logic can distinguish the route.
create or replace view public.asset_exposure_edges as
with lender_direct as (
    select
        'lender'::text as exposure_type,
        id::text as exposure_id,
        fund_id,
        asset_id,
        committed_amt,
        drawn_amt,
        null::numeric as invested_amt,
        'direct_asset_id'::text as link_method,
        'direct'::text as allocation_status
    from public.lender_exposures
    where asset_id is not null
),
lender_derived as (
    select
        'lender'::text as exposure_type,
        le.id::text as exposure_id,
        le.fund_id,
        afl.asset_id,
        le.committed_amt,
        le.drawn_amt,
        null::numeric as invested_amt,
        'derived_via_fund_asset_link'::text as link_method,
        case
            when fund_asset_counts.asset_count > 1 then 'multi_asset_review_required'
            else 'derived'
        end as allocation_status
    from public.lender_exposures le
    join public.asset_fund_links afl on afl.fund_id = le.fund_id
    join (
        select fund_id, count(distinct asset_id) as asset_count
        from public.asset_fund_links
        group by fund_id
    ) fund_asset_counts on fund_asset_counts.fund_id = le.fund_id
    where le.asset_id is null
),
beneficiary_direct as (
    select
        'beneficiary'::text as exposure_type,
        id::text as exposure_id,
        fund_id,
        asset_id,
        committed_amt,
        null::numeric as drawn_amt,
        invested_amt,
        'direct_asset_id'::text as link_method,
        'direct'::text as allocation_status
    from public.beneficiary_exposures
    where asset_id is not null
),
beneficiary_derived as (
    select
        'beneficiary'::text as exposure_type,
        be.id::text as exposure_id,
        be.fund_id,
        afl.asset_id,
        be.committed_amt,
        null::numeric as drawn_amt,
        be.invested_amt,
        'derived_via_fund_asset_link'::text as link_method,
        case
            when fund_asset_counts.asset_count > 1 then 'multi_asset_review_required'
            else 'derived'
        end as allocation_status
    from public.beneficiary_exposures be
    join public.asset_fund_links afl on afl.fund_id = be.fund_id
    join (
        select fund_id, count(distinct asset_id) as asset_count
        from public.asset_fund_links
        group by fund_id
    ) fund_asset_counts on fund_asset_counts.fund_id = be.fund_id
    where be.asset_id is null
)
select * from lender_direct
union all
select * from lender_derived
union all
select * from beneficiary_direct
union all
select * from beneficiary_derived;

-- Fix N x M exposure multiplication by pre-aggregating lender and beneficiary
-- independently before joining them to asset_master.
create or replace view public.asset_exposure_summary as
with lender as (
    select
        asset_id,
        coalesce(sum(committed_amt), 0) as lender_committed_amt,
        coalesce(sum(drawn_amt), 0) as lender_drawn_amt,
        count(distinct exposure_id) as lender_exposure_count,
        count(distinct exposure_id) filter (where link_method = 'direct_asset_id') as lender_direct_exposure_count,
        count(distinct exposure_id) filter (where link_method = 'derived_via_fund_asset_link') as lender_derived_exposure_count
    from public.asset_exposure_edges
    where exposure_type = 'lender'
    group by asset_id
),
beneficiary as (
    select
        asset_id,
        coalesce(sum(committed_amt), 0) as beneficiary_committed_amt,
        coalesce(sum(invested_amt), 0) as beneficiary_invested_amt,
        count(distinct exposure_id) as beneficiary_exposure_count,
        count(distinct exposure_id) filter (where link_method = 'direct_asset_id') as beneficiary_direct_exposure_count,
        count(distinct exposure_id) filter (where link_method = 'derived_via_fund_asset_link') as beneficiary_derived_exposure_count
    from public.asset_exposure_edges
    where exposure_type = 'beneficiary'
    group by asset_id
)
select
    am.asset_id,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id) as canonical_name,
    am.address_text,
    coalesce(l.lender_committed_amt, 0) as lender_committed_amt,
    coalesce(l.lender_drawn_amt, 0) as lender_drawn_amt,
    coalesce(b.beneficiary_committed_amt, 0) as beneficiary_committed_amt,
    coalesce(b.beneficiary_invested_amt, 0) as beneficiary_invested_amt,
    coalesce(l.lender_exposure_count, 0) as lender_exposure_count,
    coalesce(l.lender_direct_exposure_count, 0) as lender_direct_exposure_count,
    coalesce(l.lender_derived_exposure_count, 0) as lender_derived_exposure_count,
    coalesce(b.beneficiary_exposure_count, 0) as beneficiary_exposure_count,
    coalesce(b.beneficiary_direct_exposure_count, 0) as beneficiary_direct_exposure_count,
    coalesce(b.beneficiary_derived_exposure_count, 0) as beneficiary_derived_exposure_count
from public.asset_master am
left join lender l on l.asset_id = am.asset_id
left join beneficiary b on b.asset_id = am.asset_id;

create or replace view public.iota_target_resolution as
select
    l.link_id,
    l.log_id,
    l.proj_id as target_code,
    l.asset_id,
    case
        when p.project_id is not null then 'project'
        when f.fund_id is not null then 'fund'
        when l.proj_id ilike 'iota-%' then 'pilot_code'
        else 'unresolved'
    end as resolved_target_type,
    p.project_id as resolved_project_id,
    f.fund_id as resolved_fund_id,
    coalesce(p.project_name, f.fund_name, l.proj_id) as resolved_display_name,
    l.relation_type,
    l.metadata,
    l.created_at
from public.iota_seoul_log_links l
left join public.projects p on p.project_id = l.proj_id
left join public.funds f on f.fund_id = l.proj_id;

create or replace view public.portfolio_search_results_canonical as
with token_rows as (
    select
        entity_type,
        entity_id,
        display_title,
        display_subtitle,
        token_text,
        token_type,
        related_asset_id,
        related_fund_id,
        related_project_id,
        relation_type,
        source_table,
        rank_weight
    from public.portfolio_search_index

    union all

    select
        'project'::text,
        r.resolved_project_id::text,
        coalesce(p.project_name, r.resolved_display_name, r.target_code)::text,
        concat_ws(' | ', p.project_code, coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), r.relation_type)::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        null::text,
        r.resolved_project_id::text,
        r.target_type::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.asset_project_link_resolution r
    join public.asset_master am on am.asset_id = r.asset_id
    left join public.projects p on p.project_id = r.resolved_project_id
    cross join lateral (
        values
            (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'resolved_linked_asset_name', 78),
            (am.asset_code, 'resolved_linked_asset_code', 74),
            (am.address_text, 'resolved_linked_asset_address', 52)
    ) as token(token_text, token_type, rank_weight)
    where r.resolved_project_id is not null
      and nullif(btrim(token.token_text::text), '') is not null

    union all

    select
        'asset'::text,
        r.asset_id::text,
        coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
        concat_ws(' | ', p.project_name, r.target_type, r.relation_type)::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        null::text,
        r.resolved_project_id::text,
        r.target_type::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.asset_project_link_resolution r
    join public.asset_master am on am.asset_id = r.asset_id
    left join public.projects p on p.project_id = r.resolved_project_id
    cross join lateral (
        values
            (p.project_name, 'resolved_linked_project_name', 76),
            (p.project_code, 'resolved_linked_project_code', 72),
            (r.target_code, 'resolved_project_target_code', 70)
    ) as token(token_text, token_type, rank_weight)
    where r.resolved_project_id is not null
      and nullif(btrim(token.token_text::text), '') is not null

    union all

    select
        'fund'::text,
        r.resolved_fund_id::text,
        coalesce(f.fund_name, f.short_name, r.target_code)::text,
        concat_ws(' | ', coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), r.target_type, r.relation_type)::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        r.resolved_fund_id::text,
        null::text,
        r.target_type::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.asset_project_link_resolution r
    join public.asset_master am on am.asset_id = r.asset_id
    left join public.v_funds_enriched f on f.fund_id = r.resolved_fund_id
    cross join lateral (
        values
            (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'fund_as_project_asset_name', 78),
            (am.asset_code, 'fund_as_project_asset_code', 74),
            (r.target_code, 'fund_as_project_target_code', 72)
    ) as token(token_text, token_type, rank_weight)
    where r.resolved_fund_id is not null
      and nullif(btrim(token.token_text::text), '') is not null

    union all

    select
        'asset'::text,
        r.asset_id::text,
        coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
        concat_ws(' | ', f.short_name, f.fund_name, r.target_type)::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        r.resolved_fund_id::text,
        null::text,
        r.target_type::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.asset_project_link_resolution r
    join public.asset_master am on am.asset_id = r.asset_id
    left join public.v_funds_enriched f on f.fund_id = r.resolved_fund_id
    cross join lateral (
        values
            (f.fund_name, 'fund_as_project_fund_name', 76),
            (f.short_name, 'fund_as_project_short_name', 74),
            (r.target_code, 'fund_as_project_target_code', 72)
    ) as token(token_text, token_type, rank_weight)
    where r.resolved_fund_id is not null
      and nullif(btrim(token.token_text::text), '') is not null

    union all

    select
        'asset'::text,
        r.asset_id::text,
        coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
        concat_ws(' | ', parent_p.project_name, child_p.project_name, r.relation_type)::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        null::text,
        child_p.project_id::text,
        'parent_project_child_asset'::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.projects parent_p
    join public.projects child_p on child_p.parent_project_id = parent_p.project_id
    join public.asset_project_link_resolution r on r.resolved_project_id = child_p.project_id
    join public.asset_master am on am.asset_id = r.asset_id
    cross join lateral (
        values
            (parent_p.project_name, 'parent_project_name', 80),
            (parent_p.project_code, 'parent_project_code', 76),
            (parent_p.project_id, 'parent_project_id', 74)
    ) as token(token_text, token_type, rank_weight)
    where nullif(btrim(token.token_text::text), '') is not null

    union all

    select
        'fund'::text,
        afl.fund_id::text,
        coalesce(f.fund_name, f.short_name, afl.fund_id)::text,
        concat_ws(' | ', parent_p.project_name, child_p.project_name, coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id))::text,
        token.token_text::text,
        token.token_type::text,
        r.asset_id::text,
        afl.fund_id::text,
        child_p.project_id::text,
        'parent_project_child_asset_fund'::text,
        'asset_project_link_resolution'::text,
        token.rank_weight::int
    from public.projects parent_p
    join public.projects child_p on child_p.parent_project_id = parent_p.project_id
    join public.asset_project_link_resolution r on r.resolved_project_id = child_p.project_id
    join public.asset_master am on am.asset_id = r.asset_id
    join public.asset_fund_links afl on afl.asset_id = r.asset_id
    left join public.v_funds_enriched f on f.fund_id = afl.fund_id
    cross join lateral (
        values
            (parent_p.project_name, 'parent_project_name', 78),
            (parent_p.project_code, 'parent_project_code', 74),
            (parent_p.project_id, 'parent_project_id', 72)
    ) as token(token_text, token_type, rank_weight)
    where nullif(btrim(token.token_text::text), '') is not null
),
grouped as (
    select
        entity_type,
        entity_id,
        (array_agg(display_title order by rank_weight desc, length(coalesce(display_title, '')) desc))[1] as display_title,
        (array_agg(display_subtitle order by rank_weight desc, length(coalesce(display_subtitle, '')) desc))[1] as display_subtitle,
        string_agg(distinct token_text, ' ') as token_text,
        'canonical_entity'::text as token_type,
        (array_agg(related_asset_id order by case when related_asset_id is null then 1 else 0 end, rank_weight desc))[1] as related_asset_id,
        (array_agg(related_fund_id order by case when related_fund_id is null then 1 else 0 end, rank_weight desc))[1] as related_fund_id,
        (array_agg(related_project_id order by case when related_project_id is null then 1 else 0 end, rank_weight desc))[1] as related_project_id,
        (array_agg(relation_type order by rank_weight desc))[1] as relation_type,
        string_agg(distinct source_table, ', ' order by source_table) as source_table,
        max(rank_weight)::int as rank_weight,
        count(*)::int as token_row_count,
        jsonb_agg(
            jsonb_build_object(
                'token_type', token_type,
                'relation_type', relation_type,
                'related_asset_id', related_asset_id,
                'related_fund_id', related_fund_id,
                'related_project_id', related_project_id,
                'source_table', source_table,
                'rank_weight', rank_weight
            )
            order by rank_weight desc
        ) as relation_paths
    from token_rows
    group by entity_type, entity_id
)
select *
from grouped
where nullif(btrim(entity_id), '') is not null;

create or replace view public.dashboard_search_result_contract_audit as
with raw_variants as (
    select
        entity_type,
        entity_id,
        count(*) as raw_token_row_count,
        count(distinct coalesce(related_asset_id, '')) as related_asset_variants,
        count(distinct coalesce(related_fund_id, '')) as related_fund_variants,
        count(distinct coalesce(related_project_id, '')) as related_project_variants,
        count(distinct display_title) as display_title_variants,
        bool_or(display_title is null or btrim(display_title) = '') as has_blank_raw_display_title
    from public.portfolio_search_index
    group by entity_type, entity_id
)
select
    c.entity_type,
    c.entity_id,
    c.token_row_count,
    1::int as canonical_result_row_count,
    rv.raw_token_row_count,
    rv.related_asset_variants,
    rv.related_fund_variants,
    rv.related_project_variants,
    rv.display_title_variants,
    c.display_title as canonical_display_title,
    (c.display_title is null or btrim(c.display_title) = '') as has_blank_display_title,
    rv.has_blank_raw_display_title,
    c.relation_paths
from public.portfolio_search_results_canonical c
left join raw_variants rv
  on rv.entity_type = c.entity_type
 and rv.entity_id = c.entity_id;

create or replace view public.relationship_contract_audit_v1 as
select
    'asset_project_link_unresolved_target'::text as issue_type,
    case when resolution_status = 'unresolved' then 'warning' else 'info' end as severity,
    'asset_project_links'::text as source_table,
    asset_id,
    target_code as entity_id,
    resolved_display_name as display_name,
    resolution_status,
    resolution_note as note
from public.asset_project_link_resolution
where resolution_status <> 'resolved'

union all

select
    'fund_primary_asset_without_link'::text,
    'warning'::text,
    'funds'::text,
    f.primary_asset_id,
    f.fund_id,
    f.fund_name,
    'unresolved'::text,
    'funds.primary_asset_id exists but canonical asset_fund_links row is missing'::text
from public.funds f
where f.primary_asset_id is not null
  and not exists (
      select 1
      from public.asset_fund_links afl
      where afl.asset_id = f.primary_asset_id
        and afl.fund_id = f.fund_id
  )

union all

select
    'project_primary_asset_without_link'::text,
    'warning'::text,
    'projects'::text,
    p.primary_asset_id,
    p.project_id,
    p.project_name,
    'unresolved'::text,
    'projects.primary_asset_id exists but canonical asset_project_links row is missing'::text
from public.projects p
where p.primary_asset_id is not null
  and not exists (
      select 1
      from public.asset_project_link_resolution apl
      where apl.asset_id = p.primary_asset_id
        and apl.resolved_project_id = p.project_id
  )

union all

select
    'aum_allocation_review_required'::text,
    'warning'::text,
    'asset_fund_links'::text,
    afl.asset_id,
    afl.fund_id,
    f.fund_name,
    coalesce(afl.allocation_status, 'unknown')::text,
    'asset-level AUM should not be treated as final until allocation is reviewed'::text
from public.asset_fund_links afl
join public.funds f on f.fund_id = afl.fund_id
where afl.include_in_asset_aum = true
  and (
      afl.needs_allocation_review = true
      or afl.allocation_status = 'unallocated'
      or (
          afl.allocation_ratio is null
          and exists (
              select 1
              from public.asset_fund_links sibling
              where sibling.fund_id = afl.fund_id
                and sibling.asset_id <> afl.asset_id
                and sibling.include_in_asset_aum = true
          )
      )
  )

union all

select
    'iota_target_unresolved'::text,
    'warning'::text,
    'iota_seoul_log_links'::text,
    asset_id,
    target_code,
    resolved_display_name,
    resolved_target_type,
    'iota target_code did not resolve to project/fund/pilot code contract'::text
from public.iota_target_resolution
where resolved_target_type = 'unresolved'

union all

select
    'search_display_title_variants'::text,
    'warning'::text,
    'portfolio_search_index'::text,
    null::text,
    entity_type || ':' || entity_id,
    canonical_display_title,
    'needs_review'::text,
    'same entity key has multiple display titles in search index'::text
from public.dashboard_search_result_contract_audit
where display_title_variants > 1
   or has_blank_display_title = true

union all

select
    'search_relation_path_variants'::text,
    'info'::text,
    'portfolio_search_results_canonical'::text,
    null::text,
    entity_type || ':' || entity_id,
    canonical_display_title,
    'canonicalized'::text,
    'same entity has multiple relation paths; canonical result must remain one row and expose paths as provenance'::text
from public.dashboard_search_result_contract_audit
where coalesce(related_asset_variants, 0) > 1
   or coalesce(related_fund_variants, 0) > 1
   or coalesce(related_project_variants, 0) > 1;

comment on view public.asset_project_link_resolution is
    'Resolves mixed asset_project_links project_id values into explicit project/fund/pilot target types without enforcing a hard FK.';

comment on view public.asset_exposure_edges is
    'Canonical direct or fund-derived exposure-to-asset edge surface used before exposure aggregation and dashboard drawer hydration.';

comment on view public.portfolio_search_results_canonical is
    'Canonical one-row-per entity search result surface with resolution-aware project/fund/asset paths and raw token provenance.';

comment on view public.relationship_contract_audit_v1 is
    'Relationship contract audit for deterministic dashboard lookup and safe relationship-layer rebuild.';
