import fs from "node:fs";
import postgres from "postgres";
import { getDailyArticles } from "../src/lib/server/daily-articles.ts";
import { searchMarket } from "../src/lib/server/market-search.ts";

const DEFAULT_AUTHORITY = String.raw`C:\10137_WorkSpace\env\.env.supabase.local`;

function connectionUrl() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const authority = process.env.SUPABASE_ENV_FILE || DEFAULT_AUTHORITY;
  const text = fs.readFileSync(authority, "utf8").replace(/^\uFEFF/, "");
  const line = text.split(/\r?\n/).find((candidate) => /^(?:export\s+)?SUPABASE_DB_URL\s*=/.test(candidate.trim()));
  if (!line) throw new Error("SUPABASE_DB_URL is not configured");
  return line.slice(line.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const sql = postgres(connectionUrl(), {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  ssl: "require",
  prepare: false,
  transform: { undefined: null },
});

const execute = async (text, values) => {
  const rows = await sql.begin("read only", async (transaction) => {
    await transaction.unsafe("SET LOCAL statement_timeout = 20000");
    return transaction.unsafe(text, [...values]);
  });
  return { rows };
};

async function measure(label, operation, summarize) {
  const started = performance.now();
  const result = await operation();
  const elapsedMs = Math.round(performance.now() - started);
  console.log(JSON.stringify({ label, elapsedMs, ...summarize(result) }));
}

const selectedDate = process.argv.find((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)) || todayInSeoul();
const query = process.argv.find((value) => value.startsWith("--query="))?.slice("--query=".length) || "강남 오피스";

try {
  await measure(
    "daily-articles",
    () => getDailyArticles(execute, selectedDate),
    (result) => ({ selectedDate, resultCount: result.articles.length }),
  );
  await measure(
    "event-search",
    () => searchMarket(execute, {
      q: query,
      kind: "EVENT",
      category: "",
      classificationScheme: "",
      from: null,
      to: null,
      page: 1,
      pageSize: 20,
      includeTransactionsUnder1000Eok: false,
    }),
    (result) => ({ query, total: result.total, resultCount: result.results.length }),
  );
  await measure(
    "daily-articles-warm",
    () => getDailyArticles(execute, selectedDate),
    (result) => ({ selectedDate, resultCount: result.articles.length }),
  );
} finally {
  await sql.end({ timeout: 5 });
}
