-- Refresh RA dashboard relationship search and audit caches.
-- Run after canonical relationship/name/exposure data changes.
--
-- This is intentionally separated from the read-only audit script because it
-- mutates live materialized views.

set statement_timeout = '5min';

refresh materialized view public.relationship_index_search_results_cache;
refresh materialized view public.relationship_index_audit_cache;

select pg_notify('pgrst', 'reload schema');

select
    'portfolio_search_results_canonical' as surface,
    entity_type,
    count(*) as rows
from public.portfolio_search_results_canonical
group by entity_type
order by entity_type;

select
    'relationship_index_audit' as surface,
    issue_type,
    count(*) as rows
from public.relationship_index_audit
group by issue_type
order by issue_type;
