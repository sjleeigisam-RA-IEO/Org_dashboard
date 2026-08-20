-- Unified portfolio search result surface for RA Insight.
-- Apply after:
--   1. 2026-06-09_relationship_index_v1.sql
--   2. 2026-06-09_relationship_index_search_cache.sql
--
-- This view keeps the existing canonical search views intact and adds a
-- product-facing one-row-per-result contract for the dashboard UI.

drop view if exists public.portfolio_search_results_unified_v1;

create view public.portfolio_search_results_unified_v1 as
with base as (
    select
        r.entity_type,
        r.entity_id,
        case
            when r.entity_type in ('lender', 'beneficiary') then 'party'
            else r.entity_type
        end as root_entity_type,
        case
            when r.entity_type = 'lender' then 'lender'
            when r.entity_type = 'beneficiary' then 'beneficiary'
            else null
        end as root_entity_subtype,
        r.display_title,
        r.display_subtitle,
        r.token_text,
        r.token_type,
        r.related_asset_id,
        r.related_fund_id,
        r.related_project_id,
        r.relation_type,
        r.source_table,
        r.rank_weight,
        r.token_row_count,
        r.relation_paths,
        e.status as entity_status,
        e.confidence as entity_confidence,
        e.metadata as entity_metadata
    from public.relationship_index_search_results r
    left join public.relationship_index_entities e
      on e.entity_type = r.entity_type
     and e.entity_id = r.entity_id
),
edge_counts as (
    select
        b.entity_type,
        b.entity_id,
        count(distinct case
            when edge.source_entity_type = 'asset' then edge.source_entity_id
            when edge.target_entity_type = 'asset' then edge.target_entity_id
        end)::int as asset_count,
        count(distinct case
            when edge.source_entity_type = 'fund' then edge.source_entity_id
            when edge.target_entity_type = 'fund' then edge.target_entity_id
        end)::int as fund_count,
        count(distinct case
            when edge.source_entity_type = 'project' then edge.source_entity_id
            when edge.target_entity_type = 'project' then edge.target_entity_id
        end)::int as project_count,
        count(distinct case
            when edge.source_entity_type = 'lender' then edge.source_entity_id
            when edge.target_entity_type = 'lender' then edge.target_entity_id
        end)::int as lender_count,
        count(distinct case
            when edge.source_entity_type = 'beneficiary' then edge.source_entity_id
            when edge.target_entity_type = 'beneficiary' then edge.target_entity_id
        end)::int as beneficiary_count,
        bool_or(edge.status in ('review_required', 'unresolved')) as has_review_edge,
        bool_or(edge.status = 'unresolved') as has_unresolved_edge,
        bool_or(edge.include_in_amount_rollup = false and edge.include_in_search = true) as has_amount_rollup_warning,
        min(edge.confidence) as min_edge_confidence
    from base b
    left join public.relationship_index_edges edge
      on edge.include_in_search = true
     and (
        (edge.source_entity_type = b.entity_type and edge.source_entity_id = b.entity_id)
        or
        (edge.target_entity_type = b.entity_type and edge.target_entity_id = b.entity_id)
     )
    group by b.entity_type, b.entity_id
),
preview as (
    select
        b.entity_type,
        b.entity_id,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'type', neighbor.entity_type,
                    'id', neighbor.entity_id,
                    'title', neighbor.display_title,
                    'subtitle', neighbor.display_subtitle,
                    'relation_type', edge.relation_type,
                    'status', edge.status
                )
                order by
                    case neighbor.entity_type
                        when 'asset' then 1
                        when 'fund' then 2
                        when 'project' then 3
                        when 'beneficiary' then 4
                        when 'lender' then 5
                        else 9
                    end,
                    neighbor.display_title
            ) filter (where neighbor.entity_id is not null),
            '[]'::jsonb
        ) as preview_entities
    from base b
    left join public.relationship_index_edges edge
      on edge.include_in_search = true
     and (
        (edge.source_entity_type = b.entity_type and edge.source_entity_id = b.entity_id)
        or
        (edge.target_entity_type = b.entity_type and edge.target_entity_id = b.entity_id)
     )
    left join public.relationship_index_entities neighbor
      on (
        edge.source_entity_type = b.entity_type
        and edge.source_entity_id = b.entity_id
        and neighbor.entity_type = edge.target_entity_type
        and neighbor.entity_id = edge.target_entity_id
      )
      or (
        edge.target_entity_type = b.entity_type
        and edge.target_entity_id = b.entity_id
        and neighbor.entity_type = edge.source_entity_type
        and neighbor.entity_id = edge.source_entity_id
      )
    group by b.entity_type, b.entity_id
)
select
    case
        when b.entity_type = 'asset' then
            'asset:' || md5(
                lower(regexp_replace(coalesce(b.display_title, ''), '\s+', '', 'g'))
                || '|'
                || coalesce(am.pnu, '')
                || '|'
                || lower(regexp_replace(coalesce(am.address_text, ''), '\s+', '', 'g'))
            )
        when b.entity_type in ('lender', 'beneficiary') then
            'party:' || md5(lower(regexp_replace(coalesce(b.display_title, ''), '\s+', '', 'g')))
        else b.entity_type || ':' || b.entity_id
    end as result_group_id,
    b.root_entity_type || ':' || b.entity_id as result_id,
    b.root_entity_type,
    b.root_entity_subtype,
    b.entity_type,
    b.entity_id,
    b.display_title,
    b.display_subtitle,
    b.token_text,
    b.token_type,
    b.related_asset_id,
    b.related_fund_id,
    b.related_project_id,
    b.relation_type,
    b.source_table,
    greatest(
        b.rank_weight,
        case
            when b.token_type like '%_id' then 950
            when b.token_type in ('display_title', 'asset_canonical_name') then 900
            when b.relation_type = 'self' then 850
            else b.rank_weight
        end
    )
    + least(60, coalesce(ec.asset_count, 0) * 6 + coalesce(ec.fund_count, 0) * 4 + coalesce(ec.project_count, 0) * 3)
    - case when coalesce(ec.has_review_edge, false) then 50 else 0 end
    - case when coalesce(ec.has_unresolved_edge, false) then 120 else 0 end
    as rank_score,
    array_remove(array[
        'all',
        b.root_entity_type,
        case when coalesce(ec.asset_count, 0) > 0 then 'asset' end,
        case when coalesce(ec.fund_count, 0) > 0 then 'fund' end,
        case when coalesce(ec.project_count, 0) > 0 then 'project' end,
        case when coalesce(ec.lender_count, 0) + coalesce(ec.beneficiary_count, 0) > 0 then 'party' end
    ], null)::text[] as tab_facets,
    jsonb_build_object(
        'asset', coalesce(nullif(ec.asset_count, 0), case when b.entity_type = 'asset' then 1 else 0 end),
        'fund', coalesce(nullif(ec.fund_count, 0), case when b.entity_type = 'fund' then 1 else 0 end),
        'project', coalesce(nullif(ec.project_count, 0), case when b.entity_type = 'project' then 1 else 0 end),
        'lender', coalesce(nullif(ec.lender_count, 0), case when b.entity_type = 'lender' then 1 else 0 end),
        'beneficiary', coalesce(nullif(ec.beneficiary_count, 0), case when b.entity_type = 'beneficiary' then 1 else 0 end)
    ) as relationship_counts,
    jsonb_build_object(
        'status', coalesce(b.entity_status, 'confirmed'),
        'confidence', coalesce(ec.min_edge_confidence, b.entity_confidence, 1.0),
        'review_required', coalesce(ec.has_review_edge, false),
        'unresolved', coalesce(ec.has_unresolved_edge, false),
        'amount_rollup_warning', coalesce(ec.has_amount_rollup_warning, false)
    ) as quality_flags,
    p.preview_entities,
    b.relation_paths as matched_tokens,
    jsonb_build_object(
        'type', b.entity_type,
        'id', b.entity_id,
        'root_type', b.root_entity_type,
        'root_subtype', b.root_entity_subtype
    ) as detail_target,
    jsonb_build_object(
        'source_table', b.source_table,
        'token_row_count', b.token_row_count,
        'entity_metadata', b.entity_metadata
    ) as provenance
from base b
left join edge_counts ec
  on ec.entity_type = b.entity_type
 and ec.entity_id = b.entity_id
left join preview p
  on p.entity_type = b.entity_type
 and p.entity_id = b.entity_id
left join public.asset_master am
  on b.entity_type = 'asset'
 and am.asset_id = b.entity_id;

comment on view public.portfolio_search_results_unified_v1 is
    'Product-facing unified search result surface for RA Insight. Keeps one display contract for all tabs and detail entrypoints.';
