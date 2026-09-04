import { unstable_cache } from "next/cache";
import { getCategoryIndex } from "@/lib/server/category-index";
import { getDailyArticles } from "@/lib/server/daily-articles";
import { executeMarketSql } from "@/lib/server/db";
import { getInsightSignals } from "@/lib/server/insight-signals";
import { getKeywordAnalytics } from "@/lib/server/keyword-analytics";
import { getModelInterpretations } from "@/lib/server/model-interpretations";
import { searchMarket } from "@/lib/server/market-search";
import { getOperationsOverview } from "@/lib/server/operations-insights";
import { getOperationsTimeline } from "@/lib/server/operations-timeline";
import { getQuantitativeMarketPulse } from "@/lib/server/quantitative-market-pulse";
import { getMacroTimeseries } from "@/lib/server/macro-timeseries";
import type { SearchRequest } from "@/lib/search-contract";

// These projections are identical for every approved user and are refreshed on
// a daily pipeline. Keeping them in Next's data cache avoids rebuilding the
// same serving view for every browser tab and APK request.
export const getCachedCategoryIndex = unstable_cache(
  () => getCategoryIndex(executeMarketSql),
  ["cre-db-category-index-v3"],
  { revalidate: 300, tags: ["cre-db-category-index"] },
);

export const getCachedDailyArticles = unstable_cache(
  (selectedDate: string) => getDailyArticles(executeMarketSql, selectedDate),
  ["cre-db-daily-articles-v1"],
  { revalidate: 300, tags: ["cre-db-daily-articles"] },
);

export const getCachedOperationsOverview = unstable_cache(
  () => getOperationsOverview(executeMarketSql),
  ["cre-db-operations-overview-v2"],
  { revalidate: 300, tags: ["cre-db-operations"] },
);

export const getCachedOperationsTimeline = unstable_cache(
  (windowDays: number) => getOperationsTimeline(executeMarketSql, windowDays),
  ["cre-db-operations-timeline-v2"],
  { revalidate: 300, tags: ["cre-db-operations"] },
);

export const getCachedKeywordAnalytics = unstable_cache(
  (limit: number, briefingPriority = false) => getKeywordAnalytics(executeMarketSql, limit, briefingPriority),
  ["cre-db-keyword-analytics-v2"],
  { revalidate: 300, tags: ["cre-db-analytics"] },
);

export const getCachedInsightSignals = unstable_cache(
  (limit: number, reviewableOnly = false) => getInsightSignals(executeMarketSql, limit, reviewableOnly),
  ["cre-db-insight-signals-v2"],
  { revalidate: 300, tags: ["cre-db-analytics"] },
);

export const getCachedModelInterpretations = unstable_cache(
  (limit: number) => getModelInterpretations(executeMarketSql, limit),
  ["cre-db-model-interpretations-v1"],
  { revalidate: 300, tags: ["cre-db-analytics"] },
);

export const getCachedQuantitativeMarketPulse = unstable_cache(
  () => getQuantitativeMarketPulse(executeMarketSql),
  ["cre-db-quantitative-market-pulse-v2"],
  { revalidate: 300, tags: ["cre-db-market-pulse"] },
);

export const getCachedMacroTimeseries = unstable_cache(
  () => getMacroTimeseries(executeMarketSql),
  ["cre-db-macro-timeseries-v1"],
  { revalidate: 300, tags: ["cre-db-macro-timeseries"] },
);

// Short-lived exact-query caching absorbs repeated tab navigation and filter
// taps without making rapidly changing search results feel stale.
export const getCachedMarketSearch = unstable_cache(
  (request: SearchRequest) => searchMarket(executeMarketSql, request),
  ["cre-db-market-search-v3"],
  { revalidate: 30, tags: ["cre-db-market-search"] },
);
