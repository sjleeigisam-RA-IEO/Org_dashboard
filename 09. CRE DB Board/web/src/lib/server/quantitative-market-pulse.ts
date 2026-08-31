import { normalizeQuantitativeMarketPulse } from "@/lib/quantitative-market-pulse-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

export type MarketPulseTrendPoint = {
  period: string;
  transactionCount: number;
  amountKrw: string;
  areaM2: string;
  sourceRowCount: number;
  uniquePayloadCount: number;
};

type Metric = {
  value: number;
  previousValue: number | null;
  yearAgoValue: number | null;
  momPct: number | null;
  yoyPct: number | null;
  ytdValue: number;
  priorYtdValue: number;
  ytdYoyPct: number | null;
};

type QueryPayload = {
  generatedAt: string;
  asOfPeriod: string;
  trend: MarketPulseTrendPoint[];
  analysisTrend: MarketPulseTrendPoint[];
  latestGroups: Array<{ rank: number; dealDate: string; district: string; locality: string; buildingUse: string; amountKrw: string; areaM2: string; sharePct: number }>;
  districts: Array<{ district: string; transactionCount: number; amountKrw: string; areaM2: string; sharePct: number }>;
};

const QUERY = `WITH latest_versions AS (
  SELECT dv.metadata_json::jsonb AS metadata,
         row_number() OVER (PARTITION BY dv.document_id ORDER BY dv.version_no DESC) AS version_rank
  FROM market_intelligence.document_versions dv
  JOIN market_intelligence.source_documents sd ON sd.document_id=dv.document_id
  JOIN market_intelligence.collection_sources cs ON cs.source_id=sd.source_id
  WHERE cs.source_code='MOLIT_REAL_TRANSACTION'
), raw_eligible AS MATERIALIZED (
  SELECT metadata->'api_record' AS api
  FROM latest_versions
  WHERE version_rank=1
    AND coalesce(metadata->'api_record'->>'sggCd','') LIKE '11%'
    AND coalesce(metadata->'api_record'->>'cdealDay','')=''
    AND nullif(btrim(metadata->'api_record'->>'buildingUse'),'') IS NOT NULL
    AND (metadata->'api_record'->>'buildingUse') !~ '(아파트|공동주택|단독주택|다가구|다세대|연립|주택|주거)'
    AND CASE WHEN coalesce(metadata->'api_record'->>'buildingAr','') ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN (metadata->'api_record'->>'buildingAr')::numeric > 3300 ELSE false END
    AND coalesce(metadata->'api_record'->>'dealAmount','') ~ '^[0-9]+(,[0-9]{3})*$'
    AND CASE WHEN coalesce(metadata->'api_record'->>'dealYear','') ~ '^20[0-9]{2}$'
      AND coalesce(metadata->'api_record'->>'dealMonth','') ~ '^(0?[1-9]|1[0-2])$'
      AND coalesce(metadata->'api_record'->>'dealDay','') ~ '^(0?[1-9]|[12][0-9]|3[01])$'
      THEN to_char(to_date(concat_ws('-',metadata->'api_record'->>'dealYear',metadata->'api_record'->>'dealMonth',metadata->'api_record'->>'dealDay'),'YYYY-FMMM-FMDD'),'YYYY-FMMM-FMDD')
        = concat_ws('-',metadata->'api_record'->>'dealYear',ltrim(metadata->'api_record'->>'dealMonth','0'),ltrim(metadata->'api_record'->>'dealDay','0'))
      ELSE false END
), eligible AS MATERIALIZED (
  SELECT DISTINCT api FROM raw_eligible
), canonical_transactions AS (
  SELECT make_date((api->>'dealYear')::int,(api->>'dealMonth')::int,1) AS month_start,
         make_date((api->>'dealYear')::int,(api->>'dealMonth')::int,(api->>'dealDay')::int) AS deal_date,
         api->>'sggNm' AS district,
         api->>'umdNm' AS locality,
         api->>'buildingUse' AS building_use,
         replace(api->>'dealAmount',',','')::numeric*10000 AS amount_krw,
         (api->>'buildingAr')::numeric AS area_m2
  FROM eligible
), monthly_quality AS (
  SELECT make_date((api->>'dealYear')::int,(api->>'dealMonth')::int,1) AS month_start,
         count(*)::int AS source_row_count,
         count(DISTINCT api)::int AS unique_payload_count
  FROM raw_eligible
  GROUP BY 1
), monthly_facts AS (
  SELECT month_start,count(*)::int AS transaction_count,sum(amount_krw) AS amount_krw,sum(area_m2) AS area_m2
  FROM canonical_transactions
  GROUP BY month_start
), data_bounds AS (
  SELECT max(month_start) AS latest_data_month FROM canonical_transactions
), clock AS (
  SELECT date_trunc('month',current_date)::date AS current_month
), reference_month AS (
  SELECT CASE
    WHEN latest_data_month < current_month THEN latest_data_month
    ELSE (current_month - interval '1 month')::date
  END AS month_start,
  current_month,latest_data_month
  FROM data_bounds CROSS JOIN clock
), calendar AS (
  SELECT generated.month_start::date AS month_start
  FROM reference_month r
  CROSS JOIN LATERAL generate_series(
    least((r.month_start - interval '18 months')::date,(date_trunc('year',r.month_start) - interval '1 year')::date),
    r.month_start,
    interval '1 month'
  ) AS generated(month_start)
  WHERE r.month_start IS NOT NULL
), monthly AS (
  SELECT c.month_start,
         coalesce(f.transaction_count,0)::int AS transaction_count,
         coalesce(f.amount_krw,0)::numeric AS amount_krw,
         coalesce(f.area_m2,0)::numeric AS area_m2,
         coalesce(q.source_row_count,0)::int AS source_row_count,
         coalesce(q.unique_payload_count,0)::int AS unique_payload_count
  FROM calendar c
  LEFT JOIN monthly_facts f USING(month_start)
  LEFT JOIN monthly_quality q USING(month_start)
), ranked_transactions AS (
  SELECT t.*,
         row_number() OVER(ORDER BY t.amount_krw DESC,t.deal_date,t.district,t.locality)::int AS amount_rank,
         t.amount_krw/nullif(sum(t.amount_krw) OVER(),0)*100 AS share_pct
  FROM canonical_transactions t
  JOIN reference_month r ON t.month_start=r.month_start
), district_totals AS (
  SELECT district,count(*)::int AS transaction_count,sum(amount_krw) AS amount_krw,sum(area_m2) AS area_m2,
         sum(amount_krw)/nullif(sum(sum(amount_krw)) OVER(),0)*100 AS share_pct
  FROM canonical_transactions t
  JOIN reference_month r ON t.month_start=r.month_start
  GROUP BY district
)
SELECT jsonb_build_object(
  'generatedAt',current_timestamp,
  'asOfPeriod',(SELECT to_char(month_start,'YYYY-MM') FROM reference_month),
  'analysisTrend',(SELECT jsonb_agg(jsonb_build_object(
    'period',to_char(month_start,'YYYY-MM'),'transactionCount',transaction_count,
    'amountKrw',amount_krw::text,'areaM2',area_m2::text,
    'sourceRowCount',source_row_count,'uniquePayloadCount',unique_payload_count
  ) ORDER BY month_start) FROM monthly),
  'trend',(SELECT jsonb_agg(jsonb_build_object(
    'period',to_char(monthly.month_start,'YYYY-MM'),'transactionCount',transaction_count,
    'amountKrw',amount_krw::text,'areaM2',area_m2::text,
    'sourceRowCount',source_row_count,'uniquePayloadCount',unique_payload_count
  ) ORDER BY monthly.month_start) FROM monthly CROSS JOIN reference_month r
    WHERE monthly.month_start >= (r.month_start - interval '18 months')::date),
  'latestGroups',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank',amount_rank,'dealDate',deal_date,'district',district,'locality',locality,
    'buildingUse',building_use,'amountKrw',amount_krw::text,'areaM2',area_m2::text,
    'sharePct',round(share_pct,2)
  ) ORDER BY amount_rank),'[]'::jsonb) FROM ranked_transactions WHERE amount_rank<=5),
  'districts',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'district',district,'transactionCount',transaction_count,'amountKrw',amount_krw::text,
    'areaM2',area_m2::text,'sharePct',round(share_pct,2)
  ) ORDER BY amount_krw DESC,district),'[]'::jsonb) FROM district_totals)
) AS payload`;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const requiredText = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Invalid ${label}`);
  return value;
};
const integer = (value: unknown, label: string, minimum = 0) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) throw new Error(`Invalid ${label}`);
  return value;
};
const bounded = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid ${label}`);
  return value;
};
const decimalText = (value: unknown, label: string) => {
  const result = requiredText(value, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result) || !Number.isFinite(Number(result))) throw new Error(`Invalid ${label}`);
  return result;
};
const monthPeriod = (value: unknown, label: string) => {
  const result = requiredText(value, label);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
};
const isoTimestamp = (value: unknown, label: string) => {
  const result = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || Number.isNaN(Date.parse(result))) throw new Error(`Invalid ${label}`);
  return new Date(result).toISOString();
};
const isoDate = (value: unknown, label: string) => {
  const result = requiredText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) throw new Error(`Invalid ${label}`);
  return result;
};

function parsePoint(value: unknown, label: string): MarketPulseTrendPoint {
  if (!record(value)) throw new Error(`Invalid ${label}`);
  const point = {
    period: monthPeriod(value.period, `${label}.period`),
    transactionCount: integer(value.transactionCount, `${label}.transactionCount`),
    amountKrw: decimalText(value.amountKrw, `${label}.amountKrw`),
    areaM2: decimalText(value.areaM2, `${label}.areaM2`),
    sourceRowCount: integer(value.sourceRowCount, `${label}.sourceRowCount`),
    uniquePayloadCount: integer(value.uniquePayloadCount, `${label}.uniquePayloadCount`),
  };
  if (point.transactionCount !== point.uniquePayloadCount || point.sourceRowCount < point.uniquePayloadCount) throw new Error(`Invalid ${label} count invariant`);
  const amountValue = Number(point.amountKrw);
  const areaValue = Number(point.areaM2);
  if (point.transactionCount === 0 ? amountValue !== 0 || areaValue !== 0 : amountValue <= 0 || areaValue <= 0) throw new Error(`Invalid ${label} fact invariant`);
  return point;
}

const nextPeriod = (value: string) => {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

function parsePoints(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Invalid ${label}`);
  const points = value.map((item, index) => parsePoint(item, `${label}.${index}`));
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].period !== nextPeriod(points[index - 1].period)) throw new Error(`Invalid ${label} period sequence`);
  }
  return points;
}

function parseQueryPayload(value: unknown): QueryPayload {
  if (!record(value)) throw new Error("Invalid market pulse database payload");
  const generatedAt = isoTimestamp(value.generatedAt, "generatedAt");
  const asOfPeriod = monthPeriod(value.asOfPeriod, "asOfPeriod");
  const trend = parsePoints(value.trend, "trend");
  const analysisTrend = parsePoints(value.analysisTrend, "analysisTrend");
  if (trend.length > 19 || trend.at(-1)?.period !== asOfPeriod || analysisTrend.at(-1)?.period !== asOfPeriod) throw new Error("Invalid trend period");
  const analysisSuffix = analysisTrend.slice(-trend.length);
  if (JSON.stringify(analysisSuffix) !== JSON.stringify(trend)) throw new Error("Invalid trend analysis suffix");
  const [asOfYear] = asOfPeriod.split("-").map(Number);
  if (!analysisTrend.some((point) => point.period === `${asOfYear - 1}-01`)) throw new Error("Invalid prior YTD calendar");
  if (!Array.isArray(value.latestGroups) || !Array.isArray(value.districts)) throw new Error("Invalid concentration arrays");
  const latestGroups = value.latestGroups.map((item, index) => {
    if (!record(item)) throw new Error(`Invalid latestGroups.${index}`);
    return {
      rank: integer(item.rank, `latestGroups.${index}.rank`, 1),
      dealDate: isoDate(item.dealDate, `latestGroups.${index}.dealDate`),
      district: requiredText(item.district, `latestGroups.${index}.district`),
      locality: requiredText(item.locality, `latestGroups.${index}.locality`),
      buildingUse: requiredText(item.buildingUse, `latestGroups.${index}.buildingUse`),
      amountKrw: decimalText(item.amountKrw, `latestGroups.${index}.amountKrw`),
      areaM2: decimalText(item.areaM2, `latestGroups.${index}.areaM2`),
      sharePct: bounded(item.sharePct, `latestGroups.${index}.sharePct`),
    };
  });
  const districts = value.districts.map((item, index) => {
    if (!record(item)) throw new Error(`Invalid districts.${index}`);
    return {
      district: requiredText(item.district, `districts.${index}.district`),
      transactionCount: integer(item.transactionCount, `districts.${index}.transactionCount`),
      amountKrw: decimalText(item.amountKrw, `districts.${index}.amountKrw`),
      areaM2: decimalText(item.areaM2, `districts.${index}.areaM2`),
      sharePct: bounded(item.sharePct, `districts.${index}.sharePct`),
    };
  });
  const latest = trend.at(-1)!;
  if ((latest.transactionCount === 0) !== (latestGroups.length === 0 && districts.length === 0)) throw new Error("Invalid concentration count invariant");
  if (districts.reduce((sum, item) => sum + item.transactionCount, 0) !== latest.transactionCount) throw new Error("Invalid district count invariant");
  return { generatedAt, asOfPeriod, trend, analysisTrend, latestGroups, districts };
}

const pct = (current: number, comparison: number | null) => comparison === null || comparison === 0 ? null : (current / comparison - 1) * 100;
const asNumber = (value: string | number) => typeof value === "number" ? value : Number(value);
const safeRatio = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator;

function metric(points: MarketPulseTrendPoint[], field: "amountKrw" | "transactionCount" | "areaM2"): Metric {
  const latest = points.at(-1)!;
  const previous = points.at(-2) ?? null;
  const [year, month] = latest.period.split("-").map(Number);
  const yearAgo = points.find((point) => point.period === `${year - 1}-${String(month).padStart(2, "0")}`) ?? null;
  const value = asNumber(latest[field]);
  const previousValue = previous ? asNumber(previous[field]) : null;
  const yearAgoValue = yearAgo ? asNumber(yearAgo[field]) : null;
  const currentYtd = points.filter((point) => point.period.startsWith(`${year}-`) && Number(point.period.slice(5)) <= month);
  const priorYtd = points.filter((point) => point.period.startsWith(`${year - 1}-`) && Number(point.period.slice(5)) <= month);
  const ytdValue = currentYtd.reduce((sum, point) => sum + asNumber(point[field]), 0);
  const priorYtdValue = priorYtd.reduce((sum, point) => sum + asNumber(point[field]), 0);
  return { value, previousValue, yearAgoValue, momPct: pct(value, previousValue), yoyPct: pct(value, yearAgoValue), ytdValue, priorYtdValue, ytdYoyPct: pct(ytdValue, priorYtdValue) };
}

const direction = (value: number) => value > 0 ? "증가" : value < 0 ? "감소" : "보합";
export function buildMarketHeadline(amountMomPct: number | null, countMomPct: number | null) {
  if (amountMomPct === null || countMomPct === null) return "전월 비교 불가 — 기준월 또는 전월 거래 부재";
  const amountDirection = direction(amountMomPct);
  const countDirection = direction(countMomPct);
  if (amountDirection === countDirection) {
    if (amountDirection === "증가") return "거래금액과 거래건수 동반 증가 — 시장 참여 폭 확대";
    if (amountDirection === "감소") return "거래금액과 거래건수 동반 감소 — 시장 활동 위축";
    return "거래금액과 거래건수 동반 보합 — 전월 수준 유지";
  }
  if (amountDirection === "증가" && countDirection === "감소") return "거래금액 증가 · 거래건수 감소 — 대형 거래 중심 반등";
  return `거래금액 ${amountDirection} · 거래건수 ${countDirection} — 혼조 흐름`;
}

export async function getQuantitativeMarketPulse(execute: SqlExecutor) {
  const result = await execute(QUERY, []);
  const payload = parseQueryPayload(result.rows[0]?.payload);
  const amount = metric(payload.analysisTrend, "amountKrw");
  const count = metric(payload.analysisTrend, "transactionCount");
  const area = metric(payload.analysisTrend, "areaM2");
  const latest = payload.trend.at(-1)!;
  const previous = payload.analysisTrend.at(-2) ?? null;
  const [year, month] = latest.period.split("-").map(Number);
  const yearAgo = payload.analysisTrend.find((point) => point.period === `${year - 1}-${String(month).padStart(2, "0")}`) ?? null;
  const averageTicket = safeRatio(amount.value, count.value);
  const previousAverageTicket = previous ? safeRatio(asNumber(previous.amountKrw), previous.transactionCount) : null;
  const yearAgoAverageTicket = yearAgo ? safeRatio(asNumber(yearAgo.amountKrw), yearAgo.transactionCount) : null;
  const unitAmount = safeRatio(amount.value, area.value);
  const previousUnitAmount = previous ? safeRatio(asNumber(previous.amountKrw), asNumber(previous.areaM2)) : null;
  const yearAgoUnitAmount = yearAgo ? safeRatio(asNumber(yearAgo.amountKrw), asNumber(yearAgo.areaM2)) : null;
  const headline = buildMarketHeadline(amount.momPct, count.momPct);
  const averageTicketMomPct = averageTicket === null ? null : pct(averageTicket, previousAverageTicket);
  const averageTicketYoyPct = averageTicket === null ? null : pct(averageTicket, yearAgoAverageTicket);
  const unitAmountMomPct = unitAmount === null ? null : pct(unitAmount, previousUnitAmount);
  const unitAmountYoyPct = unitAmount === null ? null : pct(unitAmount, yearAgoUnitAmount);
  const averageTicketDetail = averageTicketMomPct === null ? "비교 불가" : `${averageTicketMomPct >= 0 ? "+" : ""}${averageTicketMomPct.toFixed(1)}%`;

  return normalizeQuantitativeMarketPulse({
    generatedAt: payload.generatedAt,
    asOfPeriod: payload.asOfPeriod,
    call: {
      headline,
      detail: `거래금액 ${amount.momPct === null ? "비교 불가" : `${amount.momPct >= 0 ? "+" : ""}${amount.momPct.toFixed(1)}%`} · 거래건수 ${count.momPct === null ? "비교 불가" : `${count.momPct >= 0 ? "+" : ""}${count.momPct.toFixed(1)}%`} · 거래당 평균 ${averageTicketDetail}`,
      caution: "면적당 금액은 자산구성 변화의 영향을 받으므로 동일자산 가격지수로 해석하지 않습니다.",
    },
    metrics: {
      amount,
      count,
      area,
      averageTicket: { value: averageTicket, previousValue: previousAverageTicket, yearAgoValue: yearAgoAverageTicket, momPct: averageTicketMomPct, yoyPct: averageTicketYoyPct },
      unitAmount: { value: unitAmount, previousValue: previousUnitAmount, yearAgoValue: yearAgoUnitAmount, momPct: unitAmountMomPct, yoyPct: unitAmountYoyPct },
    },
    trend: payload.trend,
    concentration: { topGroups: payload.latestGroups, districts: payload.districts },
    quality: { sourceRowCount: latest.sourceRowCount, transactionCount: latest.transactionCount, uniquePayloadCount: latest.uniquePayloadCount, exactDuplicateRows: latest.sourceRowCount - latest.uniquePayloadCount },
    scope: {
      geography: "서울특별시",
      source: "국토교통부 실거래 공개시스템",
      population: "용도가 확인된 비주거용 부동산 실거래",
      areaRule: "개별 API 행 건물면적 > 3,300㎡",
      exclusions: ["취소 신고", "주거용", "용도 미상", "동일 API payload 중복"],
      amountBasis: "신고 거래금액 · 원 단위 환산 · 보수적 canonical payload 행 기준",
    },
  });
}
