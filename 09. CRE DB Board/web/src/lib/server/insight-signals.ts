import { normalizeInsightSignals, type InsightSignalsResponse } from "@/lib/insight-signals-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

const SQL = `WITH selected AS (
  SELECT s.* FROM market_intelligence.insight_signals s
  WHERE s.review_status NOT IN ('REJECTED','SUPERSEDED')
    AND (NOT ($2::boolean) OR s.review_status IN ('UNREVIEWED','PENDING'))
  ORDER BY CASE WHEN $2::boolean THEN CASE s.severity_code WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END ELSE 0 END,
           CASE WHEN NOT ($2::boolean) THEN CASE s.review_status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END ELSE 0 END,
           s.signal_date DESC,s.confidence_score DESC,s.insight_signal_id
  LIMIT $1
), payloads AS (
  SELECT s.insight_signal_id,jsonb_build_object(
    'signalId',s.insight_signal_id,'signalType',s.signal_type,'signalDate',s.signal_date,
    'title',s.title,'summary',s.summary_text,'reviewStatus',s.review_status,'severity',s.severity_code,
    'scores',jsonb_build_object('strength',s.strength_score,'evidence',s.evidence_score,
      'sourceDiversity',s.source_diversity_score,'confidence',s.confidence_score),
    'syndicationDedupeStatus',COALESCE(s.metadata_json::jsonb->>'syndication_dedupe_status','UNKNOWN'),
    'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'targetKind',e.target_kind,'targetId',e.target_id,
      'documentId',CASE WHEN e.target_kind='DOCUMENT' THEN e.target_id WHEN e.target_kind='DOCUMENT_VERSION' THEN dv.document_id ELSE NULL END,'documentVersionId',e.source_document_version_id,
      'title',COALESCE(dv.title,e.evidence_locator,'제목 미상'),'sourceName',COALESCE(cs.source_name,sd.publisher_name,'출처 미상'),
      'publishedAt',dv.published_at,'canonicalUrl',sd.canonical_url,'role',e.evidence_role,'rank',e.evidence_rank
    ) ORDER BY e.evidence_rank,e.insight_signal_evidence_id)
    FROM market_intelligence.insight_signal_evidence e
    LEFT JOIN market_intelligence.document_versions dv ON dv.document_version_id=e.source_document_version_id
    LEFT JOIN market_intelligence.source_documents sd ON sd.document_id=CASE WHEN e.target_kind='DOCUMENT' THEN e.target_id WHEN e.target_kind='DOCUMENT_VERSION' THEN dv.document_id ELSE NULL END
    LEFT JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
    WHERE e.insight_signal_id=s.insight_signal_id),'[]'::jsonb)
  ) item FROM selected s
), statuses AS (
  SELECT review_status,count(*)::bigint count FROM market_intelligence.insight_signals GROUP BY review_status
)
SELECT jsonb_build_object(
  'generatedAt',(SELECT max(computed_at) FROM market_intelligence.insight_signals),
  'algorithmVersion',COALESCE((SELECT algorithm_version FROM market_intelligence.insight_signals ORDER BY computed_at DESC,insight_signal_id DESC LIMIT 1),'NOT_REFRESHED'),
  'statusCounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('status',review_status,'count',count) ORDER BY review_status) FROM statuses),'[]'::jsonb),
  'signals',COALESCE((SELECT jsonb_agg(item ORDER BY CASE item->>'reviewStatus' WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END,(item->>'signalDate') DESC,(item->'scores'->>'confidence')::double precision DESC) FROM payloads),'[]'::jsonb)
) payload`;

export async function getInsightSignals(execute: SqlExecutor, limit = 20, reviewableOnly = false): Promise<InsightSignalsResponse> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 20;
  const query = await execute(SQL, [safeLimit, reviewableOnly]);
  return normalizeInsightSignals(query.rows[0]?.payload);
}
