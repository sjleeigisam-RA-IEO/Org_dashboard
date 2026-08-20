-- Canonical relationship index for RA dashboard retrieval.
-- Apply after:
--   1. 2026-06-09_asset_name_cleanup_contract.sql
--   2. 2026-06-08_portfolio_search_index.sql
--   3. 2026-06-08_relationship_contract_v1.sql
--
-- This layer preserves source columns and exposes interpreted entities, edges,
-- searchable tokens, canonical search results, and audit rows.

create or replace function public.ra_relationship_party_id(prefix text, display_name text)
returns text
language sql
immutable
as $$
    select prefix || '_' || md5(lower(coalesce(nullif(btrim(display_name), ''), 'unknown')));
$$;

create or replace view public.relationship_index_entities as
select
    'fund:' || f.fund_id::text as entity_key,
    'fund'::text as entity_type,
    f.fund_id::text as entity_id,
    case
        when nullif(btrim(coalesce(f.short_name, '')), '') is not null
         and nullif(btrim(coalesce(f.fund_name, '')), '') is not null
            then '[' || f.short_name || '] ' || f.fund_name
        else coalesce(f.short_name, f.fund_name, f.fund_id)::text
    end as display_title,
    concat_ws(' | ', f.status, f.sector, f.primary_region)::text as display_subtitle,
    'v_funds_enriched'::text as source_table,
    f.fund_id::text as source_id,
    1.0::numeric as confidence,
    'confirmed'::text as status,
    jsonb_build_object(
        'short_name', f.short_name,
        'fund_name', f.fund_name,
        'fund_type', f.fund_type,
        'division', f.division
    ) as metadata
from public.v_funds_enriched f
where nullif(btrim(coalesce(f.fund_id, '')), '') is not null

union all

select
    'asset:' || am.asset_id::text,
    'asset'::text,
    am.asset_id::text,
    coalesce(am.physical_asset_name, am.non_physical_asset_label, am.asset_code, am.asset_id)::text,
    concat_ws(' | ', am.asset_code, am.address_text, am.review_status)::text,
    'asset_master'::text,
    am.asset_id::text,
    1.0::numeric,
    case
        when am.asset_name_cleanup_action like 'review%' then 'review_required'
        else 'confirmed'
    end::text,
    jsonb_build_object(
        'source_canonical_name', am.canonical_name,
        'cleanup_action', am.asset_name_cleanup_action,
        'asset_type', am.asset_type,
        'asset_kind', am.asset_kind
    )
from public.asset_master am
where nullif(btrim(coalesce(am.asset_id, '')), '') is not null

union all

select
    'project:' || p.project_id::text,
    'project'::text,
    p.project_id::text,
    coalesce(p.project_name, p.project_code, p.project_id)::text,
    concat_ws(' | ', p.project_code, p.project_type, p.status)::text,
    'projects'::text,
    p.project_id::text,
    1.0::numeric,
    'confirmed'::text,
    jsonb_build_object(
        'project_code', p.project_code,
        'parent_project_id', p.parent_project_id,
        'primary_asset_id', p.primary_asset_id,
        'project_type', p.project_type
    )
from public.projects p
where nullif(btrim(coalesce(p.project_id, '')), '') is not null

union all

select
    'lender:' || public.ra_relationship_party_id('lender', coalesce(le.lender_clean, le.lender_raw, le.id::text)),
    'lender'::text,
    public.ra_relationship_party_id('lender', coalesce(le.lender_clean, le.lender_raw, le.id::text)),
    coalesce(le.lender_clean, le.lender_raw, le.id::text)::text,
    'lender exposure party'::text,
    'lender_exposures'::text,
    min(le.id)::text,
    0.95::numeric,
    'confirmed'::text,
    jsonb_build_object(
        'exposure_count', count(*),
        'sample_lender_raw', max(le.lender_raw)
    )
from public.lender_exposures le
where nullif(btrim(coalesce(le.lender_clean, le.lender_raw, le.id::text)), '') is not null
group by public.ra_relationship_party_id('lender', coalesce(le.lender_clean, le.lender_raw, le.id::text)),
         coalesce(le.lender_clean, le.lender_raw, le.id::text)

union all

select
    'beneficiary:' || public.ra_relationship_party_id('beneficiary', coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)),
    'beneficiary'::text,
    public.ra_relationship_party_id('beneficiary', coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)),
    coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)::text,
    'beneficiary exposure party'::text,
    'beneficiary_exposures'::text,
    min(be.id)::text,
    0.95::numeric,
    'confirmed'::text,
    jsonb_build_object(
        'exposure_count', count(*),
        'sample_beneficiary_raw', max(be.beneficiary_raw)
    )
from public.beneficiary_exposures be
where nullif(btrim(coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)), '') is not null
group by public.ra_relationship_party_id('beneficiary', coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text)),
         coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text);

create or replace view public.relationship_index_edges as
select
    md5(concat_ws('|', 'fund_asset', afl.fund_id, afl.asset_id, afl.relation_type)) as edge_id,
    'fund_asset'::text as edge_type,
    'fund'::text as source_entity_type,
    afl.fund_id::text as source_entity_id,
    'asset'::text as target_entity_type,
    afl.asset_id::text as target_entity_id,
    coalesce(afl.relation_type, 'fund_asset')::text as relation_type,
    'asset_fund_links'::text as link_method,
    'asset_fund_links'::text as source_table,
    concat_ws(':', afl.fund_id, afl.asset_id, afl.relation_type)::text as source_id,
    coalesce(afl.confidence, 1.0)::numeric as confidence,
    'confirmed'::text as status,
    true as include_in_search,
    (
        afl.include_in_asset_aum = true
        and coalesce(afl.allocation_status, '') not in ('unallocated', 'mixed_requires_review')
        and coalesce(afl.needs_allocation_review, false) = false
    ) as include_in_amount_rollup,
    jsonb_build_object(
        'evidence_source_table', afl.source_table,
        'evidence_source_id', afl.source_id,
        'include_in_asset_aum', afl.include_in_asset_aum,
        'allocation_status', afl.allocation_status,
        'allocation_ratio', afl.allocation_ratio,
        'needs_allocation_review', afl.needs_allocation_review
    ) as evidence
from public.asset_fund_links afl

union all

select
    md5(concat_ws('|', 'project_parent_child', parent_project_id, project_id)),
    'project_parent_child'::text,
    'project'::text,
    parent_project_id::text,
    'project'::text,
    project_id::text,
    'parent_child'::text,
    'projects.parent_project_id'::text,
    'projects'::text,
    project_id::text,
    1.0::numeric,
    'confirmed'::text,
    true,
    false,
    jsonb_build_object('parent_project_id', parent_project_id)
from public.projects
where parent_project_id is not null

union all

select
    md5(concat_ws('|', 'asset_project', r.target_type, coalesce(r.resolved_project_id, r.resolved_fund_id, r.target_code), r.asset_id, r.relation_type)),
    'asset_project'::text,
    case when r.target_type = 'fund_as_project' then 'fund' else 'project' end::text,
    coalesce(r.resolved_project_id, r.resolved_fund_id, r.target_code)::text,
    'asset'::text,
    r.asset_id::text,
    coalesce(r.relation_type, r.target_type)::text,
    ('asset_project_link_resolution:' || r.target_type)::text,
    'asset_project_link_resolution'::text,
    coalesce(r.source_id, r.target_code)::text,
    coalesce(r.confidence, 1.0)::numeric,
    case
        when r.target_type = 'project' then 'confirmed'
        when r.target_type = 'fund_as_project' then 'compatibility'
        when r.target_type = 'pilot_code' then 'review_required'
        else 'unresolved'
    end::text,
    true,
    false,
    jsonb_build_object(
        'target_code', r.target_code,
        'target_type', r.target_type,
        'resolution_status', r.resolution_status,
        'resolved_project_id', r.resolved_project_id,
        'resolved_fund_id', r.resolved_fund_id
    )
from public.asset_project_link_resolution r

union all

select distinct
    md5(concat_ws('|', e.exposure_type || '_fund', e.exposure_id, e.fund_id)),
    (e.exposure_type || '_fund')::text,
    e.exposure_type::text,
    case
        when e.exposure_type = 'lender' then public.ra_relationship_party_id('lender', coalesce(le.lender_clean, le.lender_raw, le.id::text))
        else public.ra_relationship_party_id('beneficiary', coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text))
    end::text,
    'fund'::text,
    e.fund_id::text,
    (e.exposure_type || '_in_fund')::text,
    'direct_fund_id'::text,
    (e.exposure_type || '_exposures')::text,
    e.exposure_id::text,
    0.95::numeric,
    'confirmed'::text,
    true,
    false,
    jsonb_build_object('exposure_id', e.exposure_id)
from public.asset_exposure_edges e
left join public.lender_exposures le on e.exposure_type = 'lender' and le.id::text = e.exposure_id
left join public.beneficiary_exposures be on e.exposure_type = 'beneficiary' and be.id::text = e.exposure_id
where e.fund_id is not null

union all

select
    md5(concat_ws('|', e.exposure_type || '_asset', e.exposure_id, e.asset_id, e.link_method)),
    (e.exposure_type || '_asset')::text,
    e.exposure_type::text,
    case
        when e.exposure_type = 'lender' then public.ra_relationship_party_id('lender', coalesce(le.lender_clean, le.lender_raw, le.id::text))
        else public.ra_relationship_party_id('beneficiary', coalesce(be.beneficiary_clean, be.beneficiary_raw, be.id::text))
    end::text,
    'asset'::text,
    e.asset_id::text,
    (e.exposure_type || '_asset_exposure')::text,
    e.link_method::text,
    (e.exposure_type || '_exposures')::text,
    e.exposure_id::text,
    case
        when e.link_method = 'direct_asset_id' then 0.95
        when e.allocation_status = 'multi_asset_review_required' then 0.45
        else 0.75
    end::numeric,
    case
        when e.allocation_status = 'multi_asset_review_required' then 'review_required'
        else 'confirmed'
    end::text,
    true,
    (e.allocation_status <> 'multi_asset_review_required') as include_in_amount_rollup,
    jsonb_build_object(
        'exposure_id', e.exposure_id,
        'fund_id', e.fund_id,
        'link_method', e.link_method,
        'allocation_status', e.allocation_status
    )
from public.asset_exposure_edges e
left join public.lender_exposures le on e.exposure_type = 'lender' and le.id::text = e.exposure_id
left join public.beneficiary_exposures be on e.exposure_type = 'beneficiary' and be.id::text = e.exposure_id
where e.asset_id is not null;

create or replace view public.relationship_index_tokens as
select
    e.entity_key,
    e.entity_type,
    e.entity_id,
    e.display_title,
    e.display_subtitle,
    token.token_text::text,
    token.token_type::text,
    case when e.entity_type = 'asset' then e.entity_id else null end::text as related_asset_id,
    case when e.entity_type = 'fund' then e.entity_id else null end::text as related_fund_id,
    case when e.entity_type = 'project' then e.entity_id else null end::text as related_project_id,
    'self'::text as relation_type,
    e.source_table,
    token.rank_weight::int,
    jsonb_build_object('path', e.entity_type || ':self') as relation_path
from public.relationship_index_entities e
cross join lateral (
    values
        (e.display_title, 'display_title', 100),
        (e.entity_id, e.entity_type || '_id', 90)
) as token(token_text, token_type, rank_weight)
where nullif(btrim(token.token_text::text), '') is not null

union all

select
    asset_entity.entity_key,
    asset_entity.entity_type,
    asset_entity.entity_id,
    asset_entity.display_title,
    asset_entity.display_subtitle,
    token.token_text::text,
    token.token_type::text,
    asset_entity.entity_id::text as related_asset_id,
    f.fund_id::text as related_fund_id,
    null::text as related_project_id,
    edge.relation_type,
    'v_funds_enriched+asset_fund_links'::text as source_table,
    token.rank_weight::int,
    jsonb_build_object(
        'edge_id', edge.edge_id,
        'edge_type', edge.edge_type,
        'direction', 'fund_token_to_asset',
        'link_method', edge.link_method
    )
from public.relationship_index_edges edge
join public.v_funds_enriched f
  on edge.edge_type = 'fund_asset'
 and f.fund_id = edge.source_entity_id
join public.relationship_index_entities asset_entity
  on asset_entity.entity_type = 'asset'
 and asset_entity.entity_id = edge.target_entity_id
cross join lateral (
    values
        (f.fund_name, 'linked_fund_name', 82),
        (f.short_name, 'linked_fund_short_name', 80),
        (f.fund_id, 'linked_fund_id', 85),
        (f.project_mission_name, 'linked_fund_project_mission_name', 70),
        (f.asset_name, 'linked_fund_source_asset_name', 55)
) as token(token_text, token_type, rank_weight)
where edge.include_in_search = true
  and nullif(btrim(token.token_text::text), '') is not null

union all

select
    src.entity_key,
    src.entity_type,
    src.entity_id,
    src.display_title,
    src.display_subtitle,
    tgt.display_title::text,
    ('linked_' || tgt.entity_type || '_title')::text,
    case when tgt.entity_type = 'asset' then tgt.entity_id when src.entity_type = 'asset' then src.entity_id else null end::text,
    case when tgt.entity_type = 'fund' then tgt.entity_id when src.entity_type = 'fund' then src.entity_id else null end::text,
    case when tgt.entity_type = 'project' then tgt.entity_id when src.entity_type = 'project' then src.entity_id else null end::text,
    edge.relation_type,
    edge.source_table,
    greatest(30, round(edge.confidence * 80)::int),
    jsonb_build_object(
        'edge_id', edge.edge_id,
        'edge_type', edge.edge_type,
        'direction', 'source_to_target',
        'link_method', edge.link_method
    )
from public.relationship_index_edges edge
join public.relationship_index_entities src
  on src.entity_type = edge.source_entity_type
 and src.entity_id = edge.source_entity_id
join public.relationship_index_entities tgt
  on tgt.entity_type = edge.target_entity_type
 and tgt.entity_id = edge.target_entity_id
where edge.include_in_search = true

union all

select
    tgt.entity_key,
    tgt.entity_type,
    tgt.entity_id,
    tgt.display_title,
    tgt.display_subtitle,
    src.display_title::text,
    ('linked_' || src.entity_type || '_title')::text,
    case when tgt.entity_type = 'asset' then tgt.entity_id when src.entity_type = 'asset' then src.entity_id else null end::text,
    case when tgt.entity_type = 'fund' then tgt.entity_id when src.entity_type = 'fund' then src.entity_id else null end::text,
    case when tgt.entity_type = 'project' then tgt.entity_id when src.entity_type = 'project' then src.entity_id else null end::text,
    edge.relation_type,
    edge.source_table,
    greatest(30, round(edge.confidence * 80)::int),
    jsonb_build_object(
        'edge_id', edge.edge_id,
        'edge_type', edge.edge_type,
        'direction', 'target_to_source',
        'link_method', edge.link_method
    )
from public.relationship_index_edges edge
join public.relationship_index_entities src
  on src.entity_type = edge.source_entity_type
 and src.entity_id = edge.source_entity_id
join public.relationship_index_entities tgt
  on tgt.entity_type = edge.target_entity_type
 and tgt.entity_id = edge.target_entity_id
where edge.include_in_search = true

union all

select
    asset_entity.entity_key,
    asset_entity.entity_type,
    asset_entity.entity_id,
    asset_entity.display_title,
    asset_entity.display_subtitle,
    parent_entity.display_title::text,
    'parent_project_title'::text,
    asset_entity.entity_id::text,
    null::text,
    child_entity.entity_id::text,
    'parent_project_child_asset'::text,
    'relationship_index_edges'::text,
    78,
    jsonb_build_object(
        'path', 'parent_project:child_project:asset',
        'parent_project_id', parent_entity.entity_id,
        'child_project_id', child_entity.entity_id
    )
from public.relationship_index_edges pc
join public.relationship_index_entities parent_entity
  on parent_entity.entity_type = pc.source_entity_type
 and parent_entity.entity_id = pc.source_entity_id
join public.relationship_index_entities child_entity
  on child_entity.entity_type = pc.target_entity_type
 and child_entity.entity_id = pc.target_entity_id
join public.relationship_index_edges pa
  on pa.source_entity_type = 'project'
 and pa.source_entity_id = child_entity.entity_id
 and pa.target_entity_type = 'asset'
join public.relationship_index_entities asset_entity
  on asset_entity.entity_type = 'asset'
 and asset_entity.entity_id = pa.target_entity_id
where pc.edge_type = 'project_parent_child'

union all

select
    fund_entity.entity_key,
    fund_entity.entity_type,
    fund_entity.entity_id,
    fund_entity.display_title,
    fund_entity.display_subtitle,
    parent_entity.display_title::text,
    'parent_project_title'::text,
    asset_entity.entity_id::text,
    fund_entity.entity_id::text,
    child_entity.entity_id::text,
    'parent_project_child_asset_fund'::text,
    'relationship_index_edges'::text,
    76,
    jsonb_build_object(
        'path', 'parent_project:child_project:asset:fund',
        'parent_project_id', parent_entity.entity_id,
        'child_project_id', child_entity.entity_id,
        'asset_id', asset_entity.entity_id
    )
from public.relationship_index_edges pc
join public.relationship_index_entities parent_entity
  on parent_entity.entity_type = pc.source_entity_type
 and parent_entity.entity_id = pc.source_entity_id
join public.relationship_index_entities child_entity
  on child_entity.entity_type = pc.target_entity_type
 and child_entity.entity_id = pc.target_entity_id
join public.relationship_index_edges pa
  on pa.source_entity_type = 'project'
 and pa.source_entity_id = child_entity.entity_id
 and pa.target_entity_type = 'asset'
join public.relationship_index_entities asset_entity
  on asset_entity.entity_type = 'asset'
 and asset_entity.entity_id = pa.target_entity_id
join public.relationship_index_edges fa
  on fa.edge_type = 'fund_asset'
 and fa.target_entity_id = asset_entity.entity_id
join public.relationship_index_entities fund_entity
  on fund_entity.entity_type = 'fund'
 and fund_entity.entity_id = fa.source_entity_id
where pc.edge_type = 'project_parent_child';

create or replace view public.relationship_index_search_results as
select
    t.entity_type,
    t.entity_id,
    (array_agg(t.display_title order by t.rank_weight desc, length(coalesce(t.display_title, '')) desc))[1] as display_title,
    (array_agg(t.display_subtitle order by t.rank_weight desc, length(coalesce(t.display_subtitle, '')) desc))[1] as display_subtitle,
    string_agg(distinct t.token_text, ' ') as token_text,
    'canonical_entity'::text as token_type,
    (array_agg(t.related_asset_id order by case when t.related_asset_id is null then 1 else 0 end, t.rank_weight desc))[1] as related_asset_id,
    (array_agg(t.related_fund_id order by case when t.related_fund_id is null then 1 else 0 end, t.rank_weight desc))[1] as related_fund_id,
    (array_agg(t.related_project_id order by case when t.related_project_id is null then 1 else 0 end, t.rank_weight desc))[1] as related_project_id,
    (array_agg(t.relation_type order by t.rank_weight desc))[1] as relation_type,
    string_agg(distinct t.source_table, ', ' order by t.source_table) as source_table,
    max(t.rank_weight)::int as rank_weight,
    count(*)::int as token_row_count,
    jsonb_agg(
        jsonb_build_object(
            'token_text', t.token_text,
            'token_type', t.token_type,
            'relation_type', t.relation_type,
            'related_asset_id', t.related_asset_id,
            'related_fund_id', t.related_fund_id,
            'related_project_id', t.related_project_id,
            'source_table', t.source_table,
            'rank_weight', t.rank_weight,
            'relation_path', t.relation_path
        )
        order by t.rank_weight desc
    ) as relation_paths
from public.relationship_index_tokens t
where nullif(btrim(t.entity_id), '') is not null
group by t.entity_type, t.entity_id;

create or replace view public.relationship_index_audit as
select
    'unresolved_relationship_edge'::text as issue_type,
    edge_id as subject_id,
    edge_type,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    status,
    evidence
from public.relationship_index_edges
where status = 'unresolved'

union all

select
    'review_required_relationship_edge'::text,
    edge_id,
    edge_type,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    status,
    evidence
from public.relationship_index_edges
where status = 'review_required'

union all

select
    'blank_entity_display_title'::text,
    entity_key,
    null::text,
    entity_type,
    entity_id,
    null::text,
    null::text,
    status,
    metadata
from public.relationship_index_entities
where nullif(btrim(coalesce(display_title, '')), '') is null

union all

select
    'amount_rollup_disabled_relationship_edge'::text,
    edge_id,
    edge_type,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    status,
    evidence
from public.relationship_index_edges
where include_in_search = true
  and include_in_amount_rollup = false
  and edge_type in ('fund_asset', 'lender_asset', 'beneficiary_asset');

create or replace view public.portfolio_search_results_canonical as
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
    rank_weight,
    token_row_count,
    relation_paths
from public.relationship_index_search_results;

comment on view public.relationship_index_entities is
    'Canonical interpreted entities for dashboard relationship retrieval; one row per display/search target.';

comment on view public.relationship_index_edges is
    'Canonical interpreted relationship graph between funds, assets, projects, lenders, and beneficiaries.';

comment on view public.relationship_index_tokens is
    'Searchable text tokens propagated through the interpreted relationship graph.';

comment on view public.relationship_index_search_results is
    'One-row-per entity search result view assembled from relationship_index_tokens.';

comment on view public.relationship_index_audit is
    'Review queue for unresolved, review-required, blank-title, and amount-rollup-disabled relationship edges.';
