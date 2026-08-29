import { describe,expect,it,vi } from "vitest";
import { getModelInterpretations } from "@/lib/server/model-interpretations";
const payload={generatedAt:"2026",models:[],statusCounts:[],interpretations:[]};
describe("getModelInterpretations",()=>{it("serves only persisted versioned outputs with grounded evidence",async()=>{const execute=vi.fn().mockResolvedValue({rows:[{payload}]}); expect(await getModelInterpretations(execute)).toEqual(payload); const sql=execute.mock.calls[0][0] as string; expect(sql).toContain("market_intelligence.insight_interpretations"); expect(sql).toContain("market_intelligence.analytics_model_registry"); expect(sql).toContain("market_intelligence.insight_interpretation_evidence"); expect(sql).not.toContain("api_key");});});
