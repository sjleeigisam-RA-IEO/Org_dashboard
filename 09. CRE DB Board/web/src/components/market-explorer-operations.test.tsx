import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MarketExplorer } from "@/components/market-explorer";

const indexResponse = { groups: [], generatedAt: "2026-08-22T06:00:00Z", elapsedMs: 1, database: "supabase-postgresql" };
const searchResponse = { request: { q: "", kind: "EVENT", category: "", classificationScheme: "", from: null, to: null, page: 1, pageSize: 50, includeTransactionsUnder1000Eok: false }, results: [], facets: { EVENT: 0, ASSET: 0, ORGANIZATION: 0, DOCUMENT: 0, LP_MANDATE: 0, SALE_PROCESS: 0 }, total: 0, elapsedMs: 1, generatedAt: "2026-08-22T06:00:00Z", database: "supabase-postgresql" };
const overview = {
  generatedAt: "2026-08-22T06:00:00Z", asOfAt: "2026-08-22T06:00:00Z", policyVersion: "SOURCE_HEALTH_V1",
  summary: { sourceCount: 1, onboardedSourceCount: 0, notOnboardedSourceCount: 1, distinctDocumentCount: 0, documentVersionCount: 0, runCount: 0 }, runStatusCounts: [],
  classificationQuality: { schemes: [], reviewStatusCounts: [], evidenceStatusCounts: [], currentAssignmentCount: 0, supersededAssignmentCount: 0 },
  sources: [{ sourceCode: "KOSIS", sourceName: "국가통계포털", sourceKind: "STATISTICS", onboarding: "NOT_ONBOARDED", slaMode: "NOT_ONBOARDED", freshness: "NO_SLA", latestExecution: "NONE", dataOutcome: "UNKNOWN", activeJobCount: 0, scheduledJobCount: 0, runCount: 0, completedRunCount: 0, distinctDocumentCount: 0, documentVersionCount: 0, latestSuccessfulAt: null, latestRunAt: null, expectedIntervalSeconds: null, graceSeconds: null, latestDiscoveredCount: null, latestInsertedCount: null, latestUpdatedCount: null, latestRejectedCount: null }],
};

afterEach(() => vi.restoreAllMocks());

describe("MarketExplorer operations workspace", () => {
  it("opens operations as a separate top-level workspace", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/index") ? indexResponse : url.startsWith("/api/operations/overview") ? overview : searchResponse;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<MarketExplorer />);

    await user.click(screen.getByRole("button", { name: /운영·인사이트/ }));
    expect(await screen.findByRole("heading", { name: "적재 상태부터 시장 신호까지 한 화면에서 점검" })).toBeInTheDocument();
    expect(screen.getByText("국가통계포털")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/operations/overview", expect.anything()));
  });
});
