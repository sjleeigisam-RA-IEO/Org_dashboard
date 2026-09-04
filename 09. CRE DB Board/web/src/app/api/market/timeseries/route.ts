import { getCachedMacroTimeseries } from "@/lib/server/market-data-cache";
import { normalizeCanonicalMacroTimeseries } from "@/lib/server/macro-timeseries";

export const runtime = "nodejs";

type MacroTimeseriesLoader = () => Promise<unknown>;

export async function loadMacroTimeseriesResponse(loader: MacroTimeseriesLoader) {
  try {
    return Response.json(normalizeCanonicalMacroTimeseries(await loader()), { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    const value = error as { name?: string; code?: string };
    console.error("macro timeseries request failed", { name: value?.name, code: value?.code });
    return Response.json({ error: "금리 시계열을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function GET() {
  return loadMacroTimeseriesResponse(() => getCachedMacroTimeseries());
}
