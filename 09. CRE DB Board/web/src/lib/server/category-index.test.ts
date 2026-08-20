import { describe, expect, it, vi } from "vitest";
import { getCategoryIndex, type CategorySqlExecutor } from "@/lib/server/category-index";

describe("getCategoryIndex", () => {
  it("normalizes database taxonomy groups without interpolating user input", async () => {
    const execute: CategorySqlExecutor = vi.fn().mockResolvedValue({
      rows: [{ payload: { groups: [
        { group: "EVENT_CATEGORY", label: "이벤트 카테고리", kind: "EVENT", items: [{ key: "PF", label: "PF", itemCount: 645, canonicalCount: 0 }] },
        { group: "DOCUMENT_TYPE", label: "근거 목적", kind: "DOCUMENT", items: [{ key: "MARKET_EVIDENCE", label: "시장동향 근거", itemCount: 7400 }] },
      ] } }],
    });

    const result = await getCategoryIndex(execute);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].items[0]).toMatchObject({ key: "PF", itemCount: 645 });
    expect(result.groups[1].items[0]).toMatchObject({ key: "MARKET_EVIDENCE", label: "시장동향 근거" });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql] = vi.mocked(execute).mock.calls[0];
    expect(sql).toContain("document_scope_assessments");
    expect(sql).toContain("DART_CRE_SCOPE_RULE_V1");
    expect(sql).toContain("NEWS_CRE_SCOPE_RULE_V1");
    expect(sql).toContain("MOLIT_SCOPE_TIERED_V2");
    expect(sql).toContain("organization_scope_assessments");
    expect(sql).toContain("ORG_CRE_SCOPE_RULE_V1");
    expect(sql).toContain("CRE_CONFIRMED");
    expect(sql).toContain("cs.source_code NOT IN ('OPENDART','GOOGLE_NEWS_RSS','MOLIT_REAL_TRANSACTION')");
  });
});
