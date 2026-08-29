import { describe, expect, it } from "vitest";
import { normalizeDailyArticles } from "@/lib/daily-articles-contract";

describe("normalizeDailyArticles", () => {
  it("normalizes optional intelligence fields without fabricating classifications", () => {
    const value = normalizeDailyArticles({
      selectedDate: "2026-08-29", latestAvailableDate: "2026-08-29", lastCollectedAt: null,
      generatedAt: "2026-08-29T00:00:00Z", total: 1,
      articles: [{ id: "doc-1", title: "시장 기사", publisher: null, publishedAt: "2026-08-29T00:00:00Z", collectedAt: "2026-08-29T00:01:00Z", summary: null, summaryMode: "NONE", summaryGeneratedAt: null, href: null }],
    });
    expect(value.articles[0].topics).toEqual([]);
    expect(value.articles[0].evidenceGrade).toBeNull();
  });

  it("rejects a successful response with the wrong record shape", () => {
    expect(() => normalizeDailyArticles({ results: [], total: 0 })).toThrow("Invalid daily articles payload");
  });
});
