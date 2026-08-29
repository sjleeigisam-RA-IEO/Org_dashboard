import { describe, expect, it } from "vitest";
import { getDocumentDetail } from "@/lib/server/document-intelligence";


describe("getDocumentDetail relation lineage", () => {
  it("loads typed canonical relations from the database projection", async () => {
    let sql = "";
    let values: readonly unknown[] = [];
    const payload = {
      id: "doc-1", title: "근거 문서", publisher: "source", documentType: "ARTICLE",
      sourceUrl: null, author: null, publishedAt: null, collectedAt: null,
      rightsStatus: "METADATA_ONLY", contentMode: "METADATA", summaryMode: "NONE",
      summaryGeneratedAt: null, summaryPipeline: null, summary: null, safeExcerpt: null,
      snippet: null, storedText: null, eventSignals: [], keywords: [], transaction: null,
      classifications: [{
        schemeCode: "DOCUMENT_PURPOSE", schemeLabel: "문서 목적",
        termCode: "MARKET_INTELLIGENCE", termLabel: "시장 동향",
        parentCode: null, parentLabel: null, isPrimary: true,
        assignmentRole: "LEGACY_BACKFILL", evidenceStatus: "MEDIA_DIRECT",
        reviewStatus: "APPROVED", confidence: 1,
      }],
      relatedEntities: [{ kind: "EVENT", id: "event-1", title: "매각 이벤트", relationBasis: "CANONICAL_EVENT", relationRole: "SUPPORTING", evidenceStatus: "V2", confidence: 0.9 }],
    };
    const result = await getDocumentDetail(async (text, params) => {
      sql = text; values = params; return { rows: [{ payload }] };
    }, "doc-1");

    expect(sql).toContain("v_document_entity_relations");
    expect(sql).toContain("relationBasis");
    expect(sql).toContain("evidenceStatus");
    expect(sql).toContain("'classifications',coalesce(cls.items");
    expect(sql).toContain("rc.target_kind='DOCUMENT'");
    expect(sql).toContain("rc.valid_from IS NULL");
    expect(result?.classifications[0].termCode).toBe("MARKET_INTELLIGENCE");
    expect(values).toEqual(["doc-1"]);
    expect(result?.relatedEntities[0].relationBasis).toBe("CANONICAL_EVENT");
  });

  it("moves object-shaped event extraction JSON out of display summaries", async () => {
    const extraction = {
      asset: "테스트 자산",
      process_code: "PROCESS-1",
      amounts: [{ basis: "closing_asset_value", value_krw: "100000000" }],
    };
    const rawExtraction = JSON.stringify(extraction);
    const payload = {
      summaryMode: "EVENT_EXTRACTION",
      summary: rawExtraction,
      eventSignals: [{ summary: rawExtraction }],
    };

    const result = await getDocumentDetail(async () => ({ rows: [{ payload }] }), "doc-1");

    expect(result?.summary).toBeNull();
    expect(result?.eventExtraction).toEqual(extraction);
    expect(result?.eventSignals[0].summary).toBeNull();
  });

  it("preserves human-readable event extraction summaries", async () => {
    const payload = {
      summaryMode: "EVENT_EXTRACTION",
      summary: "거래가 종결되었으며 확인된 금액은 1억원입니다.",
      eventSignals: [{ summary: "우선협상대상자가 선정되었습니다." }],
    };

    const result = await getDocumentDetail(async () => ({ rows: [{ payload }] }), "doc-1");

    expect(result?.summary).toBe(payload.summary);
    expect(result?.eventExtraction).toBeNull();
    expect(result?.eventSignals[0].summary).toBe(payload.eventSignals[0].summary);
  });

  it("suppresses malformed object-looking extraction text", async () => {
    const malformed = '{"asset":"테스트 자산"';
    const payload = {
      summaryMode: "EVENT_EXTRACTION",
      summary: malformed,
      eventSignals: [{ summary: malformed }],
    };

    const result = await getDocumentDetail(async () => ({ rows: [{ payload }] }), "doc-1");

    expect(result?.summary).toBeNull();
    expect(result?.eventExtraction).toBeNull();
    expect(result?.eventSignals[0].summary).toBeNull();
  });
});
