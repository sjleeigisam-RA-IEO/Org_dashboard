import { normalizeKeywordAnalytics, type KeywordAnalyticsResponse } from "@/lib/keyword-analytics-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

const SQL = `WITH latest_refresh AS (
  SELECT * FROM market_intelligence.analytics_refresh_runs
  WHERE pipeline_code='KEYWORD_DAILY' AND status_code='COMPLETED'
  ORDER BY completed_at DESC,analytics_refresh_run_id DESC LIMIT 1
), latest_day AS (
  SELECT max(o.bucket_date) AS bucket_date
  FROM market_intelligence.keyword_observations_daily o JOIN latest_refresh r ON r.algorithm_version=o.algorithm_version
), selected AS (
  SELECT o.*,kd.display_term,kd.term_kind,kd.is_collection_bias
  FROM market_intelligence.keyword_observations_daily o
  JOIN market_intelligence.keyword_dictionary kd ON kd.keyword_id=o.keyword_id
  JOIN latest_refresh r ON r.algorithm_version=o.algorithm_version
  JOIN latest_day d ON d.bucket_date=o.bucket_date
  WHERE kd.status_code='ACTIVE'
  ORDER BY CASE WHEN $2::boolean AND kd.is_collection_bias=0 AND o.document_frequency>=2 AND o.burst_score>0 THEN 0 WHEN $2::boolean THEN 1 ELSE 0 END,
           kd.is_collection_bias ASC,o.burst_score DESC,o.document_frequency DESC,kd.display_term
  LIMIT $1
), keyword_payload AS (
  SELECT s.keyword_id,jsonb_build_object(
    'keywordId',s.keyword_id,'term',s.display_term,'termKind',s.term_kind,
    'isCollectionBias',(s.is_collection_bias=1),'documentFrequency',s.document_frequency,
    'baselineDocumentFrequency',s.baseline_document_frequency,'burstScore',s.burst_score,
    'trend',COALESCE((SELECT jsonb_agg(jsonb_build_object('date',x.bucket_date,'documentFrequency',x.document_frequency) ORDER BY x.bucket_date)
      FROM market_intelligence.keyword_observations_daily x
      WHERE x.keyword_id=s.keyword_id AND x.algorithm_version=s.algorithm_version
        AND x.bucket_date>=(s.bucket_date::date-29)::text AND x.bucket_date<=s.bucket_date),'[]'::jsonb),
    'cooccurrences',COALESCE((SELECT jsonb_agg(jsonb_build_object('term',q.display_term,'documentFrequency',q.document_frequency) ORDER BY q.document_frequency DESC,q.display_term)
      FROM (SELECT other.display_term,sum(c.document_frequency)::bigint AS document_frequency
        FROM market_intelligence.keyword_cooccurrences_daily c
        JOIN market_intelligence.keyword_dictionary other ON other.keyword_id=CASE WHEN c.keyword_left_id=s.keyword_id THEN c.keyword_right_id ELSE c.keyword_left_id END
        WHERE (c.keyword_left_id=s.keyword_id OR c.keyword_right_id=s.keyword_id)
          AND c.algorithm_version=s.algorithm_version AND c.bucket_date>=(s.bucket_date::date-29)::text
        GROUP BY other.display_term ORDER BY document_frequency DESC,other.display_term LIMIT 5) q),'[]'::jsonb)
  ) AS item FROM selected s
)
SELECT jsonb_build_object(
  'generatedAt',current_timestamp,'algorithmVersion',COALESCE(r.algorithm_version,'NOT_REFRESHED'),
  'computedAt',COALESCE(r.completed_at,current_timestamp::text),'windowStart',COALESCE(r.window_start,''),
  'windowEnd',COALESCE(r.window_end,''),'latestDate',d.bucket_date,
  'summary',jsonb_build_object(
    'keywordCount',COALESCE((SELECT count(*) FROM market_intelligence.keyword_dictionary k WHERE k.algorithm_version=r.algorithm_version),0),
    'observationCount',COALESCE((SELECT count(*) FROM market_intelligence.keyword_observations_daily o WHERE o.algorithm_version=r.algorithm_version),0),
    'qualifiedKeywordCount',COALESCE((SELECT count(*) FROM market_intelligence.keyword_observations_daily o
      JOIN market_intelligence.keyword_dictionary k ON k.keyword_id=o.keyword_id
      WHERE o.algorithm_version=r.algorithm_version AND o.bucket_date=d.bucket_date AND k.status_code='ACTIVE'
        AND k.is_collection_bias=0 AND o.document_frequency>=2 AND o.burst_score>0),0),
    'excludedMissingPublicationCount',COALESCE((r.metadata_json::jsonb->>'documents_excluded_missing_publication')::bigint,0)),
  'keywords',COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'isCollectionBias')::boolean,(item->>'burstScore')::double precision DESC) FROM keyword_payload),'[]'::jsonb)
) AS payload FROM (SELECT 1) anchor LEFT JOIN latest_refresh r ON true LEFT JOIN latest_day d ON true`;

export async function getKeywordAnalytics(execute: SqlExecutor, limit = 30, briefingPriority = false): Promise<KeywordAnalyticsResponse> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 30;
  const query = await execute(SQL, [safeLimit, briefingPriority]);
  return normalizeKeywordAnalytics(query.rows[0]?.payload);
}
