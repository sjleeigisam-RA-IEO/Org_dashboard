"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeQuantitativeMarketPulse, type QuantitativeMarketPulse as Pulse } from "@/lib/quantitative-market-pulse-contract";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const signedPct = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const oneDecimal = (value: number) => (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);
const krw = (value: number | null) => value === null ? "—" : value >= 1_000_000_000_000 ? `${(value / 1_000_000_000_000).toFixed(2)}조원` : `${Math.round(value / 100_000_000).toLocaleString("ko-KR")}억원`;
const area = (value: number | null) => value === null ? "—" : value >= 10_000 ? `${(value / 10_000).toFixed(1)}만㎡` : `${number.format(value)}㎡`;

function TrendChart({ pulse }: { pulse: Pulse }) {
  const points = pulse.trend;
  const values = points.map((point) => Number(point.amountKrw));
  const max = Math.max(...values, 1);
  const polyline = values.map((value, index) => `${points.length === 1 ? 0 : index * 600 / (points.length - 1)},${150 - value / max * 130}`).join(" ");
  return <div className="market-pulse-trend">
    <header><div><p className="eyebrow">{points.length}-MONTH TREND</p><h3>서울 대형 비주거 거래 추이</h3></div><span>금액 · canonical payload 행 기준</span></header>
    <svg viewBox="0 0 600 160" role="img" aria-label={`${points[0]?.period}부터 ${points.at(-1)?.period}까지 월별 거래금액 추이`}>
      <line x1="0" y1="150" x2="600" y2="150"/><polyline points={polyline}/>
    </svg>
    <div className="market-pulse-periods"><span>{points[0]?.period}</span><span>{points.at(-1)?.period}</span></div>
    <div className="market-pulse-table-wrap"><table><caption>최근 월별 거래금액·건수·면적</caption><thead><tr><th>월</th><th>거래금액</th><th>거래</th><th>면적</th></tr></thead><tbody>{points.slice(-6).reverse().map((point) => <tr key={point.period}><th>{point.period}</th><td>{krw(Number(point.amountKrw))}</td><td>{point.transactionCount}건</td><td>{area(Number(point.areaM2))}</td></tr>)}</tbody></table></div>
  </div>;
}

function Comparison({ mom, yoy }: { mom: number | null; yoy: number | null }) {
  return <div className="market-pulse-comparison"><span className={mom === null ? "neutral" : mom < 0 ? "down" : "up"}>전월 {signedPct(mom)}</span><span className={yoy === null ? "neutral" : yoy < 0 ? "down" : "up"}>전년 {signedPct(yoy)}</span></div>;
}

export function QuantitativeMarketPulse() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/market/pulse", { signal: controller.signal, credentials: "same-origin" });
        if (!response.ok) throw new Error("request failed");
        const data = normalizeQuantitativeMarketPulse(await response.json());
        if (!controller.signal.aborted) setPulse(data);
      } catch (reason) {
        if (!controller.signal.aborted && !(reason instanceof DOMException && reason.name === "AbortError")) setError(true);
      }
    })();
    return () => controller.abort();
  }, []);

  const topThreeShare = useMemo(() => pulse?.concentration.topGroups.slice(0, 3).reduce((sum, item) => sum + item.sharePct, 0) ?? 0, [pulse]);
  if (error) return <section className="quantitative-market-pulse error" role="alert"><b>시장 수치를 불러오지 못했습니다.</b><span>기사·신호 브리핑은 아래에서 계속 확인할 수 있습니다.</span></section>;
  if (!pulse) return <section className="quantitative-market-pulse loading" role="status">서울 CRE 시장 수치를 계산하는 중입니다.</section>;

  const { amount, count, area: areaMetric, averageTicket, unitAmount } = pulse.metrics;
  return <section className="quantitative-market-pulse" aria-labelledby="market-pulse-title">
    <header className="market-pulse-call">
      <div><p className="eyebrow">SEOUL CRE MARKET PULSE · {pulse.asOfPeriod}</p><h2 id="market-pulse-title">{pulse.call.headline}</h2><p>{pulse.call.detail}</p></div>
      <div className="market-pulse-call-stat"><span>상위 3개 거래 비중</span><strong>{count.value === 0 ? "—" : `${oneDecimal(topThreeShare)}%`}</strong><small>{count.value === 0 ? "기준월 거래 없음" : "집중도 확인 후 시장 확산 판단"}</small></div>
    </header>

    <div className="market-pulse-metrics">
      <article className="primary"><span>거래금액</span><strong>{krw(amount.value)}</strong><Comparison mom={amount.momPct} yoy={amount.yoyPct}/><small>YTD {krw(amount.ytdValue)} · {signedPct(amount.ytdYoyPct)}</small></article>
      <article><span>거래건수</span><strong>{number.format(count.value)}건</strong><Comparison mom={count.momPct} yoy={count.yoyPct}/><small>YTD {number.format(count.ytdValue)}건 · {signedPct(count.ytdYoyPct)}</small></article>
      <article><span>거래면적</span><strong>{area(areaMetric.value)}</strong><Comparison mom={areaMetric.momPct} yoy={areaMetric.yoyPct}/><small>YTD {area(areaMetric.ytdValue)} · {signedPct(areaMetric.ytdYoyPct)}</small></article>
      <article><span>거래당 평균</span><strong>{krw(averageTicket.value)}</strong><Comparison mom={averageTicket.momPct} yoy={averageTicket.yoyPct}/><small>면적당 {unitAmount.value === null ? "—" : `${Math.round(unitAmount.value / 10_000).toLocaleString("ko-KR")}만원/㎡`} · 전월 {signedPct(unitAmount.momPct)}</small></article>
    </div>

    <div className="market-pulse-grid">
      <TrendChart pulse={pulse}/>
      <div className="market-pulse-drivers">
        <section><header><p className="eyebrow">WHAT DROVE IT</p><h3>금액 기여 권역</h3></header>{pulse.concentration.districts.length === 0 ? <p>기준월 거래 없음</p> : <ol>{pulse.concentration.districts.slice(0, 5).map((item) => <li key={item.district}><p>{item.district} · {oneDecimal(item.sharePct)}% · {krw(Number(item.amountKrw))}</p><span style={{ width: `${item.sharePct}%` }}/></li>)}</ol>}</section>
        <section><header><p className="eyebrow">TOP TRANSACTIONS</p><h3>상위 canonical 거래</h3></header>{pulse.concentration.topGroups.length === 0 ? <p>기준월 거래 없음</p> : <ol>{pulse.concentration.topGroups.map((item) => <li key={`${item.rank}-${item.dealDate}-${item.district}`}><p>{item.rank}. {item.district} {item.locality} · {krw(Number(item.amountKrw))} · {item.sharePct.toFixed(1)}%</p><small>{item.dealDate} · {item.buildingUse} · {area(Number(item.areaM2))}</small></li>)}</ol>}</section>
      </div>
    </div>

    <footer className="market-pulse-method">
      <div><b>분석 모집단</b><span>{pulse.scope.geography} · {pulse.scope.population} · {pulse.scope.areaRule}</span><small>{pulse.scope.source} · {pulse.scope.amountBasis}</small></div>
      <div><b>중복·품질</b><span>원천 {pulse.quality.sourceRowCount}행 · 보수적 거래 {pulse.quality.transactionCount}건 · 동일 payload {pulse.quality.exactDuplicateRows}행 제외</span><small>제외: {pulse.scope.exclusions.join(" · ")}</small></div>
      <p>{pulse.call.caution}</p>
    </footer>
  </section>;
}
