import { describe, expect, it, vi } from "vitest";
import { buildMarketHeadline, getQuantitativeMarketPulse } from "@/lib/server/quantitative-market-pulse";

type Point = { period: string; transactionCount: number; amountKrw: string; areaM2: string; sourceRowCount: number; uniquePayloadCount: number };

const months = (startYear: number, startMonth: number, count: number): Point[] => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1));
  return {
    period: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    transactionCount: 0,
    amountKrw: "0",
    areaM2: "0",
    sourceRowCount: 0,
    uniquePayloadCount: 0,
  };
});

const analysisTrend = months(2025, 1, 19).map((point) => {
  const values: Record<string, Partial<Point>> = {
    "2025-01": { transactionCount: 2, amountKrw: "100", areaM2: "10", sourceRowCount: 2, uniquePayloadCount: 2 },
    "2025-07": { transactionCount: 4, amountKrw: "400", areaM2: "40", sourceRowCount: 4, uniquePayloadCount: 4 },
    "2026-01": { transactionCount: 3, amountKrw: "300", areaM2: "30", sourceRowCount: 3, uniquePayloadCount: 3 },
    "2026-06": { transactionCount: 0, amountKrw: "0", areaM2: "0", sourceRowCount: 0, uniquePayloadCount: 0 },
    "2026-07": { transactionCount: 2, amountKrw: "600", areaM2: "60", sourceRowCount: 3, uniquePayloadCount: 2 },
  };
  return { ...point, ...values[point.period] };
});

const payload = {
  generatedAt: "2026-08-31T02:00:00.000Z",
  asOfPeriod: "2026-07",
  analysisTrend,
  trend: analysisTrend,
  latestGroups: [
    { rank: 1, dealDate: "2026-07-16", district: "강남구", locality: "역삼동", buildingUse: "업무", amountKrw: "400", areaM2: "40", sharePct: 66.67 },
    { rank: 2, dealDate: "2026-07-17", district: "강남구", locality: "삼성동", buildingUse: "판매", amountKrw: "200", areaM2: "20", sharePct: 33.33 },
  ],
  districts: [{ district: "강남구", transactionCount: 2, amountKrw: "600", areaM2: "60", sharePct: 100 }],
};

describe("getQuantitativeMarketPulse SQL contract", () => {
  it("passes one PostgreSQL regex escape for decimal building areas", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ payload }] });
    await getQuantitativeMarketPulse(execute);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toContain("buildingAr','') ~ '^[0-9]+(\\.[0-9]+)?$'");
    expect(sql).not.toContain("buildingAr','') ~ '^[0-9]+(\\\\.[0-9]+)?$'");
  });

  it("deduplicates only byte-identical canonical payloads without regrouping partial fields", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ payload }] });
    await getQuantitativeMarketPulse(execute);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toContain("SELECT DISTINCT api");
    expect(sql).toContain("canonical_transactions AS");
    expect(sql).not.toContain("transaction_group AS");
    expect(sql).not.toMatch(/GROUP BY api->>'dealYear'/);
  });

  it("guards source casts so malformed numeric and calendar fields fail closed", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ payload }] });
    await getQuantitativeMarketPulse(execute);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toContain("CASE WHEN coalesce(metadata->'api_record'->>'buildingAr','') ~");
    expect(sql).toContain("THEN (metadata->'api_record'->>'buildingAr')::numeric > 3300");
    expect(sql).toContain("CASE WHEN coalesce(metadata->'api_record'->>'dealYear','') ~");
  });

  it("excludes unknown building use and keeps only source-covered months behind the completeness cutoff", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ payload }] });
    await getQuantitativeMarketPulse(execute);
    const sql = execute.mock.calls[0][0] as string;
    expect(sql).toContain("nullif(btrim(metadata->'api_record'->>'buildingUse'),'') IS NOT NULL");
    expect(sql).toContain("generate_series");
    expect(sql).toContain("source_coverage AS MATERIALIZED");
    expect(sql).toContain("JOIN source_coverage coverage USING(month_start)");
    expect(sql).toContain("current_month");
    expect(sql).toContain("latest_data_month < current_month");
    expect(sql).toContain("interval '1 month'");
    expect(sql).toContain("interval '18 months'");
  });
});

describe("getQuantitativeMarketPulse calculations", () => {
  it("uses the zero-filled prior calendar month and complete prior-year YTD window", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ payload }] });
    const result = await getQuantitativeMarketPulse(execute);
    expect(result.asOfPeriod).toBe("2026-07");
    expect(result.metrics.amount.previousValue).toBe(0);
    expect(result.metrics.amount.momPct).toBeNull();
    expect(result.metrics.amount.yearAgoValue).toBe(400);
    expect(result.metrics.amount.yoyPct).toBe(50);
    expect(result.metrics.amount.ytdValue).toBe(900);
    expect(result.metrics.amount.priorYtdValue).toBe(500);
    expect(result.metrics.amount.ytdYoyPct).toBe(80);
    expect(result.trend).toHaveLength(19);
    expect(result.quality).toEqual({ sourceRowCount: 3, transactionCount: 2, uniquePayloadCount: 2, exactDuplicateRows: 1 });
  });

  it("does not compare a coverage gap as the prior month", async () => {
    const gapped = payload.analysisTrend.filter((point) => point.period !== "2026-06");
    const withoutJune = { ...payload, analysisTrend: gapped, trend: gapped };
    const result = await getQuantitativeMarketPulse(vi.fn().mockResolvedValue({ rows: [{ payload: withoutJune }] }));
    expect(result.metrics.amount.previousValue).toBeNull();
    expect(result.metrics.amount.momPct).toBeNull();
  });

  it("fails closed before deriving metrics from malformed database payloads", async () => {
    const malformed = { ...payload, trend: payload.trend.map((point, index) => index === 0 ? { ...point, amountKrw: "not-a-number" } : point) };
    await expect(getQuantitativeMarketPulse(vi.fn().mockResolvedValue({ rows: [{ payload: malformed }] }))).rejects.toThrow(/Invalid/);
  });
});

describe("buildMarketHeadline", () => {
  it.each([
    [1, 1, "동반 증가"], [1, 0, "신고 거래금액 증가 · 고유 신고행 보합"], [1, -1, "대형 신고행 중심"],
    [0, 1, "신고 거래금액 보합 · 고유 신고행 증가"], [0, 0, "동반 보합"], [0, -1, "신고 거래금액 보합 · 고유 신고행 감소"],
    [-1, 1, "신고 거래금액 감소 · 고유 신고행 증가"], [-1, 0, "신고 거래금액 감소 · 고유 신고행 보합"], [-1, -1, "동반 감소"],
  ])("describes amount %s and count %s without collapsing mixed directions", (amount, count, phrase) => {
    expect(buildMarketHeadline(amount, count)).toContain(phrase);
  });

  it("treats changes that round to 0.0% as flat", () => {
    expect(buildMarketHeadline(0.04, -0.04)).toContain("동반 보합");
  });

  it("states when either comparison is unavailable", () => {
    expect(buildMarketHeadline(null, -1)).toContain("전월 비교 불가");
    expect(buildMarketHeadline(1, null)).toContain("전월 비교 불가");
  });
});
