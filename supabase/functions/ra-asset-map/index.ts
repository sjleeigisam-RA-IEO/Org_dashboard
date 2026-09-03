const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSION_TTL_DAYS = 30;
const SESSION_IDLE_DAYS = 3;
const PAGE_SIZE = 500;
const MAX_ASSETS = 10000;
const MAX_BODY_BYTES = 2048;

type Payload = { session_token?: string };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) throw new Error("VALIDATION: 요청 본문이 너무 큽니다.");
    const payload = await request.json() as Payload;
    const token = requireText(payload.session_token, "로그인 세션이 필요합니다.");
    if (token.length > 512) throw new Error("VALIDATION: 로그인 세션 형식이 올바르지 않습니다.");
    const { session, tokenHash, now } = await requireValidSession(token);
    await requireActiveStaff(session.staff_id);
    await patchRows("ra_auth_sessions", `token_hash=eq.${tokenHash}`, { last_seen_at: now.toISOString() });

    const select = [
      "asset_id", "asset_code", "canonical_name", "asset_type",
      "portfolio_region", "location_subject_type",
      "normalized_country_name", "country_code_alpha3",
      "normalized_city", "normalized_admin1", "raw_city", "latitude", "longitude",
      "coordinate_precision", "coordinate_confidence", "coordinate_source",
      "review_status", "is_map_eligible", "location_tier", "location_status_label",
    ].join(",");
    const assets: unknown[] = [];
    for (let offset = 0; offset < MAX_ASSETS; offset += PAGE_SIZE) {
      const page = await postgrest("asset_map_location_progressive_v1", {
        method: "GET",
        query: `select=${select}&order=location_tier.asc,asset_id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      });
      if (!Array.isArray(page)) throw new Error("Invalid map projection response");
      assets.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    if (assets.length >= MAX_ASSETS) throw new Error("Asset map projection exceeds the supported population");

    return jsonResponse({
      ok: true,
      generated_at: now.toISOString(),
      count: assets.length,
      assets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("VALIDATION:")) {
      return jsonResponse({ ok: false, error: message.replace(/^VALIDATION:\s*/, "") }, 401);
    }
    console.error("ra-asset-map request failed", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ ok: false, error: "지도 데이터를 불러오지 못했습니다." }, 500);
  }
});

async function requireValidSession(token: string) {
  const tokenHash = await sha256Hex(token);
  const session = await selectOne("ra_auth_sessions", `token_hash=eq.${tokenHash}&select=staff_id,created_at,last_seen_at,expires_at,revoked_at`);
  if (!session || session.revoked_at) throw new Error("VALIDATION: 로그인 세션이 만료되었습니다.");
  const now = new Date();
  const createdAt = new Date(session.created_at);
  const lastSeenAt = new Date(session.last_seen_at || session.created_at);
  const expiresAt = new Date(session.expires_at);
  if (![createdAt, lastSeenAt, expiresAt].every((value) => Number.isFinite(value.getTime()))) {
    throw new Error("VALIDATION: 로그인 세션이 만료되었습니다.");
  }
  if (now > expiresAt || daysBetween(createdAt, now) >= SESSION_TTL_DAYS || daysBetween(lastSeenAt, now) >= SESSION_IDLE_DAYS) {
    throw new Error("VALIDATION: 로그인 세션이 만료되었습니다.");
  }
  return { session, tokenHash, now };
}

async function requireActiveStaff(staffId: string) {
  const staff = await selectOne("staff", `staff_id=eq.${encodeURIComponent(staffId)}&select=staff_id,status`);
  if (!staff || staff.status !== "active") throw new Error("VALIDATION: 등록된 재직자만 사용할 수 있습니다.");
  return staff;
}

async function selectOne(table: string, query: string) {
  const rows = await postgrest(table, { method: "GET", query });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function patchRows(table: string, filter: string, body: Record<string, unknown>) {
  return await postgrest(table, { method: "PATCH", query: filter, body: JSON.stringify(body) });
}

async function postgrest(table: string, init: { method: string; query?: string; body?: string }) {
  const url = `${requireEnv("SUPABASE_URL")}/rest/v1/${table}${init.query ? `?${init.query}` : ""}`;
  const key = getSupabaseKey();
  if (!key) throw new Error("Missing service role key");
  const response = await fetch(url, {
    method: init.method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init.body,
  });
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function requireText(value: unknown, message: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`VALIDATION: ${message}`);
  return text;
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getSupabaseKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed).find(Boolean);
      if (typeof first === "string") return first;
    } catch {
      // Fall through to the legacy names.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_KEY") || "";
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
}