import type { CompanyDetailResponse, CompanyListRequest, CompanyListResponse } from "@/lib/intelligence-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

// location_subjects(organization_id, organization_name) must be declared before
// this fragment. Managed taxonomy is authoritative when present; legacy event
// mentions remain a clearly labelled discovery layer until review catches up.
const locationEvidenceCtes = `
managed_location_categories AS (
  SELECT DISTINCT ON (r.target_id)
         r.target_id AS document_id,t.term_code AS source_category,
         r.review_status AS classification_review_status,
         r.evidence_status AS classification_evidence_status,
         r.confidence AS classification_confidence
  FROM market_intelligence.record_classifications r
  JOIN market_intelligence.classification_schemes s
    ON s.classification_scheme_id=r.classification_scheme_id
  JOIN market_intelligence.classification_terms t
    ON t.classification_scheme_id=r.classification_scheme_id
   AND t.classification_term_id=r.classification_term_id
  WHERE r.target_kind='DOCUMENT'
    AND s.scheme_code='MARKET_CATEGORY'
    AND t.term_code IN ('LEASE','RELOCATION')
    AND r.review_status<>'REJECTED'
  ORDER BY r.target_id,r.is_primary DESC,
           CASE t.term_code WHEN 'RELOCATION' THEN 1 ELSE 2 END,
           r.confidence DESC NULLS LAST,r.assigned_at DESC,r.record_classification_id
), legacy_location_mentions AS (
  SELECT DISTINCT ON (dv.document_id)
         dv.document_id,ec.code AS source_category,em.status_code AS mention_status,
         em.confidence,em.title_raw,em.summary_raw,em.stage_code_hint
  FROM market_intelligence.event_mentions em
  JOIN market_intelligence.event_categories ec ON ec.event_category_id=em.event_category_id
  JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id
  JOIN market_intelligence.document_versions dv ON dv.document_version_id=er.document_version_id
  WHERE ec.code IN ('LEASE','CORPORATE_RELOCATION') AND em.status_code<>'REJECTED'
  ORDER BY dv.document_id,
           CASE em.status_code WHEN 'APPROVED' THEN 1 WHEN 'REVIEW_READY' THEN 2
                WHEN 'RESOLUTION_REQUIRED' THEN 3 ELSE 4 END,
           em.confidence DESC,dv.version_no DESC,em.event_mention_id
), location_document_metadata AS (
  SELECT coalesce(m.document_id,l.document_id) AS document_id,
         CASE WHEN m.document_id IS NOT NULL THEN m.source_category
              ELSE l.source_category END AS source_category,
         CASE WHEN m.document_id IS NOT NULL THEN 'MANAGED_TAXONOMY'
              ELSE 'LEGACY_DISCOVERY' END AS classification_basis,
         m.classification_review_status,m.classification_evidence_status,
         coalesce(m.classification_confidence,l.confidence) AS confidence,
         l.mention_status,l.title_raw,l.summary_raw,l.stage_code_hint
  FROM managed_location_categories m
  FULL OUTER JOIN legacy_location_mentions l ON l.document_id=m.document_id
), location_document_corpus AS MATERIALIZED (
  SELECT meta.*,dv.document_version_id,dv.title,dv.published_at,dv.snippet_text,
         sd.publisher_name AS publisher,sd.canonical_url AS href,sd.document_type,
         lower(concat_ws(' ',
           regexp_replace(
             CASE WHEN nullif(sd.publisher_name,'') IS NULL THEN lower(coalesce(dv.title,''))
                  ELSE replace(lower(coalesce(dv.title,'')),lower(sd.publisher_name),'') END,
             '[[:space:]]+-[[:space:]]+[^-]{1,100}$','','g'
           ),
           CASE WHEN nullif(sd.publisher_name,'') IS NULL THEN coalesce(dv.snippet_text,'')
                ELSE replace(lower(coalesce(dv.snippet_text,'')),lower(sd.publisher_name),'') END,
           regexp_replace(
             CASE WHEN nullif(sd.publisher_name,'') IS NULL THEN lower(coalesce(meta.title_raw,''))
                  ELSE replace(lower(coalesce(meta.title_raw,'')),lower(sd.publisher_name),'') END,
             '[[:space:]]+-[[:space:]]+[^-]{1,100}$','','g'
           ),
           regexp_replace(
             CASE WHEN nullif(sd.publisher_name,'') IS NULL THEN lower(coalesce(meta.summary_raw,''))
                  ELSE replace(lower(coalesce(meta.summary_raw,'')),lower(sd.publisher_name),'') END,
             '[[:space:]]+-[[:space:]]+[^-]{1,100}$','','g'
           )
         )) AS content_text,
         nullif(left(regexp_replace(
           CASE WHEN nullif(sd.publisher_name,'') IS NULL
                THEN coalesce(nullif(meta.summary_raw,''),nullif(meta.title_raw,''),
                  CASE WHEN ltrim(coalesce(dv.snippet_text,'')) LIKE '{%' THEN NULL ELSE dv.snippet_text END)
                ELSE replace(coalesce(nullif(meta.summary_raw,''),nullif(meta.title_raw,''),
                  CASE WHEN ltrim(coalesce(dv.snippet_text,'')) LIKE '{%' THEN NULL ELSE dv.snippet_text END),sd.publisher_name,'')
           END,
           '\\s+',' ','g'),420),'') AS evidence_excerpt
  FROM location_document_metadata meta
  JOIN LATERAL (
    SELECT document_version_id,title,published_at,snippet_text,version_no
    FROM market_intelligence.document_versions
    WHERE document_id=meta.document_id
    ORDER BY version_no DESC,document_version_id DESC LIMIT 1
  ) dv ON true
  JOIN market_intelligence.source_documents sd ON sd.document_id=meta.document_id
), action_location_documents AS MATERIALIZED (
  SELECT *
  FROM location_document_corpus
  WHERE content_text ~ '(잔류|재계약|계약 갱신|임대차 갱신|본사|사옥|오피스|사무실|사업장|사무소|선임차|임대차 계약|임차 계약|입주 예정|임차인|테넌트|"status"[[:space:]]*:[[:space:]]*"contracted")'
), location_name_matches AS MATERIALIZED (
  SELECT s.organization_id,s.organization_name,d.*,
         substring(d.content_text FROM greatest(strpos(d.content_text,lower(s.organization_name))-120,1)
           FOR length(s.organization_name)+360) AS evidence_window
  FROM location_subjects s
  JOIN action_location_documents d ON length(s.organization_name)>=3
  CROSS JOIN LATERAL (
    SELECT strpos(d.content_text,lower(s.organization_name)) AS match_position
  ) pos
  WHERE pos.match_position>0
    AND (pos.match_position=1 OR substring(d.content_text FROM pos.match_position-1 FOR 1) !~ '[[:alnum:]가-힣]')
    AND (
      substring(d.content_text FROM pos.match_position+length(s.organization_name) FOR 1)=''
      OR substring(d.content_text FROM pos.match_position+length(s.organization_name) FOR 1) !~ '[[:alnum:]가-힣]'
      OR substring(d.content_text FROM pos.match_position+length(s.organization_name) FOR 1) IN ('은','는','이','가','을','를','의','도','과','와','에','로')
    )
    AND d.content_text NOT LIKE '%' || lower(s.organization_name) || ' 이어%'
    AND d.content_text NOT LIKE '%' || lower(s.organization_name) || '에 이어%'
    AND d.content_text NOT LIKE '%' || lower(s.organization_name) || '을 이어%'
    AND d.content_text NOT LIKE '%' || lower(s.organization_name) || '를 이어%'
    AND d.content_text NOT LIKE '%' || lower(s.organization_name) || '처럼%'
), typed_location_evidence AS (
  SELECT n.*,
    CASE
      WHEN evidence_window ~ '(잔류|재계약|계약 갱신|임대차 갱신)' THEN 'STAY'
      WHEN evidence_window ~ '((본사|사옥|오피스|사무실|사업장).{0,28}이전|이전.{0,28}(본사|사옥|오피스|사무실|사업장))' THEN 'RELOCATION'
      WHEN evidence_window ~ '((사무소|오피스).{0,24}(개설|신설|확장|진입|진출)|(개설|신설|확장|진입|진출).{0,24}(사무소|오피스))' THEN 'EXPANSION'
      WHEN evidence_window ~ '(선임차|임대차 계약|임차 계약|입주 예정|임차인|테넌트|"status"[[:space:]]*:[[:space:]]*"contracted")' THEN 'NEW_LEASE'
      ELSE NULL
    END AS evidence_type,
    substring(evidence_window FROM '(잔류 확정|재계약|임대차 갱신|본사 이전 확정|사옥 이전 확정|본사 이전|사옥 이전|오피스 이전|사무실 이전|사업장 이전|선임차 확정|선임차|임대차 계약|임차 계약|입주 예정|사무소 개설|오피스 신설|사무소 확장)') AS matched_phrase
  FROM location_name_matches n
), staged_location_evidence AS (
  SELECT t.*,
    CASE
      WHEN evidence_window ~ '(잔류 확정|이전 확정|계약 체결|선임차 확정|입주 확정|입주 예정|이전 완료|"status"[[:space:]]*:[[:space:]]*"contracted")' THEN 'CONFIRMED_WORDING'
      WHEN evidence_window ~ '(타진|검토|논의|가능성|후보)' THEN 'EXPLORING_WORDING'
      WHEN evidence_window ~ '(추진|속도|계획|우선|선정|진입|진출|개설|신설|확장)' THEN 'IN_PROGRESS_WORDING'
      ELSE 'REVIEW_REQUIRED'
    END AS wording_stage
  FROM typed_location_evidence t
  WHERE evidence_type IS NOT NULL
    AND evidence_window !~ '(이전.{0,12}(부인|취소|무산|철회)|((부인|취소|무산|철회).{0,12}이전))'
    AND evidence_window !~ '(구사옥|옛 사옥)'
), location_evidence AS (
  SELECT s.*,
    CASE evidence_type WHEN 'RELOCATION' THEN '이전 관련 문구'
      WHEN 'STAY' THEN '잔류·갱신 문구'
      WHEN 'NEW_LEASE' THEN '임차·입주 문구'
      ELSE '신설·확장 문구' END AS evidence_label,
    CASE WHEN classification_basis='MANAGED_TAXONOMY'
      THEN '관리형 ' || source_category || ' 분류 문서에서 회사명과 ‘' ||
           coalesce(matched_phrase,CASE evidence_type WHEN 'RELOCATION' THEN '이전' WHEN 'STAY' THEN '잔류·갱신' WHEN 'NEW_LEASE' THEN '임차·입주' ELSE '신설·확장' END) || '’ 표현이 같은 문맥에 등장'
      ELSE '과거 자동분류 문서에서 회사명과 ‘' ||
           coalesce(matched_phrase,CASE evidence_type WHEN 'RELOCATION' THEN '이전' WHEN 'STAY' THEN '잔류·갱신' WHEN 'NEW_LEASE' THEN '임차·입주' ELSE '신설·확장' END) || '’ 표현이 같은 문맥에 등장 · 행위주체 검토 전'
      END AS evidence_reason
  FROM staged_location_evidence s
), managed_location_document_count AS (
  SELECT count(*)::int AS count FROM managed_location_categories
)`;

const locationEvidenceJsonSql = `jsonb_build_object(
  'documentId',document_id,'evidenceType',evidence_type,'wordingStage',wording_stage,
  'evidenceLabel',evidence_label,'title',title,'matchedPhrase',matched_phrase,
  'evidenceExcerpt',evidence_excerpt,'evidenceReason',evidence_reason,
  'sourceCategory',source_category,'classificationBasis',classification_basis,
  'classificationReviewStatus',classification_review_status,
  'publishedAt',published_at,'publisher',publisher,'href',href,
  'mentionStatus',mention_status,'confidence',confidence
)`;

const companyListSql = `
WITH universe AS (
  SELECT organization_id,organization_name,industry_name,overall_rank,industry_rank,
         market_cap_decimal,universe_code,snapshot_date
  FROM market_intelligence.v_company_universe_current
), selected_universe AS (
  SELECT organization_id,max(organization_name) AS organization_name,
         max(industry_name) AS industry_name,min(overall_rank) AS overall_rank,
         min(industry_rank) AS industry_rank,max(market_cap_decimal::numeric) AS market_cap,
         max(snapshot_date) AS snapshot_date
  FROM universe
  WHERE (\$1::text='OVERALL' AND universe_code='KRX_MARKET_CAP_TOP_50')
     OR (\$1::text='INDUSTRY' AND universe_code='KRX_INDUSTRY_MARKET_CAP_TOP_10')
     OR (\$1::text='TENANT_SIGNALS')
  GROUP BY organization_id
), location_subjects AS (
  SELECT organization_id,organization_name FROM selected_universe
), ${locationEvidenceCtes},
evidence_counts AS (
  SELECT organization_id,count(DISTINCT document_id)::int AS document_count,
         count(DISTINCT coalesce(nullif(publisher,''),document_id))::int AS publisher_count
  FROM location_evidence GROUP BY organization_id
), evidence_ranked AS (
  SELECT e.*,row_number() OVER (
    PARTITION BY organization_id
    ORDER BY published_at DESC NULLS LAST,
      CASE wording_stage WHEN 'CONFIRMED_WORDING' THEN 1 WHEN 'IN_PROGRESS_WORDING' THEN 2
        WHEN 'EXPLORING_WORDING' THEN 3 ELSE 4 END,
      confidence DESC NULLS LAST,document_id
  ) AS row_no
  FROM location_evidence e
), primary_evidence AS (
  SELECT * FROM evidence_ranked WHERE row_no=1
), occupancy_counts AS (
  SELECT organization_id,count(*)::int AS count
  FROM market_intelligence.organization_property_occupancies
  WHERE tenure_type='TENANT' AND occupancy_status IN ('CONTRACTED','OCCUPIED')
    AND review_status='APPROVED' AND verification_status='VERIFIED'
    AND source_claim_id IS NOT NULL
    AND (asset_id IS NOT NULL OR project_id IS NOT NULL OR region_id IS NOT NULL)
  GROUP BY organization_id
), event_counts AS (
  SELECT organization_id,count(DISTINCT event_id)::int AS count
  FROM market_intelligence.event_participants GROUP BY organization_id
), asset_counts AS (
  SELECT ep.organization_id,count(DISTINCT ea.asset_id)::int AS count
  FROM market_intelligence.event_participants ep
  JOIN market_intelligence.event_assets ea ON ea.event_id=ep.event_id
  GROUP BY ep.organization_id
), company_rows AS (
  SELECT u.organization_id,u.organization_name,o.stock_code,u.industry_name,
         u.market_cap::text AS market_cap_decimal,u.overall_rank,u.industry_rank,
         coalesce(occ.count,0)::int AS confirmed_occupancy_count,
         coalesce(ev.count,0)::int AS canonical_event_count,
         coalesce(ast.count,0)::int AS related_asset_count,
         coalesce(cnt.document_count,0)::int AS location_evidence_document_count,
         coalesce(cnt.publisher_count,0)::int AS location_evidence_publisher_count,
         pe.document_id AS evidence_document_id,pe.evidence_type,pe.wording_stage,
         pe.evidence_label,pe.title AS evidence_title,pe.matched_phrase,
         pe.evidence_excerpt,pe.evidence_reason,pe.source_category,
         pe.classification_basis,pe.classification_review_status,
         pe.published_at AS evidence_published_at,pe.publisher AS evidence_publisher,
         pe.href AS evidence_href,pe.mention_status,pe.confidence AS evidence_confidence,
         u.snapshot_date
  FROM selected_universe u
  JOIN market_intelligence.organizations o ON o.organization_id=u.organization_id
  LEFT JOIN occupancy_counts occ ON occ.organization_id=u.organization_id
  LEFT JOIN event_counts ev ON ev.organization_id=u.organization_id
  LEFT JOIN asset_counts ast ON ast.organization_id=u.organization_id
  LEFT JOIN evidence_counts cnt ON cnt.organization_id=u.organization_id
  LEFT JOIN primary_evidence pe ON pe.organization_id=u.organization_id
), filtered AS (
  SELECT * FROM company_rows
  WHERE (\$2::text='' OR industry_name=\$2)
    AND (\$3::text='' OR organization_name ILIKE '%' || \$3 || '%' OR coalesce(stock_code,'') ILIKE '%' || \$3 || '%')
    AND (\$1::text<>'TENANT_SIGNALS' OR confirmed_occupancy_count>0 OR location_evidence_document_count>0)
), industries AS (
  SELECT industry_name AS name,count(DISTINCT organization_id)::int AS count
  FROM universe WHERE universe_code='KRX_INDUSTRY_MARKET_CAP_TOP_10'
  GROUP BY industry_name
)
SELECT jsonb_build_object(
  'snapshotDate',(SELECT max(snapshot_date) FROM universe),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'organizationId',organization_id,'name',organization_name,'stockCode',stock_code,
    'industry',industry_name,'marketCap',market_cap_decimal,'overallRank',overall_rank,
    'industryRank',industry_rank,'confirmedOccupancyCount',confirmed_occupancy_count,
    'canonicalEventCount',canonical_event_count,'relatedAssetCount',related_asset_count,
    'locationEvidenceDocumentCount',location_evidence_document_count,
    'locationEvidencePublisherCount',location_evidence_publisher_count,
    'primaryLocationEvidence',CASE WHEN evidence_document_id IS NULL THEN NULL ELSE jsonb_build_object(
      'documentId',evidence_document_id,'evidenceType',evidence_type,'wordingStage',wording_stage,
      'evidenceLabel',evidence_label,'title',evidence_title,'matchedPhrase',matched_phrase,
      'evidenceExcerpt',evidence_excerpt,'evidenceReason',evidence_reason,
      'sourceCategory',source_category,'classificationBasis',classification_basis,
      'classificationReviewStatus',classification_review_status,
      'publishedAt',evidence_published_at,'publisher',evidence_publisher,'href',evidence_href,
      'mentionStatus',mention_status,'confidence',evidence_confidence
    ) END
  ) ORDER BY
    CASE WHEN \$1::text='TENANT_SIGNALS' THEN evidence_published_at END DESC NULLS LAST,
    market_cap_decimal::numeric DESC NULLS LAST,organization_name)
    FROM (SELECT * FROM filtered LIMIT \$4) x),'[]'::jsonb),
  'industries',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name,'count',count) ORDER BY name) FROM industries),'[]'::jsonb),
  'coverage',jsonb_build_object(
    'verifiedOccupancies',(SELECT coalesce(sum(count),0)::int FROM occupancy_counts),
    'companiesWithLocationEvidence',(SELECT count(*)::int FROM company_rows WHERE location_evidence_document_count>0),
    'managedLocationDocuments',(SELECT count FROM managed_location_document_count),
    'signalNote','확정 점유는 승인·검증된 관계만 표시합니다. 나머지는 회사명과 입지 행동 표현이 같은 문맥에 등장한 검토 전 문서이며 독립된 이전 사건 수가 아닙니다.'
  )
) AS payload`;

const companyDetailSql = `
WITH target AS (
  SELECT o.organization_id,o.canonical_name,o.organization_type,o.stock_code
  FROM market_intelligence.organizations o WHERE o.organization_id=\$1
), universe AS (
  SELECT industry_name,market_cap_decimal,overall_rank
  FROM market_intelligence.v_company_universe_current WHERE organization_id=\$1
  ORDER BY overall_rank NULLS LAST,industry_rank NULLS LAST LIMIT 1
), location_subjects AS (
  SELECT organization_id,canonical_name AS organization_name FROM target
), ${locationEvidenceCtes},
events AS (
  SELECT DISTINCT e.event_id,e.canonical_title AS title,ec.name_ko AS category,
         ep.role_code,e.current_stage_code AS stage,e.event_date_start AS date,
         e.lifecycle_status AS status,e.verification_level AS verification
  FROM market_intelligence.event_participants ep
  JOIN market_intelligence.events e ON e.event_id=ep.event_id
  LEFT JOIN market_intelligence.event_categories ec ON ec.event_category_id=e.primary_category_id
  WHERE ep.organization_id=\$1
  ORDER BY e.event_date_start DESC NULLS LAST
), assets AS (
  SELECT DISTINCT a.asset_id,a.canonical_name AS name,ac.name_ko AS asset_class,
         coalesce(a.road_address,a.jibun_address) AS address
  FROM market_intelligence.event_participants ep
  JOIN market_intelligence.event_assets ea ON ea.event_id=ep.event_id
  JOIN market_intelligence.assets a ON a.asset_id=ea.asset_id
  LEFT JOIN market_intelligence.asset_classes ac ON ac.asset_class_id=a.asset_class_id
  WHERE ep.organization_id=\$1
  UNION
  SELECT DISTINCT a.asset_id,a.canonical_name,ac.name_ko,coalesce(a.road_address,a.jibun_address)
  FROM market_intelligence.organization_property_occupancies op
  JOIN market_intelligence.assets a ON a.asset_id=op.asset_id
  LEFT JOIN market_intelligence.asset_classes ac ON ac.asset_class_id=a.asset_class_id
  WHERE op.organization_id=\$1
), occupancies AS (
  SELECT occupancy_id,occupancy_type,tenure_type,occupancy_status,valid_from,valid_to,
         verification_status,review_status,confidence
  FROM market_intelligence.organization_property_occupancies
  WHERE organization_id=\$1 AND tenure_type='TENANT'
    AND occupancy_status IN ('CONTRACTED','OCCUPIED')
    AND review_status='APPROVED' AND verification_status='VERIFIED'
    AND source_claim_id IS NOT NULL
    AND (asset_id IS NOT NULL OR project_id IS NOT NULL OR region_id IS NOT NULL)
  ORDER BY valid_from DESC NULLS LAST
), canonical_docs AS (
  SELECT DISTINCT ON (sd.document_id)
         sd.document_id,dv.title,sd.document_type,dv.published_at,sd.publisher_name AS publisher,
         sd.canonical_url AS href,r.relation_basis
  FROM market_intelligence.v_document_entity_relations r
  JOIN market_intelligence.document_versions dv ON dv.document_version_id=r.document_version_id
  JOIN market_intelligence.source_documents sd ON sd.document_id=dv.document_id
  WHERE r.entity_kind='ORGANIZATION' AND r.entity_id=\$1
  ORDER BY sd.document_id,
    CASE r.relation_basis WHEN 'CANONICAL_EVENT' THEN 1 WHEN 'RESOLVED_MENTION' THEN 2
         WHEN 'VERIFIED_CLAIM' THEN 3 ELSE 4 END,
    r.confidence DESC NULLS LAST,dv.version_no DESC
), location_docs AS (
  SELECT e.document_id,e.title,e.document_type,e.published_at,e.publisher,e.href,
         'EXACT_NAME_SIGNAL'::text AS relation_basis
  FROM location_evidence e
  WHERE NOT EXISTS (SELECT 1 FROM canonical_docs c WHERE c.document_id=e.document_id)
), docs AS (
  SELECT * FROM canonical_docs UNION ALL SELECT * FROM location_docs
)
SELECT jsonb_build_object(
  'organization',(SELECT jsonb_build_object(
    'organizationId',t.organization_id,'name',t.canonical_name,'organizationType',t.organization_type,
    'stockCode',t.stock_code,'industry',u.industry_name,'marketCap',u.market_cap_decimal,'overallRank',u.overall_rank
  ) FROM target t LEFT JOIN universe u ON true),
  'counts',jsonb_build_object(
    'events',(SELECT count(*)::int FROM events),'assets',(SELECT count(*)::int FROM assets),
    'documents',(SELECT count(*)::int FROM docs),'occupancies',(SELECT count(*)::int FROM occupancies),
    'locationEvidence',(SELECT count(DISTINCT document_id)::int FROM location_evidence)
  ),
  'events',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM events x),'[]'::jsonb),
  'assets',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM assets x),'[]'::jsonb),
  'documents',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'documentId',document_id,'title',title,'documentType',document_type,'publishedAt',published_at,
    'publisher',publisher,'href',href,'relationBasis',relation_basis
  ) ORDER BY published_at DESC NULLS LAST) FROM docs),'[]'::jsonb),
  'occupancies',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM occupancies x),'[]'::jsonb),
  'locationEvidence',coalesce((SELECT jsonb_agg(${locationEvidenceJsonSql}
    ORDER BY published_at DESC NULLS LAST,document_id) FROM location_evidence),'[]'::jsonb)
) AS payload`;

export async function getCompanies(execute: SqlExecutor, request: CompanyListRequest): Promise<CompanyListResponse> {
  const query = await execute(companyListSql, [request.view, request.industry, request.q, request.limit]);
  const payload = query.rows[0]?.payload as Omit<CompanyListResponse, "request" | "generatedAt" | "database"> | undefined;
  if (!payload?.items) throw new Error("Invalid company intelligence response");
  return { request, ...payload, generatedAt: new Date().toISOString(), database: "supabase-postgresql" };
}

export async function getCompanyDetail(execute: SqlExecutor, organizationId: string): Promise<CompanyDetailResponse> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(organizationId)) throw new Error("Invalid organization id");
  const query = await execute(companyDetailSql, [organizationId]);
  const payload = query.rows[0]?.payload as Omit<CompanyDetailResponse, "generatedAt" | "database"> | undefined;
  if (!payload?.organization) throw new Error("Company not found");
  return { ...payload, generatedAt: new Date().toISOString(), database: "supabase-postgresql" };
}
