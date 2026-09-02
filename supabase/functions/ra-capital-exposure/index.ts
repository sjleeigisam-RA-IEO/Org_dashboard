const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SESSION_TTL_DAYS = 30;
const SESSION_IDLE_DAYS = 3;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const payload = await request.json() as { session_token?: string };
    const token = requireText(payload.session_token, "로그인 세션이 필요합니다.");
    const { session, tokenHash, now } = await requireValidSession(token);
    await requireActiveStaff(session.staff_id);

    await patchRows("ra_auth_sessions", `token_hash=eq.${tokenHash}`, {
      last_seen_at: now.toISOString(),
    });

    const [delegatedExposures, partyBridge] = await Promise.all([
      postgrest("one_account_delegated_exposure_current_v1", {
        method: "GET",
        query: "select=*&order=canonical_account_name.asc,fund_id.asc,exposure_id.asc",
      }),
      postgrest("one_account_party_bridge_current_v1", {
        method: "GET",
        query: "select=account_id,canonical_account_name,party_id,is_primary,resolution_status&order=canonical_account_name.asc,party_id.asc",
      }),
    ]);

    return jsonResponse({
      ok: true,
      snapshot_version: "v1.1",
      delegated_exposures: Array.isArray(delegatedExposures) ? delegatedExposures : [],
      party_bridge: Array.isArray(partyBridge) ? partyBridge : [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH:") ? 401 : 500;
    return jsonResponse({ ok: false, error: message.replace(/^AUTH:\s*/, "") }, status);
  }
});

async function requireValidSession(token: string) {
  const tokenHash = await sha256Hex(token);
  const rows = await postgrest("ra_auth_sessions", {
    method: "GET",
    query: `token_hash=eq.${tokenHash}&select=staff_id,created_at,last_seen_at,expires_at,revoked_at&limit=1`,
  });
  const session = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!session || session.revoked_at) throw new Error("AUTH: 로그인 세션이 만료되었습니다.");

  const now = new Date();
  const createdAt = new Date(session.created_at);
  const lastSeenAt = new Date(session.last_seen_at || session.created_at);
  const expiresAt = new Date(session.expires_at);
  if (
    Number.isNaN(createdAt.getTime()) || Number.isNaN(lastSeenAt.getTime()) || Number.isNaN(expiresAt.getTime()) ||
    now > expiresAt || daysBetween(createdAt, now) >= SESSION_TTL_DAYS || daysBetween(lastSeenAt, now) >= SESSION_IDLE_DAYS
  ) {
    throw new Error("AUTH: 로그인 세션이 만료되었습니다.");
  }
  return { session, tokenHash, now };
}

async function requireActiveStaff(staffId: string) {
  const rows = await postgrest("staff", {
    method: "GET",
    query: `staff_id=eq.${encodeURIComponent(staffId)}&status=eq.active&select=staff_id&limit=1`,
  });
  if (!Array.isArray(rows) || !rows.length) throw new Error("AUTH: 재직자 세션을 확인할 수 없습니다.");
}

async function patchRows(table: string, filter: string, body: Record<string, unknown>) {
  return await postgrest(table, {
    method: "PATCH",
    query: filter,
    body: JSON.stringify(body),
  });
}

async function postgrest(table: string, init: { method: string; query?: string; body?: string }) {
  const url = `${requireEnv("SUPABASE_URL")}/rest/v1/${table}${init.query ? `?${init.query}` : ""}`;
  const key = getServiceRoleKey();
  const response = await fetch(url, {
    method: init.method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: init.body,
  });
  if (!response.ok) throw new Error(`PostgREST ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function getServiceRoleKey() {
  const secretKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (typeof parsed.default === "string" && parsed.default) return parsed.default;
      const first = Object.values(parsed).find((value) => typeof value === "string" && value);
      if (typeof first === "string") return first;
    } catch {
      // Fall through to the dedicated service-role secret.
    }
  }
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function requireText(value: unknown, message: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`AUTH: ${message}`);
  return text;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim()));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}