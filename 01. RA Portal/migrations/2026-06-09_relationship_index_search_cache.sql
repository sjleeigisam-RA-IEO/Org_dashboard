-- Performance cache for the canonical relationship search surface.
-- Apply after 2026-06-09_relationship_index_v1.sql.
--
-- The relationship graph views are intentionally interpretive, but the final
-- one-row-per-entity search result must be cheap for Supabase REST. This
-- materialized cache avoids recomputing token aggregation on every dashboard
-- query.

set statement_timeout = '5min';

create extension if not exists pg_trgm;

create materialized view if not exists public.relationship_index_search_results_cache as
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

create unique index if not exists relationship_index_search_results_cache_entity_uidx
    on public.relationship_index_search_results_cache(entity_type, entity_id);

create index if not exists relationship_index_search_results_cache_rank_idx
    on public.relationship_index_search_results_cache(rank_weight desc);

create index if not exists relationship_index_search_results_cache_token_trgm_idx
    on public.relationship_index_search_results_cache
    using gin (token_text gin_trgm_ops);

create or replace view public.relationship_index_search_results as
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
from public.relationship_index_search_results_cache;

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
from public.relationship_index_search_results_cache;

comment on materialized view public.relationship_index_search_results_cache is
    'Materialized one-row-per entity relationship search result cache for fast Supabase REST lookup. Refresh after canonical relationship data changes.';

comment on view public.relationship_index_search_results is
    'Stable API view over relationship_index_search_results_cache.';

comment on view public.portfolio_search_results_canonical is
    'Dashboard primary search surface; one row per canonical entity, backed by materialized relationship search cache.';
