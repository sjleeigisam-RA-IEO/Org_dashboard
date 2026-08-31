import { getCachedQuantitativeMarketPulse } from "@/lib/server/market-data-cache";

export const runtime = "nodejs";

type MarketPulseLoader = () => Promise<unknown>;

export async function loadMarketPulseResponse(loader: MarketPulseLoader) {
  try {
    return Response.json(await loader(), {
      headers: { "cache-control": "private, max-age=300" },
    });
  } catch (error) {
    const value = error as { name?: string; code?: string };
    console.error("quantitative market pulse request failed", { name: value?.name, code: value?.code });
    return Response.json({ error: "시장 수치를 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function GET() {
  return loadMarketPulseResponse(() => getCachedQuantitativeMarketPulse());
}
