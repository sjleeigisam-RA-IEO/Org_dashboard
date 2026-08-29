import { describe, expect, it } from "vitest";
import { getCompanies, getCompanyDetail } from "@/lib/server/company-intelligence";

const emptyDetail = {
  organization: { organizationId: "org-1", name: "회사", organizationType: "COMPANY", stockCode: null, industry: null, marketCap: null, overallRank: null },
  counts: { events: 0, assets: 0, documents: 0, occupancies: 0, locationEvidence: 0 },
  events: [], assets: [], documents: [], occupancies: [], locationEvidence: [],
};

describe("getCompanyDetail relation lineage", () => {
  it("uses typed relation projection while keeping name matches as labelled evidence", async () => {
    let sql = "";
    await getCompanyDetail(async (text) => { sql = text; return { rows: [{ payload: emptyDetail }] }; }, "org-1");
    expect(sql).toContain("v_document_entity_relations");
    expect(sql).toContain("RESOLVED_MENTION");
    expect(sql).toContain("VERIFIED_CLAIM");
    expect(sql).toContain("EXACT_NAME_SIGNAL");
  });

  it("uses the same managed, action-bound evidence contract in list and detail", async () => {
    let listSql = "";
    let detailSql = "";
    const listPayload = {
      snapshotDate: null,
      items: [],
      industries: [],
      coverage: { verifiedOccupancies: 0, companiesWithLocationEvidence: 0, managedLocationDocuments: 0, signalNote: "" },
    };
    await getCompanies(async (text) => { listSql = text; return { rows: [{ payload: listPayload }] }; }, {
      view: "TENANT_SIGNALS", industry: "", q: "", limit: 100,
    });
    await getCompanyDetail(async (text) => { detailSql = text; return { rows: [{ payload: emptyDetail }] }; }, "org-1");

    for (const sql of [listSql, detailSql]) {
      expect(sql).toContain("record_classifications");
      expect(sql).toContain("MARKET_CATEGORY");
      expect(sql).toContain("CORPORATE_RELOCATION");
      expect(sql).toContain("location_evidence AS");
      expect(sql).toContain("location_document_corpus AS MATERIALIZED");
      expect(sql).toContain("location_name_matches AS MATERIALIZED");
      expect(sql).toContain("본사 이전");
      expect(sql).toContain("행위주체 검토 전");
      expect(sql).toContain("replace(lower(coalesce(dv.title,'')),lower(sd.publisher_name),'')");
      expect(sql).toContain("match_position");
      expect(sql).toContain("NOT LIKE '%' || lower(s.organization_name) || '에 이어%'");
    }
  });

  it("only counts hard-gated verified tenant occupancies", async () => {
    let sql = "";
    await getCompanies(async (text) => {
      sql = text;
      return { rows: [{ payload: {
        snapshotDate: null, items: [], industries: [],
        coverage: { verifiedOccupancies: 0, companiesWithLocationEvidence: 0, managedLocationDocuments: 0, signalNote: "" },
      } }] };
    }, { view: "TENANT_SIGNALS", industry: "", q: "", limit: 100 });

    expect(sql).toContain("occupancy_status IN ('CONTRACTED','OCCUPIED')");
    expect(sql).toContain("review_status='APPROVED' AND verification_status='VERIFIED'");
    expect(sql).toContain("source_claim_id IS NOT NULL");
  });
});
