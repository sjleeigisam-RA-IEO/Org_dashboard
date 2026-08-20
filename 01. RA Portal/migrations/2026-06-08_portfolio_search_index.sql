-- Relationship-aware discovery surface for the portfolio dashboard.
-- Grain: one searchable token per entity or relationship edge.
-- Requires 2026-06-09_asset_name_cleanup_contract.sql when using the asset-name cleanup policy.

drop view if exists public.dashboard_relationship_contract_audit;
drop view if exists public.portfolio_search_results_canonical;
drop view if exists public.portfolio_search_index;

create or replace view public.portfolio_search_index as
select
    'fund'::text as entity_type,
    f.fund_id::text as entity_id,
    coalesce(f.fund_name, f.short_name, f.fund_id)::text as display_title,
    concat_ws(' | ', f.short_name, f.status, f.sector)::text as display_subtitle,
    token.token_text::text as token_text,
    token.token_type::text as token_type,
    null::text as related_asset_id,
    f.fund_id::text as related_fund_id,
    null::text as related_project_id,
    'self'::text as relation_type,
    'v_funds_enriched'::text as source_table,
    token.rank_weight::int as rank_weight
from public.v_funds_enriched f
cross join lateral (
    values
        (f.fund_name, 'fund_name', 100),
        (f.short_name, 'fund_short_name', 95),
        (f.fund_id, 'fund_id', 100),
        (f.project_mission_name, 'project_mission_name', 70),
        (f.asset_name, 'fund_asset_name', 65),
        (f.fund_type, 'fund_type', 45),
        (f.division, 'division', 35),
        (f.primary_region, 'primary_region', 35),
        (f.sector, 'sector', 30)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'asset'::text,
    am.asset_id::text,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
    concat_ws(' | ', am.asset_code, am.address_text, am.review_status)::text,
    token.token_text::text,
    token.token_type::text,
    am.asset_id::text,
    null::text,
    null::text,
    'self'::text,
    'asset_master'::text,
    token.rank_weight::int
from public.asset_master am
cross join lateral (
    values
        (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'asset_canonical_name', 100),
        (am.asset_code, 'asset_code', 95),
        (am.address_text, 'address', 65),
        (am.pnu, 'pnu', 80),
        (am.main_usage, 'main_usage', 30),
        (am.asset_type, 'asset_type', 30),
        (am.portfolio_region, 'portfolio_region', 30),
        (am.business_stage, 'business_stage', 30)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'asset'::text,
    aa.asset_id::text,
    coalesce(coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), aa.alias_name)::text,
    concat_ws(' | ', aa.alias_type, am.address_text)::text,
    aa.alias_name::text,
    concat('asset_alias:', aa.alias_type)::text,
    aa.asset_id::text,
    null::text,
    null::text,
    'alias'::text,
    'asset_aliases'::text,
    greatest(40, round(coalesce(aa.confidence, 0.7) * 100)::int)
from public.asset_aliases aa
left join public.asset_master am on am.asset_id = aa.asset_id
where nullif(btrim(aa.alias_name), '') is not null

union all

select
    'asset'::text,
    afl.asset_id::text,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
    concat_ws(' | ', f.short_name, f.fund_name, afl.relation_type)::text,
    token.token_text::text,
    token.token_type::text,
    afl.asset_id::text,
    afl.fund_id::text,
    null::text,
    afl.relation_type::text,
    'asset_fund_links'::text,
    token.rank_weight::int
from public.asset_fund_links afl
join public.asset_master am on am.asset_id = afl.asset_id
left join public.v_funds_enriched f on f.fund_id = afl.fund_id
cross join lateral (
    values
        (f.fund_name, 'linked_fund_name', 82),
        (f.short_name, 'linked_fund_short_name', 80),
        (afl.fund_id, 'linked_fund_id', 85)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'fund'::text,
    afl.fund_id::text,
    coalesce(f.fund_name, f.short_name, afl.fund_id)::text,
    concat_ws(' | ', coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), afl.relation_type)::text,
    token.token_text::text,
    token.token_type::text,
    afl.asset_id::text,
    afl.fund_id::text,
    null::text,
    afl.relation_type::text,
    'asset_fund_links'::text,
    token.rank_weight::int
from public.asset_fund_links afl
join public.asset_master am on am.asset_id = afl.asset_id
left join public.v_funds_enriched f on f.fund_id = afl.fund_id
cross join lateral (
    values
        (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'linked_asset_name', 82),
        (am.asset_code, 'linked_asset_code', 80),
        (am.address_text, 'linked_asset_address', 55)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'project'::text,
    p.project_id::text,
    p.project_name::text,
    concat_ws(' | ', p.project_code, p.project_type, p.status)::text,
    token.token_text::text,
    token.token_type::text,
    p.primary_asset_id::text,
    null::text,
    p.project_id::text,
    'self'::text,
    'projects'::text,
    token.rank_weight::int
from public.projects p
cross join lateral (
    values
        (p.project_name, 'project_name', 100),
        (p.project_code, 'project_code', 95),
        (p.project_id, 'project_id', 90),
        (p.project_type, 'project_type', 30),
        (p.status, 'project_status', 25)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'project'::text,
    apl.project_id::text,
    coalesce(p.project_name, apl.project_id)::text,
    concat_ws(' | ', coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), apl.relation_type)::text,
    token.token_text::text,
    token.token_type::text,
    apl.asset_id::text,
    null::text,
    apl.project_id::text,
    apl.relation_type::text,
    'asset_project_links'::text,
    token.rank_weight::int
from public.asset_project_links apl
join public.asset_master am on am.asset_id = apl.asset_id
left join public.projects p on p.project_id = apl.project_id
cross join lateral (
    values
        (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'linked_asset_name', 75),
        (am.asset_code, 'linked_asset_code', 70),
        (am.address_text, 'linked_asset_address', 50)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'asset'::text,
    apl.asset_id::text,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
    concat_ws(' | ', p.project_name, apl.relation_type)::text,
    token.token_text::text,
    token.token_type::text,
    apl.asset_id::text,
    null::text,
    apl.project_id::text,
    apl.relation_type::text,
    'asset_project_links'::text,
    token.rank_weight::int
from public.asset_project_links apl
join public.asset_master am on am.asset_id = apl.asset_id
left join public.projects p on p.project_id = apl.project_id
cross join lateral (
    values
        (p.project_name, 'linked_project_name', 72),
        (p.project_code, 'linked_project_code', 70),
        (apl.project_id, 'linked_project_id', 70)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'asset'::text,
    apl.asset_id::text,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
    concat_ws(' | ', parent_p.project_name, child_p.project_name, apl.relation_type)::text,
    token.token_text::text,
    token.token_type::text,
    apl.asset_id::text,
    null::text,
    child_p.project_id::text,
    'parent_project_child_asset'::text,
    'asset_project_links'::text,
    token.rank_weight::int
from public.projects parent_p
join public.projects child_p on child_p.parent_project_id = parent_p.project_id
join public.asset_project_links apl on apl.project_id = child_p.project_id
join public.asset_master am on am.asset_id = apl.asset_id
cross join lateral (
    values
        (parent_p.project_name, 'parent_project_name', 78),
        (parent_p.project_code, 'parent_project_code', 74),
        (parent_p.project_id, 'parent_project_id', 72)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'fund'::text,
    afl.fund_id::text,
    coalesce(f.short_name, f.fund_name, afl.fund_id)::text,
    concat_ws(' | ', parent_p.project_name, child_p.project_name, coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id))::text,
    token.token_text::text,
    token.token_type::text,
    apl.asset_id::text,
    afl.fund_id::text,
    child_p.project_id::text,
    'parent_project_child_asset_fund'::text,
    'asset_project_links'::text,
    token.rank_weight::int
from public.projects parent_p
join public.projects child_p on child_p.parent_project_id = parent_p.project_id
join public.asset_project_links apl on apl.project_id = child_p.project_id
join public.asset_master am on am.asset_id = apl.asset_id
join public.asset_fund_links afl on afl.asset_id = apl.asset_id
left join public.v_funds_enriched f on f.fund_id = afl.fund_id
cross join lateral (
    values
        (parent_p.project_name, 'parent_project_name', 76),
        (parent_p.project_code, 'parent_project_code', 72),
        (parent_p.project_id, 'parent_project_id', 70)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'lender'::text,
    le.id::text,
    coalesce(le.lender_clean, le.lender_raw, le.id::text)::text,
    concat_ws(' | ', f.short_name, f.fund_name, coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id))::text,
    token.token_text::text,
    token.token_type::text,
    le.asset_id::text,
    le.fund_id::text,
    null::text,
    'lender_exposure'::text,
    'lender_exposures'::text,
    token.rank_weight::int
from public.lender_exposures le
left join public.v_funds_enriched f on f.fund_id = le.fund_id
left join public.asset_master am on am.asset_id = le.asset_id
cross join lateral (
    values
        (le.lender_clean, 'lender_name', 100),
        (le.lender_raw, 'lender_raw_name', 80),
        (le.fund_id, 'fund_id', 75),
        (f.fund_name, 'linked_fund_name', 55),
        (f.short_name, 'linked_fund_short_name', 55),
        (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'linked_asset_name', 45)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    'beneficiary'::text,
    be.id::text,
    coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)::text,
    concat_ws(' | ', f.short_name, f.fund_name, coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id))::text,
    token.token_text::text,
    token.token_type::text,
    be.asset_id::text,
    be.fund_id::text,
    null::text,
    'beneficiary_exposure'::text,
    'beneficiary_exposures'::text,
    token.rank_weight::int
from public.beneficiary_exposures be
left join public.v_funds_enriched f on f.fund_id = be.fund_id
left join public.asset_master am on am.asset_id = be.asset_id
cross join lateral (
    values
        (be.beneficiary_clean, 'beneficiary_name', 100),
        (be.beneficiary_raw, 'beneficiary_raw_name', 80),
        (be.fund_id, 'fund_id', 75),
        (f.fund_name, 'linked_fund_name', 55),
        (f.short_name, 'linked_fund_short_name', 55),
        (coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id), 'linked_asset_name', 45)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null;

create or replace view public.portfolio_search_results_canonical as
with grouped as (
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
    from public.portfolio_search_index
    group by entity_type, entity_id
)
select *
from grouped
where nullif(btrim(entity_id), '') is not null;

create or replace view public.dashboard_relationship_contract_audit as
select
    'asset_project_link_without_project_or_fund'::text as issue_type,
    apl.project_id::text as subject_id,
    apl.asset_id::text as related_asset_id,
    null::text as related_fund_id,
    apl.relation_type::text as relation_type,
    'asset_project_links'::text as source_table
from public.asset_project_links apl
left join public.projects p on p.project_id = apl.project_id
left join public.funds f on f.fund_id = apl.project_id
where p.project_id is null and f.fund_id is null

union all

select
    'fund_primary_asset_without_link'::text,
    f.fund_id::text,
    f.primary_asset_id::text,
    f.fund_id::text,
    'primary_asset_id'::text,
    'funds'::text
from public.funds f
where f.primary_asset_id is not null
  and not exists (
      select 1
      from public.asset_fund_links afl
      where afl.fund_id = f.fund_id
        and afl.asset_id = f.primary_asset_id
  )

union all

select
    'project_primary_asset_without_link'::text,
    p.project_id::text,
    p.primary_asset_id::text,
    null::text,
    'primary_asset_id'::text,
    'projects'::text
from public.projects p
where p.primary_asset_id is not null
  and not exists (
      select 1
      from public.asset_project_links apl
      where apl.project_id = p.project_id
        and apl.asset_id = p.primary_asset_id
  );

comment on view public.portfolio_search_index is
    'Raw relationship-aware search token surface for the RA portfolio dashboard. This is not the final result grain.';

comment on view public.portfolio_search_results_canonical is
    'Canonical one-row-per entity search result surface. Dashboard search should query this before raw token fallback.';

comment on view public.dashboard_relationship_contract_audit is
    'Read-only audit view for dashboard relationship lookup contract gaps.';
