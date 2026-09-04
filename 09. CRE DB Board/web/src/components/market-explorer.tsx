"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArchivedDetailDrawer } from "@/components/archived-detail-drawer";
import { CompanyWorkspace } from "@/components/company-workspace";
import { DailyArticleWorkspace } from "@/components/daily-article-workspace";
import { DecisionBriefWorkspace } from "@/components/decision-brief-workspace";
import { MacroTimeseriesWorkspace } from "@/components/macro-timeseries-workspace";
import { DocumentDetailDrawer } from "@/components/document-detail-drawer";
import { EntityDetailDrawer } from "@/components/entity-detail-drawer";
import { InstitutionalCapitalWorkspace } from "@/components/institutional-capital-workspace";
import { OperationsInsightsWorkspace } from "@/components/operations-insights-workspace";
import { SaleProcessWorkspace } from "@/components/sale-process-workspace";
import { TransactionCard } from "@/components/transaction-template";
import { hasInvalidSearchDateRange, koreanIsoDate, type CategoryIndexGroup, type CategoryIndexItem, type CategoryIndexResponse, type SearchKind, type SearchResponse, type SearchResult } from "@/lib/search-contract";

type Workspace = "MACRO" | "BRIEF" | "MARKET" | "DAILY" | "COMPANIES" | "CAPITAL" | "SALES" | "OPERATIONS";
type MarketKind = Extract<SearchKind, "EVENT" | "DOCUMENT" | "ASSET">;
type EventViewMode = "CONFIRMED" | "EVIDENCE";


const workspaceTabs: Array<{ key: Workspace; label: string; description: string }> = [
  { key: "MACRO", label: "시장 시계열", description: "금리 방향·공통 월" },
  { key: "BRIEF", label: "오늘의 브리핑", description: "변화·우선순위·근거" },
  { key: "MARKET", label: "시장 탐색", description: "변화·자산·근거 확인" },
  { key: "DAILY", label: "뉴스 모니터", description: "오늘의 시장 신호" },
  { key: "COMPANIES", label: "기업·임차", description: "기업과 점유 관계" },
  { key: "CAPITAL", label: "기관자금", description: "모집·선정·집행" },
  { key: "SALES", label: "매각 파이프라인", description: "입찰부터 종결까지" },
  { key: "OPERATIONS", label: "운영·인사이트", description: "수집 품질과 변화 추이" },
];

const marketKinds: Array<{ key: MarketKind; label: string; description: string }> = [
  { key: "EVENT", label: "시장 변화", description: "매각·임대·공급·인허가·PF·대출·투자" },
  { key: "ASSET", label: "관련 자산", description: "시장 변화가 발생한 물건과 위치" },
  { key: "DOCUMENT", label: "근거자료", description: "판단에 필요한 거래·공시·기사·공고" },
];

const eventViewModes: Array<{ key: EventViewMode; label: string; description: string }> = [
  { key: "CONFIRMED", label: "확정 이벤트", description: "정규화된 변화" },
  { key: "EVIDENCE", label: "조사 근거", description: "분류된 문서" },
];

const evidenceDescriptions: Record<string, string> = {
  TRANSACTION_EVIDENCE: "실거래 가격과 면적 확인",
  CORPORATE_EVIDENCE: "기업 공시와 사업 발표 확인",
  MARKET_EVIDENCE: "뉴스·분석·리서치로 흐름 확인",
  PROCESS_EVIDENCE: "입찰과 기관 절차 확인",
};

const documentLabels: Record<string, string> = {
  API_RECORD: "공식 실거래 원자료", DISCLOSURE: "기업공시", OFFICIAL_FILING: "기업공시",
  RSS_ITEM: "시장기사·RSS", ARTICLE: "분석기사", PRESS_RELEASE: "보도자료",
  BID_NOTICE: "입찰공고", NOTICE: "기관공고", RESEARCH_REPORT: "리서치 보고서",
};

const preferredClassificationGroup: Record<MarketKind, string> = {
  EVENT: "MARKET_CATEGORY",
  ASSET: "ASSET_CLASS",
  DOCUMENT: "DOCUMENT_PURPOSE",
};

function itemLabel(item: CategoryIndexItem, kind: MarketKind) {
  return kind === "DOCUMENT" ? documentLabels[item.key] ?? item.label : item.label;
}

function groupSupportsKind(group: CategoryIndexGroup, kind: MarketKind) {
  if (Array.isArray(group.targetKinds)) return group.targetKinds.includes(kind);
  return group.kind === kind || group.kind === "ALL";
}

function searchableItemCount(
  item: CategoryIndexItem,
  kind: MarketKind,
  group: CategoryIndexGroup | null,
  useYearToDateWindow = false,
) {
  const yearToDateCount = item.yearToDateCountsByKind?.[kind];
  if (useYearToDateWindow && typeof yearToDateCount === "number") return yearToDateCount;
  const scopedCount = item.countsByKind?.[kind];
  if (typeof scopedCount === "number") return scopedCount;
  if (group?.classificationScheme) return 0;
  if (kind === "EVENT" && typeof item.canonicalCount === "number") return item.canonicalCount;
  return item.itemCount;
}

function formatDate(value: string | null) { return value ? value.slice(0, 10) : "날짜 미상"; }
function metadataText(value: unknown) { return typeof value === "string" ? value : ""; }

export function MarketExplorer() {
  const [workspace, setWorkspace] = useState<Workspace>("MACRO");
  const [companyTarget, setCompanyTarget] = useState<string | null>(null);
  const [kind, setKind] = useState<MarketKind>("EVENT");
  const [eventViewMode, setEventViewMode] = useState<EventViewMode>("CONFIRMED");
  const [category, setCategory] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [q, setQ] = useState("");
  const [browseAll, setBrowseAll] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeTransactionsUnder1000Eok, setIncludeTransactionsUnder1000Eok] = useState(false);
  const [index, setIndex] = useState<CategoryIndexResponse | null>(null);
  const [indexRefreshKey, setIndexRefreshKey] = useState(0);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [selected, setSelected] = useState<SearchResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/index", { signal: controller.signal, cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error("Category index unavailable"); return response.json() as Promise<CategoryIndexResponse>; })
      .then(setIndex).catch(() => undefined);
    return () => controller.abort();
  }, [indexRefreshKey]);

  const queryKind: MarketKind = kind === "EVENT" && eventViewMode === "EVIDENCE" ? "DOCUMENT" : kind;
  const investigationEvidence = kind === "EVENT" && eventViewMode === "EVIDENCE";
  const todayInKorea = koreanIsoDate();

  const activeGroup = useMemo(() => {
    const applicableGroups = index?.groups?.filter((group) => groupSupportsKind(group, queryKind)) ?? [];
    const preferredGroup = preferredClassificationGroup[kind];
    const preferred = applicableGroups.find((group) => group.classificationScheme === preferredGroup || group.group === preferredGroup);
    const legacy = applicableGroups.find((group) => !group.classificationScheme && group.kind === kind);
    if (preferred?.items.some((item) => searchableItemCount(item, queryKind, preferred) > 0)) return preferred;
    return legacy ?? preferred ?? null;
  }, [index, kind, queryKind]);
  const useYearToDateCounts = investigationEvidence
    && activeGroup?.countWindow?.from === from
    && activeGroup?.countWindow?.to === to;
  const taxonomyScheme = category && activeGroup
    ? activeGroup.classificationScheme ?? (["MARKET_CATEGORY", "DOCUMENT_PURPOSE", "ASSET_CLASS"].includes(activeGroup.group) ? activeGroup.group : "")
    : "";
  // The search API cannot express "any term in this scheme". Investigation
  // evidence therefore requires a MARKET_CATEGORY term before DOCUMENT rows
  // can be presented under that label.
  const hasSearchCriteria = investigationEvidence
    ? Boolean(category)
    : Boolean(browseAll || q || category || from || to || includeTransactionsUnder1000Eok);
  const invalidDateRange = hasInvalidSearchDateRange(from, to);

  useEffect(() => {
    if (!hasSearchCriteria || invalidDateRange) {
      queueMicrotask(() => {
        setData(null);
        setLoading(false);
        setError(false);
      });
      return;
    }
    if (workspace !== "MARKET") return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q, kind: queryKind, from, to, category, classificationScheme: taxonomyScheme, page: "1", pageSize: "50", includeTransactionsUnder1000Eok: String(includeTransactionsUnder1000Eok) });
    queueMicrotask(() => { setLoading(true); setError(false); });
    fetch(`/api/search?${params}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json() as Promise<SearchResponse>; })
      .then(setData).catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspace, q, queryKind, from, to, category, taxonomyScheme, includeTransactionsUnder1000Eok, retryKey, hasSearchCriteria, invalidDateRange]);


  const categoryItems = activeGroup?.items ?? [];
  const selectedCategoryLabel = category ? itemLabel(categoryItems.find((item) => item.key === category) ?? { key: category, label: category, itemCount: 0 }, kind) : marketKinds.find((item) => item.key === kind)?.label;
  const categoryPrompt = kind === "EVENT" ? "변화 유형" : kind === "ASSET" ? "자산 유형" : "근거 목적";
  const resultModeLabel = investigationEvidence ? "조사 근거" : kind === "EVENT" ? "확정 이벤트" : marketKinds.find((item) => item.key === kind)?.label;

  function submitSearch(event: FormEvent) { event.preventDefault(); setBrowseAll(false); setQ(draftQ.trim()); }
  function selectEventViewMode(nextMode: EventViewMode) {
    if (nextMode === eventViewMode) return;
    setEventViewMode(nextMode);
    setBrowseAll(false);
    setData(null);
    setError(false);
    if (nextMode === "EVIDENCE" && !from && !to) {
      setFrom("2026-01-01");
      setTo(todayInKorea);
    }
    setIndexRefreshKey((value) => value + 1);
  }
  function apply2026Ytd() {
    setFrom("2026-01-01");
    setTo(todayInKorea);
  }
  function resetSearch() {
    setDraftQ("");
    setQ("");
    setCategory("");
    setBrowseAll(false);
    setFrom("");
    setTo("");
    setIncludeTransactionsUnder1000Eok(false);
    setEventViewMode("CONFIRMED");
    setData(null);
    setError(false);
  }
  function openResult(item: SearchResult) {
    if (item.kind === "ORGANIZATION") { setCompanyTarget(item.id); setWorkspace("COMPANIES"); return; }
    setSelected(item);
  }
  function openDocument(documentId: string, title: string) {
    setSelected({ kind: "DOCUMENT", id: documentId, title, subtitle: null, summary: null, date: null, status: null, confidence: null, source: null, href: null, category: "MARKET_EVIDENCE", categoryLabel: "시장 근거", metadata: { documentType: "ARTICLE" } });
  }

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">CRE</span><div><strong>CRE DB</strong><small>Commercial Real Estate Intelligence</small></div></div><div className="topbar-meta"><span className="live-dot"/>Supabase serving · evidence linked</div></header>
    <nav className="workspace-nav" aria-label="업무 화면">
      <div className="workspace-nav-context"><span>업무 화면</span><strong>무엇을 할까요?</strong></div>
      {workspaceTabs.map((tab) => <button type="button" key={tab.key} aria-pressed={workspace === tab.key} onClick={() => { setWorkspace(tab.key); if (tab.key !== "COMPANIES") setCompanyTarget(null); }}><strong>{tab.label}</strong><span>{tab.description}</span></button>)}
    </nav>

    {workspace === "MACRO" && <MacroTimeseriesWorkspace/>}
    {workspace === "BRIEF" && <DecisionBriefWorkspace onNavigate={setWorkspace} onOpenDocument={openDocument}/>}
    {workspace === "MARKET" && <section className="market-workspace">
      <header className="market-hero"><div><p className="eyebrow">MARKET EXPLORE</p><h1>시장 변화부터 근거까지 한 흐름으로 탐색</h1><p>먼저 찾을 대상을 고르고, 변화 유형·자산 유형·근거 목적과 기간으로 범위를 좁혀 확인합니다.</p></div><form className="hero-search" onSubmit={submitSearch}><input aria-label="통합 검색" value={draftQ} onChange={(event) => setDraftQ(event.target.value)} placeholder="회사·자산·이벤트·근거자료 검색"/><button type="submit">검색</button></form></header>
      <div className="explore-layout">
        <aside className="category-rail">
          <div className="rail-heading"><div><p className="eyebrow">탐색 기준</p><h2>무엇을 찾을까요?</h2><p>현재 업무 안에서 조회 대상을 정합니다.</p></div></div>
          <nav className="domain-nav" aria-label="탐색 대상">{marketKinds.map((item) => <button key={item.key} type="button" aria-pressed={kind === item.key} onClick={() => { setKind(item.key); setCategory(""); setBrowseAll(false); setEventViewMode("CONFIRMED"); }}><strong>{item.label}</strong><span>{item.description}</span></button>)}</nav>
          {kind === "EVENT" && <div className="event-view-switch" role="group" aria-label="시장 변화 결과 유형">{eventViewModes.map((mode) => <button type="button" key={mode.key} aria-pressed={eventViewMode === mode.key} onClick={() => selectEventViewMode(mode.key)}><strong>{mode.label}</strong><span>{mode.description}</span></button>)}</div>}
          <div className="category-section-title"><span>{categoryPrompt}</span><small>{investigationEvidence && useYearToDateCounts ? "2026 YTD 조회 가능 문서 수" : kind === "DOCUMENT" ? "활용 목적별 조회 가능 건수" : "숫자는 바로 조회 가능한 결과 건수입니다"}</small></div>
          <div className="category-list"><button type="button" aria-pressed={!investigationEvidence && browseAll && !category} disabled={investigationEvidence} onClick={() => { setCategory(""); setBrowseAll(true); }}><span><strong>전체 보기</strong><small>{investigationEvidence ? "변화 유형을 선택해 조사 근거를 조회합니다" : `${resultModeLabel} 전체를 조회합니다`}</small></span></button>{categoryItems.map((item) => { const count = searchableItemCount(item, queryKind, activeGroup, useYearToDateCounts); return <button type="button" key={item.key} aria-pressed={category === item.key} disabled={count === 0} onClick={() => { setCategory(item.key); setBrowseAll(false); }}><span><strong>{itemLabel(item, kind)}</strong>{kind === "DOCUMENT" && <small>{evidenceDescriptions[item.key]}</small>}</span><b>{count.toLocaleString("ko-KR")}</b></button>; })}</div>
        </aside>
        <section className="market-content">
          <section className="detail-filters market-filter-panel" aria-label="조회 조건">
            <div className="market-filter-heading">
              <p className="eyebrow">조회 조건</p>
              <div><h2>언제, 어느 범위까지 볼까요?</h2>{investigationEvidence && <button type="button" className="quick-range-chip" aria-pressed={from === "2026-01-01" && to === todayInKorea} onClick={apply2026Ytd}>2026 YTD</button>}</div>
              <small>{queryKind === "EVENT" ? "이벤트 발생일" : queryKind === "DOCUMENT" ? "문서 발행일 · 없으면 수집일" : "정보 갱신일"} 기준</small>
            </div>
            <label>시작일<input type="date" value={from} aria-invalid={invalidDateRange} aria-describedby={invalidDateRange ? "market-date-range-error" : undefined} onChange={(event) => setFrom(event.target.value)}/></label>
            <label>종료일<input type="date" value={to} aria-invalid={invalidDateRange} aria-describedby={invalidDateRange ? "market-date-range-error" : undefined} onChange={(event) => setTo(event.target.value)}/></label>
            {kind === "DOCUMENT" && (!category || category === "TRANSACTION_EVIDENCE") && <label className="toggle-filter"><input type="checkbox" checked={includeTransactionsUnder1000Eok} onChange={(event) => setIncludeTransactionsUnder1000Eok(event.target.checked)}/><span><strong>1,000억원 미만 실거래 포함</strong><small>거래·가격 근거에만 적용</small></span></label>}
            <button type="button" className="reset-button" onClick={resetSearch}>조건 초기화</button>
            {invalidDateRange && <p className="filter-error" id="market-date-range-error" role="alert">시작일은 종료일보다 늦을 수 없습니다. 날짜를 다시 선택해 주세요.</p>}
          </section>
          <header className="results-heading"><div><p className="result-path">시장 탐색 <span>/</span> {marketKinds.find((item) => item.key === kind)?.label}{kind === "EVENT" && <> <span>/</span> {resultModeLabel}</>}{category && <> <span>/</span> {selectedCategoryLabel}</>}</p><h2>{selectedCategoryLabel}</h2><p>{investigationEvidence ? "검토 전 근거 · " : ""}{q ? `“${q}” · ` : ""}{from || to ? `${from || "최초"}~${to || "현재"}` : "전체 기간"}</p></div><strong>{data ? `${data.total.toLocaleString("ko-KR")}건` : "—"}</strong></header>
          {!hasSearchCriteria && <div className="state-block"><strong>{investigationEvidence ? "변화 유형을 선택해 주세요." : "검색어나 분류 조건을 선택해 주세요."}</strong><p>{investigationEvidence ? "선택한 유형에 연결된 2026년 검토 전 근거만 조회합니다." : "필요한 범위만 조회해 더 빠르게 결과를 확인합니다."}</p></div>}
          {loading && <div className="state-block"><span className="spinner"/><strong>{selectedCategoryLabel} 조회 중</strong></div>}
          {!loading && error && <div className="state-block error-state"><strong>데이터를 불러오지 못했습니다.</strong><p>선택한 탐색 기준은 유지됩니다.</p><button type="button" onClick={() => setRetryKey((value) => value + 1)}>다시 조회</button></div>}
          {hasSearchCriteria && !loading && !error && data?.results.length === 0 && <div className="state-block"><strong>조건에 맞는 결과가 없습니다.</strong><p>category는 유지하고 상세 필터만 완화해 보세요.</p></div>}
          {hasSearchCriteria && !invalidDateRange && !loading && !error && <div className={`projection-list ${queryKind.toLowerCase()}-projection`}>{data?.results.map((item) => <article key={`${item.kind}-${item.id}`} className={`projection-card ${item.metadata?.documentType === "API_RECORD" ? "transaction-projection-card" : ""}`}><button type="button" onClick={() => openResult(item)}><div className="projection-meta">{investigationEvidence && item.kind === "DOCUMENT" && <span className="review-evidence-badge">검토 전 근거</span>}<span className="category-badge">{item.kind === "DOCUMENT" ? documentLabels[item.category ?? ""] ?? item.categoryLabel : item.categoryLabel}</span><time>{formatDate(item.date)}</time><span>{item.status ?? "상태 미상"}</span></div>{item.kind === "DOCUMENT" && item.metadata?.documentType === "API_RECORD" ? <TransactionCard metadata={item.metadata}/> : <><h3>{item.title}</h3>{item.summary && <p>{item.summary}</p>}</>}<div className="projection-details">{item.kind === "EVENT" && <><span>자산 {metadataText(item.metadata?.assets) || "미연결"}</span><span>참여자 {metadataText(item.metadata?.participants) || "미연결"}</span></>}{item.kind === "DOCUMENT" && item.metadata?.documentType !== "API_RECORD" && <><span>{item.source ?? "출처 미상"}</span><span>{documentLabels[String(item.metadata?.documentType ?? "")] ?? "근거자료"}</span></>}{item.kind === "ASSET" && <><span>{String(item.metadata?.assetClass ?? "자산유형 미상")}</span><span>{String(item.metadata?.region ?? item.summary ?? "지역 미상")}</span></>}</div></button>{item.kind === "DOCUMENT" && item.href && <a className="source-link" href={item.href} target="_blank" rel="noreferrer">{item.metadata?.documentType === "API_RECORD" ? "API" : "원문"}</a>}</article>)}</div>}
        </section>
      </div>
    </section>}

    {workspace === "DAILY" && <DailyArticleWorkspace onOpenArticle={openDocument}/>}
    {workspace === "COMPANIES" && <CompanyWorkspace key={companyTarget ?? "company-workspace"} initialCompanyId={companyTarget}/>}
    {workspace === "CAPITAL" && <InstitutionalCapitalWorkspace/>}
    {workspace === "SALES" && <SaleProcessWorkspace/>}
    {workspace === "OPERATIONS" && <OperationsInsightsWorkspace onOpenDocument={openDocument}/>}

    {selected?.metadata?.archived === true && <ArchivedDetailDrawer result={selected} onClose={() => setSelected(null)}/>}
    {selected?.metadata?.archived !== true && selected?.kind === "DOCUMENT" && <DocumentDetailDrawer documentId={selected.id} fallbackTitle={selected.title} onClose={() => setSelected(null)}/>}
    {selected?.metadata?.archived !== true && selected && (selected.kind === "EVENT" || selected.kind === "ASSET") && <EntityDetailDrawer kind={selected.kind} id={selected.id} fallbackTitle={selected.title} onClose={() => setSelected(null)}/>}
  </main>;
}
