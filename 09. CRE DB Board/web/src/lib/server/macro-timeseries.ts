import { normalizeMacroTimeseries } from "@/lib/macro-timeseries-contract";
import type { SqlExecutor } from "@/lib/server/market-search";

const EXPECTED_SERIES_CODES = new Set([
  "BOK_BASE_RATE_MONTHLY", "KR_CD_91D", "KR_GOVT_BOND_3Y", "KR_GOVT_BOND_10Y", "KR_CORP_BOND_AA_MINUS_3Y",
  "US_FED_TARGET_LOWER", "US_FED_TARGET_UPPER", "US_EFFR", "US_SOFR",
  "US_TREASURY_2Y", "US_TREASURY_10Y", "US_TREASURY_30Y", "US_TREASURY_10Y_MINUS_2Y",
]);

const QUERY = `WITH registry(series_code,group_code,display_order) AS (
  VALUES
    ('BOK_BASE_RATE_MONTHLY','KOREA',10),
    ('KR_CD_91D','KOREA',20),
    ('KR_GOVT_BOND_3Y','KOREA',30),
    ('KR_GOVT_BOND_10Y','KOREA',40),
    ('KR_CORP_BOND_AA_MINUS_3Y','KOREA',50),
    ('US_FED_TARGET_LOWER','US_POLICY',60),
    ('US_FED_TARGET_UPPER','US_POLICY',70),
    ('US_EFFR','US_POLICY',80),
    ('US_SOFR','US_POLICY',90),
    ('US_TREASURY_2Y','US_TREASURY',100),
    ('US_TREASURY_10Y','US_TREASURY',110),
    ('US_TREASURY_30Y','US_TREASURY',120),
    ('US_TREASURY_10Y_MINUS_2Y','US_TREASURY',130)
), bounds AS (
  SELECT min(observation_month) AS available_from,max(observation_month) AS available_through,
         least(max(observation_month),to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Seoul')-interval '1 month','YYYY-MM')) AS complete_through
  FROM market_intelligence.financial_macro_monthly_serving f
  JOIN registry r USING(series_code)
), series_payload AS (
  SELECT r.display_order,jsonb_build_object(
    'code',r.series_code,
    'name',s.series_name_ko,
    'group',r.group_code,
    'source',cs.source_name,
    'unit',f.unit_code,
    'validFrom',s.valid_from,
    'sourceVintageAt',max(f.source_vintage_at),
    'points',jsonb_agg(jsonb_build_object(
      'month',f.observation_month,
      'value',f.numeric_value::float8,
      'observationCount',f.observation_count,
      'partial',(f.observation_month>b.complete_through)
    ) ORDER BY f.observation_month)
  ) AS series
  FROM registry r
  JOIN market_intelligence.financial_macro_monthly_serving f USING(series_code)
  JOIN market_intelligence.macro_series s USING(series_code)
  JOIN market_intelligence.collection_sources cs ON cs.source_id=f.source_id
  CROSS JOIN bounds b
  GROUP BY r.series_code,r.group_code,r.display_order,s.series_name_ko,s.valid_from,cs.source_name,f.unit_code
)
SELECT jsonb_build_object(
  'generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'availableFrom',b.available_from,
  'availableThrough',b.available_through,
  'completeThrough',b.complete_through,
  'series',coalesce(jsonb_agg(sp.series ORDER BY sp.display_order),'[]'::jsonb)
) AS payload
FROM bounds b CROSS JOIN series_payload sp
GROUP BY b.available_from,b.available_through,b.complete_through`;

export function normalizeCanonicalMacroTimeseries(value: unknown) {
  const normalized = normalizeMacroTimeseries(value);
  const codes = new Set(normalized.series.map((series) => series.code));
  if (codes.size !== EXPECTED_SERIES_CODES.size || [...EXPECTED_SERIES_CODES].some((code) => !codes.has(code))) {
    throw new Error("Incomplete macro series registry");
  }
  return normalized;
}

export async function getMacroTimeseries(execute: SqlExecutor) {
  const result = await execute(QUERY, []);
  return normalizeCanonicalMacroTimeseries(result.rows[0]?.payload);
}
