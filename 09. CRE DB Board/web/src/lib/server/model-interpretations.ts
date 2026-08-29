import { normalizeModelInterpretations,type ModelInterpretationsResponse } from "@/lib/model-interpretations-contract";
import type { SqlExecutor } from "@/lib/server/market-search";
const SQL=`WITH models AS (
 SELECT model_registry_id,provider_code,model_name,model_version,embedding_version,prompt_version,prompt_hash,status_code FROM market_intelligence.analytics_model_registry WHERE task_code='TOPIC_INTERPRETATION'
), selected AS (
 SELECT i.* FROM market_intelligence.insight_interpretations i WHERE i.interpretation_status IN ('APPROVED','DRAFT','IN_REVIEW') ORDER BY CASE i.interpretation_status WHEN 'APPROVED' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,i.generated_at DESC LIMIT $1
), evidence AS (
 SELECT l.interpretation_id,jsonb_agg(jsonb_build_object('targetKind',se.target_kind,'targetId',se.target_id,'documentId',CASE WHEN se.target_kind='DOCUMENT' THEN se.target_id WHEN se.target_kind='DOCUMENT_VERSION' THEN dv.document_id ELSE NULL END,'documentVersionId',se.source_document_version_id,'title',coalesce(se.evidence_locator,dv.title,se.target_id),'sourceName',coalesce(cs.source_name,''),'publishedAt',dv.published_at,'canonicalUrl',sd.canonical_url) ORDER BY se.evidence_rank) payload
 FROM market_intelligence.insight_interpretation_evidence l JOIN market_intelligence.insight_signal_evidence se ON se.insight_signal_evidence_id=l.insight_signal_evidence_id
 LEFT JOIN market_intelligence.document_versions dv ON dv.document_version_id=se.source_document_version_id LEFT JOIN market_intelligence.source_documents sd ON sd.document_id=CASE WHEN se.target_kind='DOCUMENT' THEN se.target_id WHEN se.target_kind='DOCUMENT_VERSION' THEN dv.document_id ELSE NULL END LEFT JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
 GROUP BY l.interpretation_id
)
SELECT jsonb_build_object(
 'generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'models',coalesce((SELECT jsonb_agg(jsonb_build_object('modelRegistryId',model_registry_id,'providerCode',provider_code,'modelName',model_name,'modelVersion',model_version,'embeddingVersion',embedding_version,'promptVersion',prompt_version,'promptHash',prompt_hash,'statusCode',status_code) ORDER BY model_name,model_version) FROM models),'[]'::jsonb),
 'statusCounts',coalesce((SELECT jsonb_agg(jsonb_build_object('status',interpretation_status,'count',count)) FROM (SELECT interpretation_status,count(*)::int count FROM market_intelligence.insight_interpretations GROUP BY interpretation_status) x),'[]'::jsonb),
 'interpretations',coalesce((SELECT jsonb_agg(jsonb_build_object('interpretationId',s.interpretation_id,'signalId',s.insight_signal_id,'status',s.interpretation_status,'headline',s.headline,'narrative',s.narrative_text,'generatedAt',s.generated_at,'model',jsonb_build_object('modelRegistryId',m.model_registry_id,'providerCode',m.provider_code,'modelName',m.model_name,'modelVersion',m.model_version,'embeddingVersion',m.embedding_version,'promptVersion',m.prompt_version,'promptHash',m.prompt_hash,'statusCode',m.status_code),'evidence',coalesce(e.payload,'[]'::jsonb)) ORDER BY s.generated_at DESC) FROM selected s JOIN models m ON m.model_registry_id=s.model_registry_id LEFT JOIN evidence e ON e.interpretation_id=s.interpretation_id),'[]'::jsonb)
) payload`;
export async function getModelInterpretations(execute:SqlExecutor,limit=20):Promise<ModelInterpretationsResponse>{const safe=Number.isFinite(limit)?Math.max(1,Math.min(50,Math.trunc(limit))):20;const q=await execute(SQL,[safe]);return normalizeModelInterpretations(q.rows[0]?.payload)}
