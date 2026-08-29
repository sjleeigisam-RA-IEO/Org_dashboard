"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeDailyArticles, todayInSeoul, type DailyArticlesResponse } from "@/lib/daily-articles-contract";
import { normalizeInsightSignals, type InsightSignal, type InsightSignalsResponse } from "@/lib/insight-signals-contract";
import { normalizeKeywordAnalytics, type KeywordAnalyticsItem, type KeywordAnalyticsResponse } from "@/lib/keyword-analytics-contract";
import { normalizeOperationsOverview, type OperationsOverviewResponse } from "@/lib/operations-insights-contract";

export type BriefWorkspaceTarget = "MARKET" | "DAILY" | "COMPANIES" | "CAPITAL" | "SALES" | "OPERATIONS";

type Slice<T> = { data: T | null; loading: boolean; error: boolean };
type Props = {
  onNavigate: (target: BriefWorkspaceTarget) => void;
  onOpenDocument: (documentId: string, title: string) => void;
};

const emptySlice = <T,>(): Slice<T> => ({ data: null, loading: true, error: false });
const number = new Intl.NumberFormat("ko-KR");
const severityRank: Record<InsightSignal["severity"], number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function formatDateTime(value?: string | null) {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

function percent(value: number) { return `${Math.round(value * 100)}%`; }

function Sparkline({ item }: { item: KeywordAnalyticsItem }) {
  const values = item.trend.map((point) => point.documentFrequency);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${values.length === 1 ? 100 : index * 200 / (values.length - 1)},${46 - value * 40 / max}`).join(" ");
  return <svg className="brief-spark" viewBox="0 0 200 50" role="img" aria-label={`${item.term} 발행일 기준 추이`}><polyline points={points}/></svg>;
}

function SignalEvidenceDrawer({ signal, onClose, onOpenDocument, restoreFocus }: { signal: InsightSignal; onClose: () => void; onOpenDocument: Props["onOpenDocument"]; restoreFocus: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1) as HTMLElement;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); restoreFocus(); };
  }, [onClose, restoreFocus]);
  return <div className="brief-evidence-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="brief-evidence-drawer" role="dialog" aria-modal="true" aria-label={`${signal.title} 근거 ${signal.evidence.length}건`}>
      <header><div><p className="eyebrow">SIGNAL EVIDENCE</p><h2>{signal.title}</h2><p>{signal.summary}</p></div><button type="button" onClick={onClose} autoFocus>근거 닫기</button></header>
      <div className="brief-evidence-list">{signal.evidence.map((item, index) => <article key={`${item.targetKind}-${item.targetId}-${index}`}>
        <div><span>{item.role}</span><b>{item.targetKind}</b><time>{item.publishedAt?.slice(0, 10) ?? "기준일 없음"}</time></div>
        <h3>{item.title}</h3><p>{item.sourceName} · target {item.targetId}</p>
        {item.documentId ? <button type="button" onClick={() => { onClose(); onOpenDocument(item.documentId as string, item.title); }}>문서 원문 보기</button> : <small>연결된 문서가 없는 {item.targetKind} 근거입니다.</small>}
      </article>)}</div>
    </section>
  </div>;
}

function SliceState({ label, error }: { label: string; error: boolean }) {
  return <div className={`brief-slice-state${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error ? `${label} 데이터를 불러오지 못했습니다.` : `${label} 데이터를 불러오는 중입니다.`}</div>;
}

export function DecisionBriefWorkspace({ onNavigate, onOpenDocument }: Props) {
  const [daily, setDaily] = useState<Slice<DailyArticlesResponse>>(emptySlice);
  const [overview, setOverview] = useState<Slice<OperationsOverviewResponse>>(emptySlice);
  const [keywords, setKeywords] = useState<Slice<KeywordAnalyticsResponse>>(emptySlice);
  const [insights, setInsights] = useState<Slice<InsightSignalsResponse>>(emptySlice);
  const [selectedSignal, setSelectedSignal] = useState<InsightSignal | null>(null);
  const signalTriggerRef = useRef<HTMLElement | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const closeSignalEvidence = useCallback(() => setSelectedSignal(null), []);
  const restoreSignalFocus = useCallback(() => signalTriggerRef.current?.focus(), []);
  const openSignalDocument = useCallback((documentId: string, title: string) => {
    signalTriggerRef.current = null;
    setSelectedSignal(null);
    onOpenDocument(documentId, title);
  }, [onOpenDocument]);

  useEffect(() => {
    const controller = new AbortController();
    const request = async <T,>(
      url: string,
      normalize: (value: unknown) => T,
      setter: (value: Slice<T>) => void,
    ) => {
      setter({ data: null, loading: true, error: false });
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error("request failed");
        const value = normalize(await response.json());
        if (!controller.signal.aborted) setter({ data: value, loading: false, error: false });
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setter({ data: null, loading: false, error: true });
        }
      }
    };

    void request(`/api/articles/daily?date=${encodeURIComponent(todayInSeoul())}`, normalizeDailyArticles, setDaily);
    void request("/api/operations/overview", normalizeOperationsOverview, setOverview);
    void request("/api/operations/keywords?limit=50&briefing=1", normalizeKeywordAnalytics, setKeywords);
    void request("/api/operations/insights?limit=4&reviewable=1", normalizeInsightSignals, setInsights);
    return () => controller.abort();
  }, [retryKey]);

  const reviewSignals = useMemo(() => (insights.data?.signals ?? [])
    .filter((item) => item.reviewStatus === "UNREVIEWED" || item.reviewStatus === "PENDING")
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.scores.confidence - a.scores.confidence)
    .slice(0, 4), [insights.data]);
  const organicKeywords = useMemo(() => (keywords.data?.keywords ?? [])
    .filter((item) => !item.isCollectionBias)
    .sort((a, b) => b.burstScore - a.burstScore), [keywords.data]);
  const momentumKeywords = useMemo(() => organicKeywords.filter((item) => item.documentFrequency >= 2 && item.burstScore > 0), [organicKeywords]);
  const displayedKeywords = (momentumKeywords.length ? momentumKeywords : organicKeywords).slice(0, 5);
  const hasOnlyLowSampleKeywords = Boolean(keywords.data && !momentumKeywords.length && organicKeywords.length);
  const sourceWarnings = useMemo(() => (overview.data?.sources ?? []).filter((item) =>
    item.freshness === "OVERDUE" || item.freshness === "NEVER_SUCCEEDED" || item.latestExecution === "FAILED" || item.latestExecution === "PARTIAL",
  ), [overview.data]);
  const reviewCount = insights.data?.statusCounts
    .filter((item) => item.status === "UNREVIEWED" || item.status === "PENDING")
    .reduce((sum, item) => sum + item.count, 0) ?? 0;

  return <section className="decision-brief domain-workspace">
    <header className="workspace-hero brief-hero">
      <div><p className="eyebrow">CRE DECISION BRIEF</p><h1>오늘의 변화와 검토 대상을 먼저 확인</h1><p>시장 변화, 급상승 주제, 근거 품질과 적재 이상을 분리해 보고 필요한 원문과 전문 화면으로 바로 이동합니다.</p></div>
      <div className="brief-asof"><span>SLICE AS-OF · 서로 다른 기준</span><dl><div><dt>기사 최신일</dt><dd>{daily.data?.latestAvailableDate ?? "—"}</dd></div><div><dt>운영 기준</dt><dd>{formatDateTime(overview.data?.asOfAt)}</dd></div><div><dt>키워드 계산</dt><dd>{formatDateTime(keywords.data?.computedAt)}</dd></div><div><dt>신호 계산</dt><dd>{formatDateTime(insights.data?.generatedAt)}</dd></div></dl><small>한 시각으로 합성하지 않음 · Supabase serving</small></div>
    </header>

    <nav className="brief-actions" aria-label="빠른 업무 이동">
      <button type="button" onClick={() => onNavigate("MARKET")}><strong>시장 변화 찾기</strong><span>이벤트·자산·근거 탐색</span></button>
      <button type="button" onClick={() => onNavigate("DAILY")}><strong>기사 전체 보기</strong><span>게시일·수집일 분리</span></button>
      <button type="button" onClick={() => onNavigate("COMPANIES")}><strong>기업·임차 확인</strong><span>관계와 발견 신호 구분</span></button>
      <button type="button" onClick={() => onNavigate("OPERATIONS")}><strong>신호 전체 검토</strong><span>원문·품질·운영 상태</span></button>
    </nav>

    <section className="brief-kpis" aria-label="오늘의 CRE 핵심 상태">
      <article><span>최신일 기사</span><strong>{daily.data ? number.format(daily.data.total) : "—"}</strong><small>{daily.data?.latestAvailableDate ?? (daily.error ? "조회 실패" : "확인 중")}</small></article>
      <article><span>검토 대기 신호</span><strong>{insights.data ? number.format(reviewCount) : "—"}</strong><small>UNREVIEWED + PENDING</small></article>
      <article><span>상승 관찰어</span><strong>{keywords.data ? number.format(keywords.data.summary.qualifiedKeywordCount) : "—"}</strong><small>수집 query 제외 · DF 2건 이상</small></article>
      <article className={sourceWarnings.length ? "attention" : ""}><span>주의 source</span><strong>{overview.data ? number.format(sourceWarnings.length) : "—"}</strong><small>기한 초과·실패·성공 이력 없음</small></article>
    </section>

    <div className="brief-grid">
      <div className="brief-column brief-primary">
      <section className="brief-panel review-panel">
        <header><div><p className="eyebrow">REVIEW FIRST</p><h2>먼저 검토할 시장 신호</h2></div><button type="button" onClick={() => onNavigate("OPERATIONS")}>신호 전체 검토</button></header>
        {insights.loading && <SliceState label="신호" error={false}/>}
        {insights.error && <SliceState label="신호" error/>}
        {!insights.loading && !insights.error && reviewSignals.length === 0 && <p className="brief-empty">검토 대기 신호가 없습니다. 승인 신호는 운영·인사이트에서 확인할 수 있습니다.</p>}
        <div className="brief-signal-list">{reviewSignals.map((signal) => <article key={signal.signalId} className={`brief-signal severity-${signal.severity.toLowerCase()}`}>
            <div className="brief-signal-meta"><span>{signal.severity}</span><time>{signal.signalDate}</time><b>{signal.reviewStatus}</b></div>
            <h3>{signal.title}</h3><p>{signal.summary}</p>
            <dl><div><dt>강도</dt><dd>{percent(signal.scores.strength)}</dd></div><div><dt>근거</dt><dd>{percent(signal.scores.evidence)}</dd></div><div><dt>출처 다양성</dt><dd>{percent(signal.scores.sourceDiversity)}</dd></div><div><dt>복합신뢰도</dt><dd>{percent(signal.scores.confidence)}</dd></div></dl>
            <footer><span>{signal.syndicationDedupeStatus === "PARTIAL" ? "부분 중복제거" : `중복제거 ${signal.syndicationDedupeStatus}`}</span><button type="button" disabled={!signal.evidence.length} onClick={() => { signalTriggerRef.current = document.activeElement as HTMLElement; setSelectedSignal(signal); }}>근거 {signal.evidence.length}건</button></footer>
          </article>)}</div>
      </section>

      <section className="brief-panel updates-panel">
        <header><div><p className="eyebrow">LATEST EVIDENCE</p><h2>최신 시장 업데이트</h2></div><button type="button" onClick={() => onNavigate("DAILY")}>기사 전체 보기</button></header>
        {daily.loading && <SliceState label="기사" error={false}/>}
        {daily.error && <SliceState label="기사" error/>}
        <div className="brief-article-list">{daily.data?.articles.slice(0, 5).map((article) => <article key={article.id}>
          <button type="button" onClick={() => onOpenDocument(article.id, article.title)}><div><span>{article.topics?.[0]?.label ?? "미분류"}</span><time>{article.publishedAt.slice(0, 10)}</time><b>{article.evidenceGrade?.label ?? "근거등급 미지정"}</b></div><h3>{article.title}</h3><p>{article.summary ?? "공개 본문 요약이 없습니다."}</p><small>{article.publisher ?? "출처 미상"} · {article.summaryMode === "BODY_EXTRACTIVE" ? "본문 요약" : article.summaryMode === "MODEL" ? "생성 요약" : "요약 없음"}</small></button>
        </article>)}</div>
      </section>
      </div>

      <div className="brief-column brief-secondary">
      <section className="brief-panel momentum-panel">
        <header><div><p className="eyebrow">MARKET MOMENTUM</p><h2>{hasOnlyLowSampleKeywords ? "저표본 관찰어" : "급상승 주제"}</h2></div><button type="button" onClick={() => onNavigate("OPERATIONS")}>키워드 분석</button></header>
        {keywords.loading && <SliceState label="키워드" error={false}/>}
        {keywords.error && <SliceState label="키워드" error/>}
        <div className="brief-keyword-list">{displayedKeywords.map((item, index) => <article key={item.keywordId}>
          <span className="brief-rank">{index + 1}</span><div><header><strong>{item.term}</strong><b>burst {item.burstScore.toFixed(2)}</b></header><Sparkline item={item}/><footer><span>현재 DF {number.format(item.documentFrequency)}</span><span>28일 기준 {item.baselineDocumentFrequency.toFixed(1)}</span>{item.cooccurrences.slice(0, 2).map((peer) => <em key={peer.term}>{peer.term}</em>)}</footer></div>
        </article>)}</div>
        {keywords.data && <p className={`brief-lineage${hasOnlyLowSampleKeywords ? " low-sample" : ""}`}>{hasOnlyLowSampleKeywords ? "모든 후보가 문서빈도 1건으로 상승 확정에서 제외 · " : "발행일 기준 distinct document frequency · "}{keywords.data.algorithmVersion} · 발행일 미상 {number.format(keywords.data.summary.excludedMissingPublicationCount)}건 제외</p>}
      </section>

      <aside className="brief-panel trust-panel">
        <header><div><p className="eyebrow">DATA TRUST</p><h2>활용 전 확인사항</h2></div><button type="button" onClick={() => onNavigate("OPERATIONS")}>적재상태</button></header>
        {overview.loading && <SliceState label="운영" error={false}/>}
        {overview.error && <SliceState label="운영" error/>}
        {overview.data && <>
          <dl className="brief-trust-summary"><div><dt>활성 source</dt><dd>{number.format(overview.data.summary.onboardedSourceCount)} / {number.format(overview.data.summary.sourceCount)}</dd></div><div><dt>고유 문서</dt><dd>{number.format(overview.data.summary.distinctDocumentCount)}</dd></div><div><dt>분류 assignment</dt><dd>{number.format(overview.data.classificationQuality.currentAssignmentCount)}</dd></div><div><dt>Primary 공백·충돌</dt><dd>{number.format(overview.data.classificationQuality.schemes.reduce((sum, item) => sum + item.primaryMissingCount + item.primaryConflictCount, 0))}</dd></div></dl>
          <section className="brief-use-contract" aria-labelledby="brief-use-contract-title"><h3 id="brief-use-contract-title">판단 가능한 레코드의 최소 정보</h3><ul><li><b>대상</b><span>자산 · 지역 · 기업</span></li><li><b>사건</b><span>유형 · 단계 · 기준일</span></li><li><b>경제성</b><span>금액 · 단위 · 금액 basis</span></li><li><b>근거</b><span>출처 · 게시일 · 등급 · 원문</span></li></ul></section>
          <div className="brief-warning-list">{sourceWarnings.length ? sourceWarnings.slice(0, 4).map((item) => <article key={item.sourceCode}><strong>{item.sourceName}</strong><span>{item.freshness} · {item.latestExecution}</span><small>최근 성공 {formatDateTime(item.latestSuccessfulAt)}</small></article>) : <p className="brief-empty">기한 초과·실패 source가 없습니다.</p>}</div>
          <p className="brief-caveat">신호는 규칙형 분석 결과이며 투자판단이 아닙니다. 심각도, 검토상태, 근거충분성, source 다양성을 함께 확인하고 원문으로 검증합니다.</p>
        </>}
      </aside>
      </div>
    </div>

    {(daily.error || overview.error || keywords.error || insights.error) && <button className="brief-retry" type="button" onClick={() => setRetryKey((value) => value + 1)}>실패한 브리핑 데이터 다시 조회</button>}
    {selectedSignal && <SignalEvidenceDrawer signal={selectedSignal} onClose={closeSignalEvidence} onOpenDocument={openSignalDocument} restoreFocus={restoreSignalFocus}/>}
  </section>;
}
