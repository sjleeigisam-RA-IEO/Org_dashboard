import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyArticleWorkspace } from "@/components/daily-article-workspace";

const dailyResponse = {
  selectedDate: "2026-08-24",
  latestAvailableDate: "2026-08-24",
  lastCollectedAt: "2026-08-24T00:15:00Z",
  generatedAt: "2026-08-24T00:16:00Z",
  total: 35,
  articles: Array.from({ length: 35 }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `시장 기사 ${index + 1}`,
    publisher: "테스트경제",
    publishedAt: "2026-08-24T00:00:00Z",
    collectedAt: "2026-08-24T00:15:00Z",
    summary: `기사 ${index + 1} 요약`,
    summaryMode: "BODY_EXTRACTIVE",
    summaryGeneratedAt: "2026-08-24T00:16:00Z",
    href: null,
  })),
};

afterEach(() => vi.restoreAllMocks());

describe("DailyArticleWorkspace", () => {
  it("renders articles in small batches and expands on demand", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dailyResponse), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<DailyArticleWorkspace onOpenArticle={vi.fn()} />);

    expect(await screen.findByText("시장 기사 30")).toBeInTheDocument();
    expect(screen.queryByText("시장 기사 31")).not.toBeInTheDocument();
    expect(screen.getByText("30 / 35건 표시")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "기사 5건 더 보기" }));
    expect(await screen.findByText("시장 기사 35")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /기사 .* 더 보기/ })).not.toBeInTheDocument();
  });
});
