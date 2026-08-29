import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MarketExplorer } from "@/components/market-explorer";
import { koreanIsoDate } from "@/lib/search-contract";

const response = {
  request: { q: "", kind: "EVENT", category: "", from: "2026-01-01", to: "2026-07-31", page: 1, pageSize: 50 },
  results: [{
    kind: "EVENT", id: "evt-1", title: "용인 데이터센터 본PF 약정",
    subtitle: "PF · MAIN_PF_COMMITTED", summary: "6,200억원 대주단 약정",
    date: "2026-07-13", status: "ACTIVE", confidence: 0.91,
    source: "canonical event", href: null, category: "PF", categoryLabel: "PF",
    metadata: { assets: "용인 남사 데이터센터", participants: "대주단" },
  }],
  facets: { EVENT: 28, ASSET: 16, ORGANIZATION: 70, DOCUMENT: 54985, LP_MANDATE: 12, SALE_PROCESS: 16 },
  total: 28, elapsedMs: 184, generatedAt: "2026-08-18T03:00:00Z", database: "supabase-postgresql",
};

const indexResponse = {
  groups: [
    { group: "EVENT_CATEGORY", label: "이벤트 카테고리", kind: "EVENT", items: [{ key: "PF", label: "PF", itemCount: 656, canonicalCount: 0 }] },
    {
      group: "MARKET_CATEGORY", classificationScheme: "MARKET_CATEGORY", label: "시장 카테고리", kind: "ALL",
      targetKinds: ["EVENT", "ASSET", "DOCUMENT", "LP_MANDATE", "SALE_PROCESS"], countSemantics: "SERVING_TARGETS",
      countWindow: { from: "2026-01-01", to: koreanIsoDate() },
      items: [
        { key: "PF", label: "PF", itemCount: 5, countsByKind: { EVENT: 0, DOCUMENT: 5 }, yearToDateCountsByKind: { DOCUMENT: 4 } },
        { key: "SALE", label: "매각", itemCount: 485, countsByKind: { EVENT: 16, DOCUMENT: 453, SALE_PROCESS: 16 }, yearToDateCountsByKind: { DOCUMENT: 400 } },
      ],
    },
    {
      group: "DOCUMENT_PURPOSE", classificationScheme: "DOCUMENT_PURPOSE", label: "근거 목적", kind: "DOCUMENT",
      targetKinds: ["DOCUMENT"], countSemantics: "SERVING_TARGETS", items: [
        { key: "TRANSACTION_EVIDENCE", label: "거래·가격 근거", itemCount: 47264, countsByKind: { DOCUMENT: 47264 } },
        { key: "CORPORATE_EVIDENCE", label: "기업·사업 근거", itemCount: 40, countsByKind: { DOCUMENT: 40 } },
        { key: "MARKET_EVIDENCE", label: "시장동향 근거", itemCount: 10329, countsByKind: { DOCUMENT: 10329 } },
        { key: "PROCESS_EVIDENCE", label: "절차·공고 근거", itemCount: 16, countsByKind: { DOCUMENT: 16 } },
      ],
    },
    { group: "DOCUMENT_TYPE", label: "근거 목적", kind: "DOCUMENT", items: [
      { key: "TRANSACTION_EVIDENCE", label: "거래·가격 근거", itemCount: 47264 },
      { key: "CORPORATE_EVIDENCE", label: "기업·사업 근거", itemCount: 40 },
      { key: "MARKET_EVIDENCE", label: "시장동향 근거", itemCount: 10329 },
      { key: "PROCESS_EVIDENCE", label: "절차·공고 근거", itemCount: 16 },
    ] },
  ],
  generatedAt: "2026-08-18T03:00:00Z", elapsedMs: 12, database: "supabase-postgresql",
};

const detailResponse = { kind: "EVENT", id: "evt-1", title: "용인 데이터센터 본PF 약정", subtitle: "PF · MAIN_PF_COMMITTED", status: "ACTIVE", overview: [{ label: "검증 수준", value: "VERIFIED" }], assets: [], events: [], organizations: [], documents: [] };

const dailyResponse = {
  selectedDate: "2026-08-19",
  latestAvailableDate: "2026-08-19",
  lastCollectedAt: "2026-08-19T07:30:00Z",
  generatedAt: "2026-08-19T08:00:00Z",
  total: 1,
  articles: [{
    id: "doc-news-1",
    title: "서울 오피스 거래시장 회복 신호",
    publisher: "테스트경제",
    publishedAt: "2026-08-19T01:20:00Z",
    collectedAt: "2026-08-19T07:30:00Z",
    summary: "서울 오피스 거래시장 관련 기사 요약",
    summaryMode: "BODY_EXTRACTIVE",
    summaryGeneratedAt: "2026-08-19T07:31:00Z",
    href: "https://example.com/news-1",
  }],
};

const documentResponse = {
  ...response,
  request: { ...response.request, kind: "DOCUMENT", category: "MARKET_EVIDENCE" },
  results: [{
    kind: "DOCUMENT", id: "doc-news-1", title: "서울 오피스 거래시장 회복 신호",
    subtitle: "테스트경제 · RSS_ITEM", summary: "시장 동향 요약", date: "2026-08-19",
    status: "ACCESSIBLE", confidence: null, source: "테스트경제", href: "https://example.com/news-1",
    category: "RSS_ITEM", categoryLabel: "RSS_ITEM", metadata: { documentType: "RSS_ITEM" },
  }],
  total: 1,
};

const investigationResponse = {
  ...documentResponse,
  request: {
    ...documentResponse.request,
    kind: "DOCUMENT",
    category: "PF",
    classificationScheme: "MARKET_CATEGORY",
    from: "2026-01-01",
    to: koreanIsoDate(),
  },
  results: [{
    ...documentResponse.results[0],
    id: "doc-pf-2026",
    title: "2026년 PF 조사 문서",
    date: "2026-08-24",
    category: "PF",
    categoryLabel: "PF",
  }],
};

afterEach(() => vi.restoreAllMocks());

describe("MarketExplorer", () => {
  it("keeps category navigation separate from filters and opens an inspection drawer", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/index") ? indexResponse : url.startsWith("/api/articles/daily") ? dailyResponse : url.startsWith("/api/entities") ? detailResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    expect(await screen.findByRole("heading", { name: "시장 변화부터 근거까지 한 흐름으로 탐색" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "업무 화면" })).toHaveTextContent("무엇을 할까요?");
    expect(screen.getByRole("complementary")).toHaveTextContent("탐색 기준");
    expect(screen.getByRole("region", { name: "조회 조건" })).toHaveTextContent("조회 조건");
    expect(screen.queryByText("DOCUMENT TYPES")).not.toBeInTheDocument();
    expect(screen.getByText("검색어나 분류 조건을 선택해 주세요.")).toBeInTheDocument();
    const pfButton = await screen.findByRole("button", { name: /PF.*0/ });
    expect(pfButton).toBeDisabled();
    expect(screen.queryByRole("button", { name: /PF.*656/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /매각.*16/ })).toBeEnabled();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/search"))).toHaveLength(0);

    const input = screen.getByRole("textbox", { name: "통합 검색" });
    await user.type(input, "데이터센터");
    await user.click(screen.getByRole("button", { name: "검색" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("q=%EB%8D%B0%EC%9D%B4%ED%84%B0%EC%84%BC%ED%84%B0"), expect.anything()));
    expect(await screen.findByText("용인 데이터센터 본PF 약정")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/search"))).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /매각.*16/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("category=SALE"), expect.anything()));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("classificationScheme=MARKET_CATEGORY"), expect.anything());

    await user.click(screen.getByRole("button", { name: /용인 데이터센터 본PF 약정/ }));
    expect(await screen.findByRole("dialog", { name: "이벤트 상세" })).toBeInTheDocument();
    expect(await screen.findByText("VERIFIED")).toBeInTheDocument();
  });

  it("loads unfiltered results only after the user chooses all", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const payload = String(input).startsWith("/api/index") ? indexResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    await screen.findByRole("button", { name: /PF.*0/ });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/search"))).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /전체 보기/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("kind=EVENT"), expect.anything()));
    expect(await screen.findByText("28건")).toBeInTheDocument();
  });

  it("switches market change to 2026 YTD investigation evidence with document-scoped counts", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/index") ? indexResponse : investigationResponse;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    expect(await screen.findByRole("button", { name: /PF.*0/ })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /조사 근거/ }));

    const pfEvidenceButton = await screen.findByRole("button", { name: /PF.*4/ });
    expect(pfEvidenceButton).toBeEnabled();
    expect(screen.getByText("2026 YTD 조회 가능 문서 수")).toBeInTheDocument();
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("종료일")).toHaveValue(koreanIsoDate());
    expect(screen.getByRole("button", { name: "2026 YTD" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/index"))).toHaveLength(2));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "https://example.test").searchParams.get("kind") === "DOCUMENT")).toBe(false);

    await user.click(pfEvidenceButton);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "https://example.test");
      return url.pathname === "/api/search" &&
        url.searchParams.get("kind") === "DOCUMENT" &&
        url.searchParams.get("category") === "PF" &&
        url.searchParams.get("classificationScheme") === "MARKET_CATEGORY" &&
        url.searchParams.get("from") === "2026-01-01" &&
        url.searchParams.get("to") === koreanIsoDate();
    })).toBe(true));
    expect(await screen.findByText("2026년 PF 조사 문서")).toBeInTheDocument();
    expect(screen.getByText("검토 전 근거")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "통합 검색" }), "추가 조건");
    await user.click(screen.getByRole("button", { name: "조건 초기화" }));
    expect(within(screen.getByRole("group", { name: "시장 변화 결과 유형" })).getByRole("button", { name: /확정 이벤트/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "통합 검색" })).toHaveValue("");
    expect(screen.getByLabelText("시작일")).toHaveValue("");
    expect(screen.getByLabelText("종료일")).toHaveValue("");
    expect(await screen.findByRole("button", { name: /PF.*0/ })).toBeDisabled();
  });

  it("blocks an inverted date range before issuing the invalid request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const payload = String(input).startsWith("/api/index") ? indexResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    await screen.findByRole("button", { name: /PF.*0/ });
    await user.click(screen.getByRole("button", { name: /전체 보기/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/search"))).toBe(true));

    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-12-31" } });
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-01-01" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("시작일은 종료일보다 늦을 수 없습니다");
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "https://example.test");
      return url.pathname === "/api/search" &&
        url.searchParams.get("from") === "2026-12-31" &&
        url.searchParams.get("to") === "2026-01-01";
    })).toBe(false));
  });

  it("groups documents by evidence purpose instead of exposing source-format codes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/index") ? indexResponse : url.includes("kind=DOCUMENT") ? documentResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    await user.click(screen.getByRole("button", { name: /근거자료/ }));

    expect(await screen.findByRole("button", { name: /거래·가격 근거/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /기업·사업 근거/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /시장동향 근거/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /절차·공고 근거/ })).toBeInTheDocument();
    expect(screen.queryByText("RSS_ITEM")).not.toBeInTheDocument();
    expect(screen.queryByText("API_RECORD")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /시장동향 근거/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("category=MARKET_EVIDENCE"), expect.anything()));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("classificationScheme=DOCUMENT_PURPOSE"), expect.anything());
    expect(await screen.findByText("서울 오피스 거래시장 회복 신호")).toBeInTheDocument();
    expect(screen.getAllByText("시장기사·RSS").length).toBeGreaterThan(0);
    expect(screen.queryByText("RSS_ITEM")).not.toBeInTheDocument();
  });

  it("opens archived compact metadata without requesting retired live detail", async () => {
    const user = userEvent.setup();
    const archivedResponse = {
      ...documentResponse,
      results: [{
        ...documentResponse.results[0],
        id: "doc-archived-1",
        status: "ARCHIVED_LOCAL",
        metadata: {
          archived: true,
          originalStatus: "CRE_CONFIRMED",
          archiveLocator: "sqlite://archive-abc#table=source_documents&pk=doc-archived-1",
          archiveSnapshotSha256: "a".repeat(64),
        },
      }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/index") ? indexResponse : url.includes("kind=DOCUMENT") ? archivedResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    await user.click(screen.getByRole("button", { name: /근거자료/ }));
    await user.click(await screen.findByRole("button", { name: /시장동향 근거/ }));
    await user.click(await screen.findByRole("button", { name: /서울 오피스 거래시장 회복 신호/ }));

    expect(await screen.findByRole("dialog", { name: "로컬 보관 상세" })).toHaveTextContent("CRE_CONFIRMED");
    expect(screen.getByRole("dialog", { name: "로컬 보관 상세" })).toHaveTextContent("archive-abc");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/documents/"))).toBe(false);
  });

  it("opens a separate daily article workspace with publication and collection freshness", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const payload = url.startsWith("/api/articles/daily") ? dailyResponse : url.startsWith("/api/index") ? indexResponse : response;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<MarketExplorer />);
    await user.click(screen.getByRole("button", { name: /시장 탐색/ }));
    await user.click(screen.getByRole("button", { name: /뉴스 모니터/ }));

    expect(await screen.findByRole("heading", { name: "매일 확인하는 부동산 시장기사" })).toBeInTheDocument();
    expect(await screen.findByText("서울 오피스 거래시장 회복 신호")).toBeInTheDocument();
    expect(screen.getByText("최근 수집").parentElement).toHaveTextContent("2026");
    expect(screen.getByText("테스트경제")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/articles/daily?date="), expect.anything()));
  });
});
