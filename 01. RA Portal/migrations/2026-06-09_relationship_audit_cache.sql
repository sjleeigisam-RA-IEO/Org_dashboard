-- Performance cache for relationship_index_audit.
-- Apply after 2026-06-09_relationship_index_search_cache.sql.
--
-- The audit view is for inspection, not live dashboard lookup, but Supabase
-- REST still needs it to respond quickly for verification/reporting.

set statement_timeout = '5min';

create materialized view if not exists public.relationship_index_audit_cache as
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

refresh materialized view public.relationship_index_audit_cache;

create index if not exists relationship_index_audit_cache_issue_idx
    on public.relationship_index_audit_cache(issue_type);

create index if not exists relationship_index_audit_cache_status_idx
    on public.relationship_index_audit_cache(status);

drop view if exists public.relationship_index_audit;

create or replace view public.relationship_index_audit as
select
    issue_type,
    subject_id,
    edge_type,
    source_entity_type,
    source_entity_id,
    target_entity_type,
    target_entity_id,
    status,
    evidence
from public.relationship_index_audit_cache;

comment on materialized view public.relationship_index_audit_cache is
    'Materialized audit rows for interpreted relationship graph issues and review-required edges.';

comment on view public.relationship_index_audit is
    'Stable API view over relationship_index_audit_cache.';
