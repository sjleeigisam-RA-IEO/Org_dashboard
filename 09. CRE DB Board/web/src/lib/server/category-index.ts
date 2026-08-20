import type { CategoryIndexGroup, CategoryIndexResponse } from "@/lib/search-contract";

export type CategorySqlExecutor = (
  text: string,
  values: readonly (string | number | null)[],
) => Promise<{ rows: Array<{ payload: unknown }> }>;

const categoryIndexSql = `
WITH document_type_groups(group_key, group_label, document_type, sort_order) AS (
  VALUES
    ('TRANSACTION_EVIDENCE', '거래·가격 근거', 'API_RECORD', 1),
    ('CORPORATE_EVIDENCE', '기업·사업 근거', 'DISCLOSURE', 2),
    ('CORPORATE_EVIDENCE', '기업·사업 근거', 'OFFICIAL_FILING', 2),
    ('CORPORATE_EVIDENCE', '기업·사업 근거', 'PRESS_RELEASE', 2),
    ('MARKET_EVIDENCE', '시장동향 근거', 'RSS_ITEM', 3),
    ('MARKET_EVIDENCE', '시장동향 근거', 'ARTICLE', 3),
    ('MARKET_EVIDENCE', '시장동향 근거', 'RESEARCH_REPORT', 3),
    ('PROCESS_EVIDENCE', '절차·공고 근거', 'BID_NOTICE', 4),
    ('PROCESS_EVIDENCE', '절차·공고 근거', 'NOTICE', 4)
), latest_document_versions AS (
  SELECT DISTINCT ON (document_id) document_id, document_version_id
  FROM market_intelligence.document_versions
  ORDER BY document_id, version_no DESC, document_version_id DESC
), current_cre_scope AS (
  SELECT document_version_id, classifier_version, status_code
  FROM market_intelligence.document_scope_assessments
  WHERE scope_code='CRE' AND classifier_version IN (
    'DART_CRE_SCOPE_RULE_V1','NEWS_CRE_SCOPE_RULE_V1','MOLIT_SCOPE_TIERED_V2'
  )
), event_mention_counts AS (
  SELECT event_category_id, count(*)::int AS item_count
  FROM market_intelligence.event_mentions GROUP BY event_category_id
), event_canonical_counts AS (
  SELECT primary_category_id AS event_category_id, count(*)::int AS canonical_count
  FROM market_intelligence.events GROUP BY primary_category_id
), event_items AS (
  SELECT ec.code AS key, ec.name_ko AS label,
         coalesce(em.item_count, 0)::int AS item_count,
         coalesce(e.canonical_count, 0)::int AS canonical_count
  FROM market_intelligence.event_categories ec
  LEFT JOIN event_mention_counts em ON em.event_category_id = ec.event_category_id
  LEFT JOIN event_canonical_counts e ON e.event_category_id = ec.event_category_id
), asset_items AS (
  SELECT ac.code AS key, ac.name_ko AS label, count(a.asset_id)::int AS item_count
  FROM market_intelligence.asset_classes ac
  LEFT JOIN market_intelligence.assets a ON a.asset_class_id = ac.asset_class_id
  GROUP BY ac.code, ac.name_ko
), document_items AS (
  SELECT dtg.group_key AS key, dtg.group_label AS label,
         count(sd.document_id)::int AS item_count,
         min(dtg.sort_order)::int AS sort_order
  FROM document_type_groups dtg
  LEFT JOIN market_intelligence.source_documents sd ON sd.document_type=dtg.document_type
  LEFT JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
  LEFT JOIN latest_document_versions ldv ON ldv.document_id=sd.document_id
  LEFT JOIN current_cre_scope dsa ON dsa.document_version_id=ldv.document_version_id
    AND dsa.classifier_version=CASE cs.source_code
      WHEN 'OPENDART' THEN 'DART_CRE_SCOPE_RULE_V1'
      WHEN 'GOOGLE_NEWS_RSS' THEN 'NEWS_CRE_SCOPE_RULE_V1'
      WHEN 'MOLIT_REAL_TRANSACTION' THEN 'MOLIT_SCOPE_TIERED_V2'
    END
  WHERE sd.document_id IS NULL OR cs.source_code IS NULL
     OR cs.source_code NOT IN ('OPENDART','GOOGLE_NEWS_RSS','MOLIT_REAL_TRANSACTION')
     OR dsa.status_code='CRE_CONFIRMED'
  GROUP BY dtg.group_key, dtg.group_label
), organization_items AS (
  SELECT coalesce(organization_type, '미분류') AS key,
         coalesce(organization_type, '미분류') AS label,
         count(*)::int AS item_count
  FROM market_intelligence.organizations o
  JOIN market_intelligence.organization_scope_assessments osa
    ON osa.organization_id=o.organization_id
   AND osa.scope_code='CRE'
   AND osa.classifier_version='ORG_CRE_SCOPE_RULE_V1'
   AND osa.status_code='CRE_CONFIRMED'
  GROUP BY o.organization_type
), lp_items AS (
  SELECT coalesce(mandate_status, '미분류') AS key,
         coalesce(mandate_status, '미분류') AS label,
         count(*)::int AS item_count
  FROM market_intelligence.lp_mandates GROUP BY mandate_status
), sale_items AS (
  SELECT coalesce(process_status, '미분류') AS key,
         coalesce(process_status, '미분류') AS label,
         count(*)::int AS item_count
  FROM market_intelligence.sale_processes GROUP BY process_status
)
SELECT jsonb_build_object('groups', jsonb_build_array(
  jsonb_build_object('group','EVENT_CATEGORY','label','이벤트 카테고리','kind','EVENT','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count,'canonicalCount',canonical_count) ORDER BY label), '[]'::jsonb) FROM event_items)),
  jsonb_build_object('group','ASSET_CLASS','label','자산 유형','kind','ASSET','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count) ORDER BY label), '[]'::jsonb) FROM asset_items)),
  jsonb_build_object('group','DOCUMENT_TYPE','label','근거 목적','kind','DOCUMENT','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count) ORDER BY sort_order), '[]'::jsonb) FROM document_items)),
  jsonb_build_object('group','ORGANIZATION_TYPE','label','기관 유형','kind','ORGANIZATION','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count) ORDER BY item_count DESC, label), '[]'::jsonb) FROM organization_items)),
  jsonb_build_object('group','LP_STATUS','label','LP Mandate 상태','kind','LP_MANDATE','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count) ORDER BY item_count DESC, label), '[]'::jsonb) FROM lp_items)),
  jsonb_build_object('group','SALE_STATUS','label','매각 절차 상태','kind','SALE_PROCESS','items',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'itemCount',item_count) ORDER BY item_count DESC, label), '[]'::jsonb) FROM sale_items))
)) AS payload`;

export async function getCategoryIndex(execute: CategorySqlExecutor): Promise<CategoryIndexResponse> {
  const started = performance.now();
  const query = await execute(categoryIndexSql, []);
  const payload = query.rows[0]?.payload as { groups?: CategoryIndexGroup[] } | undefined;
  if (!payload?.groups) throw new Error("Invalid category index response");
  return {
    groups: payload.groups,
    generatedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    database: "supabase-postgresql",
  };
}
