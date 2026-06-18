const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-iota-api-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

type IotaLogRow = {
  iota_log_id: string;
  source_t5t_log_id?: string | null;
  writer_name?: string | null;
  writer_email?: string | null;
  writer_staff_id?: string | null;
  line?: string | null;
  work_date?: string | null;
  week_key?: string | null;
  week_end_date?: string | null;
  task_type?: string | null;
  log_title?: string | null;
  summary?: string | null;
  raw_text?: string | null;
  body_text?: string | null;
  match_terms?: string[] | null;
  source_url?: string | null;
  updated_at?: string | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    assertOptionalApiToken(request);
    const url = new URL(request.url);
    const writer = cleanParam(url.searchParams.get("writer"));
    const from = cleanDate(url.searchParams.get("from"));
    const to = cleanDate(url.searchParams.get("to"));
    const limit = clampLimit(url.searchParams.get("limit"));
    const offset = clampOffset(url.searchParams.get("offset"));

    const rows = await selectIotaLogs({ writer, from, to, limit, offset });
    return jsonResponse({
      ok: true,
      count: rows.length,
      limit,
      offset,
      filters: { writer, from, to },
      logs: rows.map(publicLog),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("VALIDATION:") ? 400 : message.startsWith("AUTH:") ? 401 : 500;
    return jsonResponse({ ok: false, error: message.replace(/^(VALIDATION|AUTH):\s*/, "") }, status);
  }
});

async function selectIotaLogs(filters: {
  writer: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}) {
  const query = new URLSearchParams({
    select: [
      "iota_log_id",
      "source_t5t_log_id",
      "writer_name",
      "writer_email",
      "writer_staff_id",
      "line",
      "work_date",
      "week_key",
      "week_end_date",
      "task_type",
      "log_title",
      "summary",
      "raw_text",
      "body_text",
      "match_terms",
      "source_url",
      "updated_at",
    ].join(","),
    order: "work_date.desc,updated_at.desc",
    limit: String(filters.limit),
    offset: String(filters.offset),
  });
  if (filters.writer) query.append("writer_name", `eq.${filters.writer}`);
  if (filters.from) query.append("work_date", `gte.${filters.from}`);
  if (filters.to) query.append("work_date", `lte.${filters.to}`);

  const response = await fetch(`${requireEnv("SUPABASE_URL")}/rest/v1/iota_t5t_logs?${query.toString()}`, {
    method: "GET",
    headers: {
      apikey: getSupabaseKey(),
      Authorization: `Bearer ${getSupabaseKey()}`,
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase iota_t5t_logs select failed ${response.status}: ${body}`);
  return (body ? JSON.parse(body) : []) as IotaLogRow[];
}

function publicLog(row: IotaLogRow) {
  return {
    id: row.iota_log_id,
    source_t5t_log_id: row.source_t5t_log_id,
    writer_name: row.writer_name,
    writer_email: row.writer_email,
    writer_staff_id: row.writer_staff_id,
    line: row.line,
    work_date: row.work_date,
    week_key: row.week_key,
    week_end_date: row.week_end_date,
    task_type: row.task_type,
    title: row.log_title,
    summary: row.summary,
    raw_text: row.raw_text,
    body_text: row.body_text,
    match_terms: row.match_terms || [],
    source_url: row.source_url,
    updated_at: row.updated_at,
  };
}

function assertOptionalApiToken(request: Request) {
  const expected = Deno.env.get("IOTA_LOGS_API_TOKEN") || "";
  if (!expected) return;
  const actual = request.headers.get("x-iota-api-token") || new URL(request.url).searchParams.get("token") || "";
  if (actual !== expected) throw new Error("AUTH: Invalid API token");
}

function cleanParam(value: string | null) {
  const cleaned = String(value || "").trim();
  return cleaned || null;
}

function cleanDate(value: string | null) {
  const cleaned = cleanParam(value);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) throw new Error("VALIDATION: Date filters must be YYYY-MM-DD");
  return cleaned;
}

function clampLimit(value: string | null) {
  const parsed = Number(value || 200);
  if (!Number.isFinite(parsed)) return 200;
  return Math.max(1, Math.min(1000, Math.trunc(parsed)));
}

function clampOffset(value: string | null) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function getSupabaseKey() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY") ||
    "";
  if (!key) throw new Error("Missing Supabase key.");
  return key;
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
