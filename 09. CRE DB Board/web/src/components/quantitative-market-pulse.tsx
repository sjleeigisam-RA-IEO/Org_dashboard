"use client";

import { useEffect, useMemo, useState } from "react";
import { ContextTooltip } from "@/components/context-tooltip";
import { normalizeQuantitativeMarketPulse, type QuantitativeMarketPulse as Pulse } from "@/lib/quantitative-market-pulse-contract";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const compact = (value: number, maximumFractionDigits = 1) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
const signedPct = (value: number | null) => value === null ? "—" : `${value > 0 ? "↑ " : value < 0 ? "↓ " : "→ "}${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const oneDecimal = (value: number) => (Math.round((value + Number.EPSILON) * 10) / 10).toFixed(1);
const krw = (value: number | null) => value === null ? "—" : value >= 1_000_000_000_000 ? `${compact(value / 1_000_000_000_000, 2)}조 원` : `${Math.round(value / 100_000_000).toLocaleString("ko-KR")}억 원`;
const area = (value: number | null) => value === null ? "—" : value >= 10_000 ? `${compact(value / 10_000)}만㎡` : `${number.format(value)}㎡`;
const trillion = (value: number) => `${compact(value / 1_000_000_000_000, 1)}조`;
const pulseSourceUrl = (source: string) => source.includes("국토교통부") || source.includes("실거래") ? "https://rt.molit.go.kr/" : undefined;

function TrendChart({ pulse }: { pulse: Pulse }) {
  const points = pulse.trend;
  const values = points.map((point) => Number(point.amountKrw));
  const maxValue = Math.max(0, ...values);
  const plot = { left: 54, right: 590, top: 12, bottom: 146 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(4, Math.min(18, slot * 0.62));
  const y = (value: number) => maxValue === 0 ? plot.bottom : plot.bottom - value / maxValue * plotHeight;
  const recent = values.slice(-12);
  const average = recent.reduce((sum, value) => sum + value, 0) / Math.max(recent.length, 1);
  const averageY = y(average);
  const ticks = maxValue === 0 ? [0] : [maxValue, maxValue / 2, 0];
  return <div className="market-pulse-trend">
    <header><div><p className="eyebrow">최근 {points.length}개 관측월</p><h3>서울 대형 비주거 거래금액</h3></div><span>단위: 조 원 · 점선 최근 12개 관측월 평균 {trillion(average)} 원 · {pulse.asOfPeriod} 기준</span></header>
    <svg viewBox="0 0 600 176" role="img" aria-label={`${points[0]?.period}부터 ${points.at(-1)?.period}까지 월별 거래금액 막대그래프, 최근 12개 관측월 평균 ${trillion(average)}`}>
      <title>월별 거래금액과 최근 12개 관측월 평균</title>
      {ticks.map((tick) => <g key={tick}><line className="market-pulse-gridline" x1={plot.left} y1={y(tick)} x2={plot.right} y2={y(tick)}/><text className="market-pulse-axis" x={plot.left - 7} y={y(tick) + 3} textAnchor="end">{trillion(tick)}</text></g>)}
      <line className="market-pulse-average" x1={plot.left} y1={averageY} x2={plot.right} y2={averageY}/>
      {maxValue === 0 && <text className="market-pulse-empty" x={(plot.left + plot.right) / 2} y={(plot.top + plot.bottom) / 2} textAnchor="middle">관측기간 내 적격 고유 신고행 없음</text>}
      {points.map((point, index) => {
        const value = values[index];
        const x = plot.left + index * slot + (slot - barWidth) / 2;
        const height = Math.max(value === 0 ? 0 : 1.5, plot.bottom - y(value));
        return <rect key={point.period} className={index === points.length - 1 ? "market-pulse-bar latest" : "market-pulse-bar"} x={x} y={plot.bottom - height} width={barWidth} height={height}><title>{point.period} · {krw(value)} · 고유 신고행 {point.transactionCount}건</title></rect>;
      })}
      <text className="market-pulse-period-label" x={plot.left} y="169">{points[0]?.period}</text>
      <text className="market-pulse-period-label" x={plot.right} y="169" textAnchor="end">{points.at(-1)?.period}</text>
    </svg>
    <div className="market-pulse-table-wrap"><table><caption>최근 6개월 신고 거래금액·고유 신고행·면적</caption><thead><tr><th>월</th><th>신고 거래금액</th><th>고유 신고행</th><th>면적</th></tr></thead><tbody>{points.slice(-6).reverse().map((point) => <tr key={point.period}><th>{point.period}</th><td>{krw(Number(point.amountKrw))}</td><td>{point.transactionCount}건</td><td>{area(Number(point.areaM2))}</td></tr>)}</tbody></table></div>
    <details className="market-pulse-full-table"><summary>전체 {points.length}개 관측월 표</summary><div className="market-pulse-table-wrap"><table><caption>전체 관측월 신고 거래금액·고유 신고행·면적</caption><thead><tr><th>월</th><th>신고 거래금액</th><th>고유 신고행</th><th>면적</th></tr></thead><tbody>{points.slice().reverse().map((point) => <tr key={point.period}><th>{point.period}</th><td>{krw(Number(point.amountKrw))}</td><td>{point.transactionCount}건</td><td>{area(Number(point.areaM2))}</td></tr>)}</tbody></table></div></details>
  </div>;
}

function Comparison({ mom, yoy }: { mom: number | null; yoy: number | null }) {
  const className = (value: number | null) => value === null || value === 0 ? "neutral" : value < 0 ? "down" : "up";
  return <div className="market-pulse-comparison"><span className={className(mom)}>전월 대비 {signedPct(mom)}</span><span className={className(yoy)}>전년 동월 대비 {signedPct(yoy)}</span></div>;
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
      <div className="market-pulse-call-stat"><span>상위 3개 고유 신고행 비중</span><ContextTooltip label="집중도" detail={`${pulse.asOfPeriod} 신고 거래금액 합계에서 금액 상위 3개 고유 payload 행이 차지하는 비중입니다. 동일 payload 중복행은 제외합니다.`} align="end"><strong>{count.value === 0 ? "—" : `${oneDecimal(topThreeShare)}%`}</strong></ContextTooltip><small>{count.value === 0 ? "기준월 고유 신고행 없음" : "집중도 확인 후 시장 확산 판단"}</small></div>
    </header>

    <div className="market-pulse-metrics">
      <article className="primary"><span>거래금액</span><ContextTooltip label={`신고 거래금액 · ${pulse.asOfPeriod}`} detail="서울 비주거·집합건물 신고행 중 면적 기준을 통과한 고유 payload의 거래금액 합계입니다." align="start"><strong>{krw(amount.value)}</strong></ContextTooltip><Comparison mom={amount.momPct} yoy={amount.yoyPct}/><small>연초 이후 누계 {krw(amount.ytdValue)} · 전년 동기 대비 {signedPct(amount.ytdYoyPct)}</small></article>
      <article><span>고유 신고행</span><ContextTooltip label={`고유 신고행 · ${pulse.asOfPeriod}`} detail="경제적 거래 ID가 아니라 동일 payload 중복을 제외한 신고행 수입니다. 실제 거래 건수와 다를 수 있습니다." align="end"><strong>{number.format(count.value)}건</strong></ContextTooltip><Comparison mom={count.momPct} yoy={count.yoyPct}/><small>연초 이후 누계 {number.format(count.ytdValue)}건 · 전년 동기 대비 {signedPct(count.ytdYoyPct)}</small></article>
      <article><span>거래면적</span><ContextTooltip label={`거래면적 · ${pulse.asOfPeriod}`} detail="분석 모집단에 포함된 고유 신고행의 건축물 거래면적 합계입니다." align="start"><strong>{area(areaMetric.value)}</strong></ContextTooltip><Comparison mom={areaMetric.momPct} yoy={areaMetric.yoyPct}/><small>연초 이후 누계 {area(areaMetric.ytdValue)} · 전년 동기 대비 {signedPct(areaMetric.ytdYoyPct)}</small></article>
      <article><span>신고행당 평균</span><ContextTooltip label={`신고행당 평균 · ${pulse.asOfPeriod}`} detail="기준월 신고 거래금액 합계를 고유 신고행 수로 나눈 산술평균입니다. 동일자산 가격지수가 아닙니다." align="end"><strong>{krw(averageTicket.value)}</strong></ContextTooltip><Comparison mom={averageTicket.momPct} yoy={averageTicket.yoyPct}/><small>면적당 {unitAmount.value === null ? "—" : `${Math.round(unitAmount.value / 10_000).toLocaleString("ko-KR")}만 원/㎡`} · 전월 대비 {signedPct(unitAmount.momPct)}</small></article>
    </div>

    <div className="market-pulse-grid">
      <TrendChart pulse={pulse}/>
      <div className="market-pulse-drivers">
        <section><header><p className="eyebrow">WHAT DROVE IT</p><h3>금액 기여 권역</h3></header>{pulse.concentration.districts.length === 0 ? <p>기준월 고유 신고행 없음</p> : <ol>{pulse.concentration.districts.slice(0, 5).map((item) => <li key={item.district}><p>{item.district} · {oneDecimal(item.sharePct)}% · {krw(Number(item.amountKrw))}</p><span style={{ width: `${item.sharePct}%` }}/></li>)}</ol>}</section>
        <section><header><p className="eyebrow">TOP REPORTED ROWS</p><h3>상위 고유 신고행</h3></header>{pulse.concentration.topGroups.length === 0 ? <p>기준월 고유 신고행 없음</p> : <ol>{pulse.concentration.topGroups.map((item) => <li key={`${item.rank}-${item.dealDate}-${item.district}`}><p>{item.rank}. {item.district} {item.locality} · {krw(Number(item.amountKrw))} · {item.sharePct.toFixed(1)}%</p><small>{item.dealDate} · {item.buildingUse} · {area(Number(item.areaM2))}</small></li>)}</ol>}</section>
      </div>
    </div>

    <footer className="market-pulse-method">
      <div><b>분석 모집단</b><span>{pulse.scope.geography} · {pulse.scope.population} · {pulse.scope.areaRule}</span><small><ContextTooltip label="분석 원천" detail={`${pulse.scope.source} · ${pulse.asOfPeriod} 완료월 기준 · ${pulse.scope.amountBasis}`} href={pulseSourceUrl(pulse.scope.source)} align="start">{pulse.scope.source}</ContextTooltip> · {pulse.scope.amountBasis}</small></div>
      <div><b>중복·품질</b><span><ContextTooltip label="중복 제거 품질" detail="원천 적격 신고행에서 byte-identical API payload만 제외하며, 유사 주소·금액만으로 별도 신고행을 합치지 않습니다." align="start">원천 {pulse.quality.sourceRowCount}행 · 고유 payload {pulse.quality.uniquePayloadCount}행 · 동일 payload {pulse.quality.exactDuplicateRows}행 제외</ContextTooltip></span><small>제외: {pulse.scope.exclusions.join(" · ")}</small></div>
      <p>{pulse.call.caution}</p>
    </footer>
  </section>;
}
