import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("moves the selected date by one day or one week without passing today", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dailyResponse), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<DailyArticleWorkspace onOpenArticle={vi.fn()} />);
    await screen.findByText("시장 기사 1");

    const input = screen.getByLabelText("기사 게시일", { selector: "input" });
    const today = input.getAttribute("value") ?? "";
    const shifted = (iso: string, days: number) => {
      const date = new Date(`${iso}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    expect(screen.getByRole("button", { name: "1일 후로 이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1주 후로 이동" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "1주 전으로 이동" }));
    expect(input).toHaveValue(shifted(today, -7));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/articles/daily?date=${shifted(today, -7)}`,
      expect.anything(),
    ));

    await user.click(screen.getByRole("button", { name: "1일 전으로 이동" }));
    expect(input).toHaveValue(shifted(today, -8));
    await user.click(screen.getByRole("button", { name: "1일 후로 이동" }));
    expect(input).toHaveValue(shifted(today, -7));
    await user.click(screen.getByRole("button", { name: "1주 후로 이동" }));
    expect(input).toHaveValue(today);
    expect(screen.getByRole("button", { name: "1일 후로 이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1주 후로 이동" })).toBeDisabled();
  });

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
