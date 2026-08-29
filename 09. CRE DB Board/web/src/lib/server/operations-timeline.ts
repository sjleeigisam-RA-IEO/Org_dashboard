import { isOperationsTimelineWindowDays, normalizeOperationsTimeline, type OperationsTimelineResponse } from "@/lib/operations-timeline-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

const TIMELINE_SQL = `
WITH bounds AS (
  SELECT current_date-($1::int-1) AS start_date,current_date AS end_date
), archive_rows AS (
  SELECT asi.* FROM market_intelligence.archived_serving_index asi
  JOIN market_intelligence.archive_snapshots ars ON ars.archive_snapshot_id=asi.archive_snapshot_id
   AND ars.is_current=1 AND ars.integrity_status='VALIDATED'
), latest_document_versions AS (
  SELECT DISTINCT ON (document_id) document_id,document_version_id,published_at,collected_at
  FROM market_intelligence.document_versions
  ORDER BY document_id,version_no DESC,document_version_id DESC
), current_cre_scope AS (
  SELECT DISTINCT ON (document_version_id)
         document_version_id,classifier_version,status_code
  FROM market_intelligence.document_scope_assessments
  WHERE scope_code='CRE' AND classifier_version IN (
    'DART_CRE_SCOPE_RULE_V1','NEWS_CRE_SCOPE_RULE_V3','NEWS_CRE_SCOPE_RULE_V2','NEWS_CRE_SCOPE_RULE_V1','MOLIT_SCOPE_TIERED_V2'
  )
  ORDER BY document_version_id,
           CASE classifier_version
             WHEN 'NEWS_CRE_SCOPE_RULE_V3' THEN 0
             WHEN 'NEWS_CRE_SCOPE_RULE_V2' THEN 1
             ELSE 2
           END,
           assessed_at DESC, document_scope_assessment_id DESC
), serving_documents AS (
  SELECT sd.document_id,ldv.published_at,ldv.collected_at
  FROM market_intelligence.source_documents sd
  LEFT JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
  LEFT JOIN latest_document_versions ldv ON ldv.document_id=sd.document_id
  LEFT JOIN current_cre_scope dsa ON dsa.document_version_id=ldv.document_version_id
  WHERE cs.source_code IS NULL OR cs.source_code NOT IN ('OPENDART','GOOGLE_NEWS_RSS','MOLIT_REAL_TRANSACTION') OR dsa.status_code='CRE_CONFIRMED'
), publication_daily AS (
  SELECT left(sd.published_at,10)::date AS day,count(DISTINCT document_id)::int AS count
  FROM serving_documents sd,bounds b
  WHERE sd.published_at IS NOT NULL AND left(sd.published_at,10)::date BETWEEN b.start_date AND b.end_date
  GROUP BY left(sd.published_at,10)::date
), ingestion_daily AS (
  SELECT left(sd.collected_at,10)::date AS day,count(DISTINCT document_id)::int AS count
  FROM serving_documents sd,bounds b
  WHERE sd.collected_at IS NOT NULL AND left(sd.collected_at,10)::date BETWEEN b.start_date AND b.end_date
  GROUP BY left(sd.collected_at,10)::date
), serving_events AS (
  SELECT e.event_id,e.event_date_start FROM market_intelligence.events e
  UNION
  SELECT ar.record_id,ar.event_date_start FROM archive_rows ar
  WHERE ar.record_kind='EVENT' AND NOT EXISTS (SELECT 1 FROM market_intelligence.events e WHERE e.event_id=ar.record_id)
), event_daily AS (
  SELECT left(e.event_date_start,10)::date AS day,count(DISTINCT event_id)::int AS count
  FROM serving_events e,bounds b
  WHERE e.event_date_start IS NOT NULL AND left(e.event_date_start,10)::date BETWEEN b.start_date AND b.end_date
  GROUP BY left(e.event_date_start,10)::date
), calendar AS (
  SELECT generate_series(b.start_date,b.end_date,interval '1 day')::date AS day FROM bounds b
)
SELECT jsonb_build_object(
  'generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'windowDays',$1::int,
  'publicationKnownCount',(SELECT count(DISTINCT document_id)::int FROM serving_documents WHERE published_at IS NOT NULL),
  'publicationUnknownCount',(SELECT count(DISTINCT document_id)::int FROM serving_documents WHERE published_at IS NULL),
  'archivedDocumentExcludedCount',(SELECT count(*)::int FROM archive_rows ar WHERE ar.record_kind='DOCUMENT' AND NOT EXISTS (SELECT 1 FROM market_intelligence.source_documents sd WHERE sd.document_id=ar.record_id)),
  'series',(SELECT jsonb_agg(jsonb_build_object('date',to_char(c.day,'YYYY-MM-DD'),'publicationCount',coalesce(p.count,0),'eventCount',coalesce(e.count,0),'ingestionCount',coalesce(i.count,0)) ORDER BY c.day)
    FROM calendar c LEFT JOIN publication_daily p ON p.day=c.day LEFT JOIN event_daily e ON e.day=c.day LEFT JOIN ingestion_daily i ON i.day=c.day)
) AS payload`;

export async function getOperationsTimeline(execute: SqlExecutor, requestedDays = 90): Promise<OperationsTimelineResponse> {
  if (!isOperationsTimelineWindowDays(requestedDays)) throw new RangeError("Unsupported operations timeline window");
  const query = await execute(TIMELINE_SQL, [requestedDays]);
  return normalizeOperationsTimeline(query.rows[0]?.payload);
}
