import type { InstitutionalCapitalResponse, SaleProcessResponse } from "@/lib/intelligence-contract";
import type { SqlExecutor } from "@/lib/server/market-search";
import {
  buildInstitutionalSelectionAssessments,
  type RawInstitutionalDeployment,
  type RawInstitutionalManagerSignal,
} from "@/lib/server/institutional-capital-assessment";

const capitalSql = `
WITH latest_documents AS (
  SELECT DISTINCT ON (document_id) document_id,document_version_id,title,published_at
  FROM market_intelligence.document_versions
  ORDER BY document_id,version_no DESC,document_version_id DESC
), relevant_claims AS MATERIALIZED (
  SELECT source_claim_id AS claim_id FROM market_intelligence.lp_mandate_selections WHERE source_claim_id IS NOT NULL
  UNION SELECT source_claim_id FROM market_intelligence.lp_mandate_deployments WHERE source_claim_id IS NOT NULL
  UNION SELECT source_claim_id FROM market_intelligence.v_lp_manager_best_available WHERE source_claim_id IS NOT NULL AND canonical_eligible=0
  UNION SELECT claim_id FROM market_intelligence.claims
        WHERE predicate_code IN ('LP_MANDATE_MANAGER_INFERRED_FROM_DEPLOYMENT','LP_MANDATE_MANAGER_BID_PARTICIPANT')
), claim_documents AS (
  SELECT DISTINCT ON (c.claim_id) c.claim_id,
         jsonb_build_object(
           'documentId',sd.document_id,'title',dv.title,'documentType',sd.document_type,
           'publishedAt',dv.published_at,'publisher',sd.publisher_name,'href',sd.canonical_url,
           'relationBasis','SOURCE_CLAIM'
         ) AS source_document
   FROM relevant_claims rc
   JOIN market_intelligence.claims c ON c.claim_id=rc.claim_id
  JOIN market_intelligence.event_mentions em ON em.event_mention_id=c.event_mention_id
  JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id
  JOIN market_intelligence.document_versions dv ON dv.document_version_id=er.document_version_id
  JOIN market_intelligence.source_documents sd ON sd.document_id=dv.document_id
  ORDER BY c.claim_id,dv.version_no DESC,dv.document_version_id DESC
), structured_manager_signals AS (
  SELECT m.mandate_id,s.mandate_selection_id AS signal_id,s.mandate_selection_id AS selection_id,
          CASE
            WHEN s.selection_status='SELECTED' AND s.review_status='APPROVED'
              AND s.evidence_status IN ('SOURCE_CLAIM','MANUAL_VERIFIED')
              AND official_doc.source_document IS NOT NULL THEN 'OFFICIAL_SELECTION'
            WHEN s.selection_status IN ('APPLIED','SHORTLISTED') THEN 'BID_PARTICIPATION'
           ELSE 'REVIEW_REQUIRED'
         END AS signal_kind,
         manager.organization_id AS manager_organization_id,manager.canonical_name AS manager_name,
         t.track_code,t.track_name,s.selection_status,s.selected_at,
         concat_ws(' · ',s.evidence_status,s.review_status) AS value_status,
          CASE WHEN s.selection_status='SELECTED' AND s.review_status='APPROVED'
                    AND s.evidence_status IN ('SOURCE_CLAIM','MANUAL_VERIFIED')
                    AND official_doc.source_document IS NOT NULL THEN true ELSE false END AS canonical_eligible,
         s.confidence,1::int AS independent_family_count,1::int AS occurrence_count,
         NULL::text AS reported_allocation,NULL::text AS allocation_currency,
          CASE WHEN s.selection_status='SELECTED' THEN '공식 선정 결과'
              WHEN s.selection_status='SHORTLISTED' THEN 'shortlist 참여'
              WHEN s.selection_status='APPLIED' THEN '입찰 지원'
              ELSE s.selection_status END AS action_label,
          NULL::text AS vehicle_name,NULL::text AS deal_label,NULL::text AS conflict_note,
          s.evidence_status,s.review_status,
          NULL::text AS certainty_code,NULL::text AS verification_status,NULL::text AS extraction_method,
          NULL::text AS rule_version,NULL::text AS funding_basis,official_doc.source_document
  FROM market_intelligence.lp_mandate_selections s
  JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_track_id=s.mandate_track_id
  JOIN market_intelligence.lp_mandates m ON m.mandate_id=t.mandate_id
  JOIN market_intelligence.organizations lp ON lp.organization_id=m.lp_organization_id
  JOIN market_intelligence.organizations manager ON manager.organization_id=s.manager_organization_id
  LEFT JOIN claim_documents cd ON cd.claim_id=s.source_claim_id
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'documentId',sd.document_id,'title',ld.title,'documentType',sd.document_type,
      'publishedAt',ld.published_at,'publisher',sd.publisher_name,'href',sd.canonical_url,
      'relationBasis','OFFICIAL_SELECTION_EVIDENCE'
    ) AS source_document
    FROM market_intelligence.source_documents sd
    JOIN latest_documents ld ON ld.document_id=sd.document_id
    LEFT JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
    WHERE upper(sd.document_type) IN ('PRESS_RELEASE','DISCLOSURE','NOTICE','BID_NOTICE','REPORT','API_RECORD','LEGAL_DOCUMENT')
      AND (
        sd.document_id=cd.source_document->>'documentId'
        OR sd.document_id IN (
          SELECT jsonb_array_elements_text(coalesce(s.metadata_json::jsonb #> '{evidence,source_ids}','[]'::jsonb))
        )
      )
      AND (
        sd.publisher_name=lp.canonical_name
        OR (
          cs.source_kind IN ('OFFICIAL_API','OFFICIAL_SITE','PARTY_SITE')
          AND cs.authority_tier<=2
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(coalesce(
              s.metadata_json::jsonb #> '{evidence,official_source_contracts}',
              '[]'::jsonb
            )) AS contract(value)
            WHERE contract.value->>'document_id'=sd.document_id
              AND upper(coalesce(contract.value->>'verification_status',''))='VERIFIED'
              AND upper(coalesce(contract.value->>'publisher_role','')) IN ('LP','OFFICIAL_AUTHORITY','PARTY_PRIMARY')
          )
        )
      )
    ORDER BY CASE WHEN sd.publisher_name=lp.canonical_name THEN 0 ELSE 1 END,ld.published_at DESC NULLS LAST
    LIMIT 1
  ) official_doc ON true
), reported_manager_signals AS (
  SELECT m.mandate_id,coalesce(b.source_claim_id,concat('reported:',m.mandate_id,':',b.manager_organization_id,':',b.track_code)) AS signal_id,
         NULL::text AS selection_id,'REPORTED_SELECTION'::text AS signal_kind,
         b.manager_organization_id,b.manager_name,b.track_code,t.track_name,b.selection_status,b.selected_at,
         b.value_status,false AS canonical_eligible,b.confidence,b.independent_family_count,b.occurrence_count,
         b.reported_allocation_decimal AS reported_allocation,b.allocation_currency_code AS allocation_currency,
         '기사상 선정 보도'::text AS action_label,NULL::text AS vehicle_name,NULL::text AS deal_label,
          CASE WHEN b.value_status LIKE '%CONFLICT%' THEN b.value_status ELSE NULL END AS conflict_note,
          'SOURCE_CLAIM'::text AS evidence_status,'ACCEPTED'::text AS review_status,
          'REPORTED'::text AS certainty_code,'PENDING'::text AS verification_status,'MANUAL'::text AS extraction_method,
          NULL::text AS rule_version,NULL::text AS funding_basis,cd.source_document
  FROM market_intelligence.v_lp_manager_best_available b
  JOIN market_intelligence.lp_mandates m ON m.mandate_code=b.mandate_code
  LEFT JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_id=m.mandate_id AND t.track_code=b.track_code
  LEFT JOIN claim_documents cd ON cd.claim_id=b.source_claim_id
  WHERE b.canonical_eligible=0
), claim_argument_bundles AS MATERIALIZED (
  SELECT ca.claim_id,
         max(ca.text_value) FILTER (WHERE ca.role_code='MANDATE_CODE') AS mandate_code,
         max(ca.text_value) FILTER (WHERE ca.role_code='MANDATE_TRACK') AS track_code,
         max(ca.text_value) FILTER (WHERE ca.role_code='FOLLOW_UP_ACTION') AS action_label,
         max(ca.text_value) FILTER (WHERE ca.role_code='FUNDING_BASIS') AS funding_basis,
         (array_agg(ca.organization_id ORDER BY ca.ordinal) FILTER (WHERE ca.role_code='LINKED_VEHICLE'))[1] AS vehicle_organization_id,
         (array_agg(ca.asset_id ORDER BY ca.ordinal) FILTER (WHERE ca.role_code='LINKED_DEAL'))[1] AS deal_asset_id,
         (array_agg(ca.project_id ORDER BY ca.ordinal) FILTER (WHERE ca.role_code='LINKED_DEAL'))[1] AS deal_project_id,
         string_agg(ca.text_value,'; ' ORDER BY ca.ordinal) FILTER (WHERE ca.role_code='CONTRADICTION_NOTE') AS conflict_note,
         max(ca.text_value) FILTER (WHERE ca.role_code='INFERENCE_RULE_VERSION') AS rule_version,
         count(*) FILTER (WHERE ca.role_code='MANDATE_CODE') AS mandate_count,
         count(*) FILTER (WHERE ca.role_code='MANDATE_TRACK') AS track_count,
         count(*) FILTER (WHERE ca.role_code='FOLLOW_UP_ACTION') AS action_count,
         count(*) FILTER (WHERE ca.role_code='FUNDING_BASIS') AS funding_count,
         count(*) FILTER (WHERE ca.role_code='LINKED_VEHICLE') AS vehicle_count,
         count(*) FILTER (WHERE ca.role_code='LINKED_DEAL') AS deal_count,
         count(*) FILTER (WHERE ca.role_code='INFERENCE_RULE_VERSION') AS rule_count
  FROM market_intelligence.claim_arguments ca
  JOIN market_intelligence.claims c ON c.claim_id=ca.claim_id
  WHERE c.predicate_code IN ('LP_MANDATE_MANAGER_INFERRED_FROM_DEPLOYMENT','LP_MANDATE_MANAGER_BID_PARTICIPANT')
  GROUP BY ca.claim_id
), inferred_claim_signals AS (
  SELECT m.mandate_id,c.claim_id AS signal_id,NULL::text AS selection_id,
         CASE WHEN c.predicate_code='LP_MANDATE_MANAGER_BID_PARTICIPANT'
              THEN 'BID_PARTICIPATION' ELSE 'DEPLOYMENT_INFERENCE' END AS signal_kind,
         manager.organization_id AS manager_organization_id,manager.canonical_name AS manager_name,
         bundle.track_code,t.track_name,
         CASE WHEN c.predicate_code='LP_MANDATE_MANAGER_BID_PARTICIPANT' THEN 'APPLIED' ELSE 'INFERRED_SELECTED' END AS selection_status,
         c.date_start AS selected_at,concat_ws(' · ',c.certainty_code,c.verification_status,c.review_status) AS value_status,
         false AS canonical_eligible,c.confidence,1::int AS independent_family_count,1::int AS occurrence_count,
         NULL::text AS reported_allocation,NULL::text AS allocation_currency,
         bundle.action_label,
         vehicle_org.canonical_name AS vehicle_name,
          coalesce(deal_asset.canonical_name,deal_project.canonical_name) AS deal_label,
          bundle.conflict_note,'SOURCE_CLAIM'::text AS evidence_status,
          c.review_status,c.certainty_code,c.verification_status,c.extraction_method,
          bundle.rule_version,bundle.funding_basis,cd.source_document
  FROM market_intelligence.claims c
  JOIN claim_argument_bundles bundle ON bundle.claim_id=c.claim_id
  JOIN market_intelligence.lp_mandates m ON m.mandate_code=bundle.mandate_code
  JOIN market_intelligence.organizations manager ON manager.organization_id=c.object_organization_id
  JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_id=m.mandate_id AND t.track_code=bundle.track_code
  LEFT JOIN market_intelligence.organizations vehicle_org ON vehicle_org.organization_id=bundle.vehicle_organization_id
  LEFT JOIN market_intelligence.assets deal_asset ON deal_asset.asset_id=bundle.deal_asset_id
  LEFT JOIN market_intelligence.projects deal_project ON deal_project.project_id=bundle.deal_project_id
  LEFT JOIN claim_documents cd ON cd.claim_id=c.claim_id
  WHERE c.predicate_code IN ('LP_MANDATE_MANAGER_INFERRED_FROM_DEPLOYMENT','LP_MANDATE_MANAGER_BID_PARTICIPANT')
    AND c.review_status IN ('UNREVIEWED','ACCEPTED')
    AND bundle.mandate_count=1
    AND bundle.track_count=1
    AND bundle.action_count=1
    AND (
      c.predicate_code='LP_MANDATE_MANAGER_BID_PARTICIPANT'
      OR (
        bundle.funding_count=1
        AND bundle.rule_count=1
        AND bundle.vehicle_count<=1
        AND bundle.deal_count<=1
        AND bundle.vehicle_count+bundle.deal_count>=1
        AND (bundle.vehicle_count=0 OR vehicle_org.organization_id IS NOT NULL)
        AND (bundle.deal_count=0 OR deal_asset.asset_id IS NOT NULL OR deal_project.project_id IS NOT NULL)
      )
    )
), manager_signals AS (
  SELECT * FROM structured_manager_signals
  UNION ALL SELECT * FROM reported_manager_signals
  UNION ALL SELECT * FROM inferred_claim_signals
), deployment_rows AS (
  SELECT m.mandate_id,d.mandate_deployment_id AS deployment_id,s.mandate_selection_id AS selection_id,
         manager.organization_id AS manager_organization_id,manager.canonical_name AS manager_name,
         t.track_code,t.track_name,vehicle.canonical_name AS vehicle_name,
         coalesce(asset.canonical_name,project.canonical_name,event.canonical_title,sp.process_code) AS linked_target_label,
         d.deployment_basis AS basis,d.deployment_status AS status,d.deployed_at,
         d.amount_decimal AS amount,d.currency_code AS currency,d.evidence_status,d.review_status,d.confidence,
         d.source_claim_id,cd.source_document
  FROM market_intelligence.lp_mandate_deployments d
  JOIN market_intelligence.lp_mandate_selections s ON s.mandate_selection_id=d.mandate_selection_id
  JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_track_id=s.mandate_track_id
  JOIN market_intelligence.lp_mandates m ON m.mandate_id=t.mandate_id
  JOIN market_intelligence.organizations manager ON manager.organization_id=s.manager_organization_id
  LEFT JOIN market_intelligence.organizations vehicle ON vehicle.organization_id=d.fund_vehicle_organization_id
  LEFT JOIN market_intelligence.assets asset ON asset.asset_id=d.asset_id
  LEFT JOIN market_intelligence.projects project ON project.project_id=d.project_id
  LEFT JOIN market_intelligence.events event ON event.event_id=d.event_id
  LEFT JOIN market_intelligence.sale_processes sp ON sp.sale_process_id=d.sale_process_id
  LEFT JOIN claim_documents cd ON cd.claim_id=d.source_claim_id
  WHERE d.is_current=1
), mandate_rows AS (
  SELECT m.mandate_id,m.mandate_name,lp.canonical_name AS lp_name,m.mandate_status,m.mandate_scope,
         m.announced_at,m.selected_at,m.evidence_status,
         (SELECT count(*)::int FROM market_intelligence.lp_mandate_tracks t WHERE t.mandate_id=m.mandate_id) AS track_count,
         (SELECT count(*)::int FROM structured_manager_signals s WHERE s.mandate_id=m.mandate_id AND s.signal_kind='OFFICIAL_SELECTION') AS selection_count,
         (SELECT count(*)::int FROM market_intelligence.lp_mandate_amounts a LEFT JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_track_id=a.mandate_track_id LEFT JOIN market_intelligence.lp_mandate_selections s ON s.mandate_selection_id=a.mandate_selection_id LEFT JOIN market_intelligence.lp_mandate_tracks st ON st.mandate_track_id=s.mandate_track_id WHERE coalesce(a.mandate_id,t.mandate_id,st.mandate_id)=m.mandate_id AND a.is_current=1) AS amount_count,
         (SELECT count(*)::int FROM market_intelligence.lp_mandate_guidelines g JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_track_id=g.mandate_track_id WHERE t.mandate_id=m.mandate_id) AS guideline_count,
         (SELECT count(*)::int FROM deployment_rows d WHERE d.mandate_id=m.mandate_id AND d.basis='LP_SOURCE_DEPLOYMENT' AND d.status IN ('COMMITTED','EXECUTED','REALISED') AND d.review_status='APPROVED') AS deployment_count,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'trackId',t.mandate_track_id,'code',t.track_code,'name',t.track_name,'strategy',t.strategy_code,
           'geography',t.geography_code,'targetManagerCount',t.target_manager_count,'evidenceStatus',t.evidence_status,
           'guidelines',(SELECT coalesce(jsonb_agg(jsonb_build_object('termType',g.term_type,'requirement',g.requirement_level,'rawText',g.raw_text,'value',coalesce(g.text_value,g.value_decimal_text),'unit',g.unit_code,'returnBasis',g.return_basis) ORDER BY g.term_type),'[]'::jsonb) FROM market_intelligence.lp_mandate_guidelines g WHERE g.mandate_track_id=t.mandate_track_id)
         ) ORDER BY t.track_code) FROM market_intelligence.lp_mandate_tracks t WHERE t.mandate_id=m.mandate_id),'[]'::jsonb) AS tracks,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'amountId',a.mandate_amount_id,'basis',a.amount_basis,'amount',a.amount_decimal,
           'lowerAmount',a.lower_amount_decimal,'upperAmount',a.upper_amount_decimal,'currency',a.currency_code,
           'comparator',a.comparator_code,'status',a.amount_status,'rawValue',a.raw_value,'evidenceStatus',a.evidence_status
         ) ORDER BY a.amount_basis) FROM market_intelligence.lp_mandate_amounts a LEFT JOIN market_intelligence.lp_mandate_tracks t ON t.mandate_track_id=a.mandate_track_id LEFT JOIN market_intelligence.lp_mandate_selections s ON s.mandate_selection_id=a.mandate_selection_id LEFT JOIN market_intelligence.lp_mandate_tracks st ON st.mandate_track_id=s.mandate_track_id WHERE coalesce(a.mandate_id,t.mandate_id,st.mandate_id)=m.mandate_id AND a.is_current=1),'[]'::jsonb) AS amounts,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
            'selectionId',s.selection_id,'managerId',s.manager_organization_id,'managerName',s.manager_name,
            'trackCode',s.track_code,'trackName',s.track_name,'status',s.selection_status,'selectedAt',s.selected_at,
            'evidenceStatus',s.evidence_status,'reviewStatus',s.review_status,'confidence',s.confidence
          ) ORDER BY s.selected_at,s.manager_name) FROM structured_manager_signals s WHERE s.mandate_id=m.mandate_id AND s.signal_kind='OFFICIAL_SELECTION'),'[]'::jsonb) AS selections,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'signalId',s.signal_id,'selectionId',s.selection_id,'signalKind',s.signal_kind,
           'managerOrganizationId',s.manager_organization_id,'managerName',s.manager_name,
           'trackCode',s.track_code,'trackName',s.track_name,'selectionStatus',s.selection_status,
           'selectedAt',s.selected_at,'valueStatus',s.value_status,'canonicalEligible',s.canonical_eligible,
           'confidence',s.confidence,'independentFamilyCount',s.independent_family_count,'occurrenceCount',s.occurrence_count,
           'reportedAllocation',s.reported_allocation,'allocationCurrency',s.allocation_currency,
            'actionLabel',s.action_label,'vehicleName',s.vehicle_name,'dealLabel',s.deal_label,
            'conflictNote',s.conflict_note,'evidenceStatus',s.evidence_status,'reviewStatus',s.review_status,
            'certaintyCode',s.certainty_code,'verificationStatus',s.verification_status,'extractionMethod',s.extraction_method,
            'ruleVersion',s.rule_version,'fundingBasis',s.funding_basis,
            'sourceDocument',s.source_document
         ) ORDER BY s.selected_at NULLS LAST,s.manager_name) FROM manager_signals s WHERE s.mandate_id=m.mandate_id),'[]'::jsonb) AS manager_signals,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
           'deploymentId',d.deployment_id,'selectionId',d.selection_id,
           'managerOrganizationId',d.manager_organization_id,'managerName',d.manager_name,
           'trackCode',d.track_code,'trackName',d.track_name,'vehicleName',d.vehicle_name,
           'linkedTargetLabel',d.linked_target_label,'basis',d.basis,'status',d.status,'deployedAt',d.deployed_at,
           'amount',d.amount,'currency',d.currency,'evidenceStatus',d.evidence_status,'reviewStatus',d.review_status,
           'confidence',d.confidence,'sourceClaimId',d.source_claim_id,'sourceDocument',d.source_document
         ) ORDER BY d.deployed_at NULLS LAST,d.deployment_id) FROM deployment_rows d WHERE d.mandate_id=m.mandate_id),'[]'::jsonb) AS deployments,
          coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object(
            'documentId',sd.document_id,'title',ld.title,'documentType',sd.document_type,
            'publishedAt',ld.published_at,'publisher',sd.publisher_name,'href',sd.canonical_url,'relationBasis',eml.relation_code
          )) FROM market_intelligence.event_mention_links eml JOIN market_intelligence.event_mentions em ON em.event_mention_id=eml.event_mention_id JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id JOIN latest_documents ld ON ld.document_version_id=er.document_version_id JOIN market_intelligence.source_documents sd ON sd.document_id=ld.document_id WHERE eml.event_id=m.event_id AND em.status_code='APPROVED' AND eml.relation_code IN ('PRIMARY','SUPPORTING','CORRECTION')),'[]'::jsonb) AS documents
  FROM market_intelligence.lp_mandates m
  JOIN market_intelligence.organizations lp ON lp.organization_id=m.lp_organization_id
)
SELECT jsonb_build_object(
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'mandateId',mandate_id,'mandateName',mandate_name,'lpName',lp_name,'status',mandate_status,'scope',mandate_scope,
   'announcedAt',announced_at,'selectedAt',selected_at,'evidenceStatus',evidence_status,'trackCount',track_count,
   'selectionCount',selection_count,'amountCount',amount_count,'guidelineCount',guideline_count,'deploymentCount',deployment_count,
   'tracks',tracks,'amounts',amounts,'selections',selections,'managerSignals',manager_signals,
   'deployments',deployments,'documents',documents
 ) ORDER BY coalesce(selected_at,announced_at) DESC NULLS LAST,lp_name) FROM mandate_rows),'[]'::jsonb),
 'coverage',jsonb_build_object(
   'mandates',(SELECT count(*)::int FROM market_intelligence.lp_mandates),
   'selections',(SELECT count(*)::int FROM structured_manager_signals WHERE signal_kind='OFFICIAL_SELECTION'),
   'amounts',(SELECT count(*)::int FROM market_intelligence.lp_mandate_amounts WHERE is_current=1),
   'deployments',(SELECT count(*)::int FROM deployment_rows WHERE basis='LP_SOURCE_DEPLOYMENT' AND status IN ('COMMITTED','EXECUTED','REALISED') AND review_status='APPROVED')
 )) AS payload`;

const saleSql = `
WITH latest_documents AS (
  SELECT DISTINCT ON (document_id) document_id,document_version_id,title,published_at
  FROM market_intelligence.document_versions
  ORDER BY document_id,version_no DESC,document_version_id DESC
), process_rows AS (
 SELECT sp.sale_process_id,sp.process_code,e.canonical_title AS title,sp.process_status,sp.sale_method,e.event_date_start,
        sp.launched_at,sp.closed_at,sp.evidence_status,
        coalesce((SELECT jsonb_agg(jsonb_build_object('assetId',a.asset_id,'name',a.canonical_name,'address',coalesce(a.road_address,a.jibun_address)) ORDER BY a.canonical_name) FROM market_intelligence.event_assets ea JOIN market_intelligence.assets a ON a.asset_id=ea.asset_id WHERE ea.event_id=sp.event_id),'[]'::jsonb) AS assets,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'roundId',r.bid_round_id,'roundNo',r.round_no,'roundCode',r.round_code,'roundType',r.round_type,
          'deadlineAt',r.deadline_at,'status',r.round_status,'evidenceStatus',r.evidence_status,
          'bidders',(SELECT coalesce(jsonb_agg(jsonb_build_object('organizationId',o.organization_id,'name',o.canonical_name,'status',p.participation_status,'confidence',p.confidence) ORDER BY o.canonical_name),'[]'::jsonb) FROM market_intelligence.bidder_participations p JOIN market_intelligence.organizations o ON o.organization_id=p.bidder_organization_id WHERE p.bid_round_id=r.bid_round_id),
          'submissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('submissionId',s.bid_submission_id,'amount',s.bid_amount_decimal,'currency',s.currency_code,'priceBasis',s.price_basis,'rank',s.reported_rank,'confidence',s.confidence)),'[]'::jsonb) FROM market_intelligence.bid_submissions s JOIN market_intelligence.bidder_participations p ON p.participation_id=s.participation_id WHERE p.bid_round_id=r.bid_round_id),
          'decisions',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',d.decision_type,'date',d.decision_date,'status',d.decision_status,'reason',d.source_reason,'confidence',d.confidence)),'[]'::jsonb) FROM market_intelligence.bid_decisions d WHERE d.bid_round_id=r.bid_round_id)
        ) ORDER BY r.round_no) FROM market_intelligence.bid_rounds r WHERE r.sale_process_id=sp.sale_process_id),'[]'::jsonb) AS rounds,
        coalesce((SELECT jsonb_agg(jsonb_build_object('code',tm.milestone_code,'status',tm.milestone_status,'announcedAt',tm.announced_at,'effectiveDate',tm.effective_date,'expectedDate',tm.expected_date,'note',tm.source_note,'evidenceStatus',tm.evidence_status) ORDER BY coalesce(tm.effective_date,tm.announced_at,tm.expected_date)) FROM market_intelligence.transaction_milestones tm WHERE tm.sale_process_id=sp.sale_process_id),'[]'::jsonb) AS milestones,
        coalesce((SELECT jsonb_agg(jsonb_build_object('type',fc.funding_type,'provider',o.canonical_name,'amount',fc.amount_decimal,'currency',fc.currency_code,'status',fc.commitment_status,'evidenceStatus',fc.evidence_status,'confidence',fc.confidence)) FROM market_intelligence.bid_funding_components fc JOIN market_intelligence.bid_submissions bs ON bs.bid_submission_id=fc.bid_submission_id JOIN market_intelligence.bidder_participations bp ON bp.participation_id=bs.participation_id JOIN market_intelligence.bid_rounds br ON br.bid_round_id=bp.bid_round_id LEFT JOIN market_intelligence.organizations o ON o.organization_id=fc.provider_organization_id WHERE br.sale_process_id=sp.sale_process_id),'[]'::jsonb) AS funding,
        coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object('documentId',sd.document_id,'title',ld.title,'documentType',sd.document_type,'publishedAt',ld.published_at,'publisher',sd.publisher_name,'href',sd.canonical_url,'relationBasis','CANONICAL_EVENT')) FROM market_intelligence.event_mention_links eml JOIN market_intelligence.event_mentions em ON em.event_mention_id=eml.event_mention_id JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id JOIN latest_documents ld ON ld.document_version_id=er.document_version_id JOIN market_intelligence.source_documents sd ON sd.document_id=ld.document_id WHERE eml.event_id=sp.event_id),'[]'::jsonb) AS documents
 FROM market_intelligence.sale_processes sp JOIN market_intelligence.events e ON e.event_id=sp.event_id
), research_sale_mentions AS (
 SELECT em.extraction_key,em.title_raw,em.stage_code_hint,em.confidence,
        CASE WHEN left(ltrim(em.summary_raw),1)='{' THEN em.summary_raw::jsonb ELSE '{}'::jsonb END AS details
 FROM market_intelligence.event_mentions em
 JOIN market_intelligence.event_categories ec ON ec.event_category_id=em.event_category_id
 JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id
 WHERE er.pipeline_version='cutoff-research-ledger-20260819-v1'
   AND ec.code='SALE'
   AND em.status_code='REVIEW_READY'
   AND left(ltrim(em.summary_raw),1)='{'
), candidate_process_rows AS (
 SELECT extraction_key AS candidate_id,
        (array_agg(title_raw ORDER BY confidence DESC))[1] AS title,
        (array_agg(stage_code_hint ORDER BY confidence DESC))[1] AS stage_code,
        max(confidence) AS confidence,
        (array_agg(details ORDER BY confidence DESC))[1] AS details
 FROM research_sale_mentions
 GROUP BY extraction_key
), article_candidate_rows AS (
 SELECT em.event_mention_id AS candidate_id,rt.priority,
        coalesce(em.stage_code_hint,'MULTI_OR_UNRESOLVED') AS stage_code,
        coalesce(dv.published_at,dv.collected_at) AS published_at,
        sd.document_id,er.pipeline_version
 FROM market_intelligence.review_tasks rt
 JOIN market_intelligence.event_mentions em ON em.event_mention_id=rt.target_id
 JOIN market_intelligence.event_categories ec ON ec.event_category_id=em.event_category_id
 JOIN market_intelligence.extraction_runs er ON er.extraction_run_id=em.extraction_run_id
 JOIN market_intelligence.document_versions dv ON dv.document_version_id=er.document_version_id
 JOIN market_intelligence.source_documents sd ON sd.document_id=dv.document_id
 WHERE rt.target_kind='EVENT_MENTION'
   AND rt.review_type='SALE_PROCESS_EVIDENCE_REVIEW'
   AND rt.status_code IN ('PENDING','IN_PROGRESS')
   AND em.status_code='REVIEW_READY'
   AND ec.code='SALE'
   AND er.pipeline_version LIKE 'BID_PROCESS_TITLE_SNIPPET_V%'
   AND left(coalesce(dv.published_at,dv.collected_at,''),4)=left(current_date::text,4)
), current_year_article_candidate_rows AS (
 SELECT DISTINCT ON (document_id) *
 FROM article_candidate_rows
 ORDER BY document_id,pipeline_version DESC,priority,published_at DESC NULLS LAST,candidate_id
)
SELECT jsonb_build_object(
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('saleProcessId',sale_process_id,'processCode',process_code,'title',title,'status',process_status,'saleMethod',sale_method,'launchedAt',launched_at,'closedAt',closed_at,'evidenceStatus',evidence_status,'assets',assets,'rounds',rounds,'milestones',milestones,'funding',funding,'documents',documents) ORDER BY coalesce(closed_at,launched_at) DESC NULLS LAST,title) FROM process_rows),'[]'::jsonb),
 'candidateProcesses',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'candidateId',candidate_id,
   'processCode',coalesce(details->>'process_code',candidate_id),
   'title',coalesce(details->>'asset',title),
   'assetType',coalesce(details->>'asset_type','UNKNOWN'),
   'method',coalesce(details->>'method','UNKNOWN'),
   'status',coalesce(details->>'current_status','REVIEW_READY'),
   'stageCode',coalesce(stage_code,'MULTI_OR_UNRESOLVED'),
   'evidenceGrade',coalesce(details->>'evidence_grade','C'),
   'confidence',confidence,
   'roles',coalesce(details->'roles','{}'::jsonb),
   'rounds',coalesce(details->'rounds','[]'::jsonb),
   'milestones',coalesce(details->'milestones','[]'::jsonb),
   'amounts',coalesce(details->'amounts','[]'::jsonb),
   'financing',coalesce(details->'financing','[]'::jsonb),
   'sources',coalesce(details->'source_refs','[]'::jsonb)
 ) ORDER BY candidate_id) FROM candidate_process_rows),'[]'::jsonb),
 'coverage',jsonb_build_object(
  'processes',(SELECT count(*)::int FROM market_intelligence.sale_processes),
  'rounds',(SELECT count(*)::int FROM market_intelligence.bid_rounds),
  'bidders',(SELECT count(*)::int FROM market_intelligence.bidder_participations),
  'submissions',(SELECT count(*)::int FROM market_intelligence.bid_submissions),
  'decisions',(SELECT count(*)::int FROM market_intelligence.bid_decisions),
  'fundingComponents',(SELECT count(*)::int FROM market_intelligence.bid_funding_components),
  'milestones',(SELECT count(*)::int FROM market_intelligence.transaction_milestones),
  'signalYear',left(current_date::text,4)::int,
  'candidateCutoffDate','2026-08-19',
  'currentYearProcesses',(SELECT count(*)::int FROM process_rows WHERE left(coalesce(closed_at,launched_at,event_date_start,''),4)=left(current_date::text,4)),
  'currentYearCandidateProcesses',(SELECT count(*)::int FROM candidate_process_rows),
  'currentYearArticleSignals',(SELECT count(*)::int FROM current_year_article_candidate_rows),
  'currentYearPriorityArticleSignals',(SELECT count(*)::int FROM current_year_article_candidate_rows WHERE priority=1),
  'currentYearResolvedStageArticleSignals',(SELECT count(*)::int FROM current_year_article_candidate_rows WHERE stage_code<>'MULTI_OR_UNRESOLVED')
 )) AS payload`;

export async function getInstitutionalCapital(execute: SqlExecutor): Promise<InstitutionalCapitalResponse> {
  const query = await execute(capitalSql, []);
  type RawItem = Omit<
    InstitutionalCapitalResponse["items"][number],
    "assessments" | "deployments" | "officialSelectionCount" | "inferredSelectionCount" | "bidParticipationCount" | "reviewRequiredCount"
  > & { managerSignals: RawInstitutionalManagerSignal[]; deployments: RawInstitutionalDeployment[] };
  type RawPayload = {
    items: RawItem[];
    coverage: Pick<InstitutionalCapitalResponse["coverage"], "mandates" | "selections" | "amounts" | "deployments">;
  };
  const payload = query.rows[0]?.payload as RawPayload | undefined;
  if (!payload?.items) throw new Error("Invalid institutional-capital response");
  const items = payload.items.map((rawItem) => {
    const { managerSignals, deployments, ...item } = rawItem;
    const assessments = buildInstitutionalSelectionAssessments({
      mandateId: item.mandateId,
      mandateName: item.mandateName,
      lpName: item.lpName,
      tracks: item.tracks,
      documents: item.documents,
      managerSignals,
      deployments,
    });
    const count = (verdict: InstitutionalCapitalResponse["items"][number]["assessments"][number]["verdict"]) => (
      assessments.filter((assessment) => assessment.verdict === verdict).length
    );
    return {
      ...item,
      deployments: deployments as unknown as Array<Record<string, unknown>>,
      assessments,
      officialSelectionCount: count("OFFICIAL_SELECTION"),
      inferredSelectionCount: count("INFERRED_SELECTION"),
      bidParticipationCount: count("BID_PARTICIPATION"),
      reviewRequiredCount: count("REVIEW_REQUIRED"),
    };
  });
  const verdictCount = (verdict: InstitutionalCapitalResponse["items"][number]["assessments"][number]["verdict"]) => (
    items.reduce((total, item) => total + item.assessments.filter((assessment) => assessment.verdict === verdict).length, 0)
  );
  return {
    items,
    coverage: {
      ...payload.coverage,
      officialSelections: verdictCount("OFFICIAL_SELECTION"),
      inferredSelections: verdictCount("INFERRED_SELECTION"),
      bidParticipations: verdictCount("BID_PARTICIPATION"),
      reviewRequired: verdictCount("REVIEW_REQUIRED"),
    },
    generatedAt: new Date().toISOString(),
    database: "supabase-postgresql",
  };
}

export async function getSaleProcesses(execute: SqlExecutor): Promise<SaleProcessResponse> {
  const query = await execute(saleSql, []);
  const payload = query.rows[0]?.payload as Omit<SaleProcessResponse, "generatedAt" | "database"> | undefined;
  if (!payload?.items) throw new Error("Invalid sale-process response");
  return { ...payload, generatedAt: new Date().toISOString(), database: "supabase-postgresql" };
}
