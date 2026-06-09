const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PASSWORD_ALGO = "PBKDF2-SHA256";
const PASSWORD_ITERATIONS = 210000;
const SESSION_TTL_DAYS = 30;
const SESSION_IDLE_DAYS = 3;
const COMPANY_DOMAIN = "igisam.com";

type Mode = "setup-check" | "set-password" | "login" | "resume-session" | "logout";

type AuthPayload = {
  mode?: Mode;
  email?: string;
  setup_code?: string;
  password?: string;
  remember?: boolean;
  session_token?: string;
};

type StaffRow = {
  staff_id: string;
  employee_no?: string | null;
  name: string;
  email: string;
  status?: string | null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  try {
    const payload = await request.json() as AuthPayload;
    const mode = payload.mode;

    if (mode === "setup-check") return await handleSetupCheck(payload);
    if (mode === "set-password") return await handleSetPassword(payload);
    if (mode === "login") return await handleLogin(payload);
    if (mode === "resume-session") return await handleResumeSession(payload);
    if (mode === "logout") return await handleLogout(payload);

    return jsonResponse({ ok: false, error: "Unknown auth mode" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("VALIDATION:") ? 400 : 500;
    return jsonResponse({ ok: false, error: message.replace(/^VALIDATION:\s*/, "") }, status);
  }
});

async function handleSetupCheck(payload: AuthPayload) {
  const email = normalizeEmail(payload.email);
  const setupCode = requireText(payload.setup_code, "설정 코드가 필요합니다.");
  assertCompanyEmail(email);
  const staff = await findActiveStaff(email);
  await assertSetupCode(setupCode, false);
  return jsonResponse({ ok: true, user: publicUser(staff), can_set_password: true });
}

async function handleSetPassword(payload: AuthPayload) {
  const email = normalizeEmail(payload.email);
  const setupCode = requireText(payload.setup_code, "설정 코드가 필요합니다.");
  const password = requirePassword(payload.password);
  assertCompanyEmail(email);
  const staff = await findActiveStaff(email);
  await assertSetupCode(setupCode, true);

  const salt = randomToken(24);
  const passwordHash = await hashPassword(password, salt);
  await upsertCredential(staff, passwordHash, salt);

  const session = await maybeCreateSession(staff, Boolean(payload.remember));
  return jsonResponse({
    ok: true,
    user: publicUser(staff),
    session_token: session?.token || null,
    remember_until: session?.rememberUntil || null,
  });
}

async function handleLogin(payload: AuthPayload) {
  const email = normalizeEmail(payload.email);
  const password = requirePassword(payload.password);
  assertCompanyEmail(email);
  const staff = await findActiveStaff(email);
  const credential = await selectOne("ra_user_credentials", `staff_id=eq.${encodeURIComponent(staff.staff_id)}&select=*`);
  if (!credential) throw new Error("VALIDATION: 아직 비밀번호가 설정되지 않았습니다.");

  const expected = await hashPassword(password, credential.password_salt);
  if (!timingSafeEqual(expected, credential.password_hash)) {
    throw new Error("VALIDATION: 이메일 또는 비밀번호가 올바르지 않습니다.");
  }

  await patchRows("ra_user_credentials", `staff_id=eq.${encodeURIComponent(staff.staff_id)}`, {
    last_login_at: new Date().toISOString(),
  });

  const session = await maybeCreateSession(staff, Boolean(payload.remember));
  return jsonResponse({
    ok: true,
    user: publicUser(staff),
    session_token: session?.token || null,
    remember_until: session?.rememberUntil || null,
  });
}

async function handleResumeSession(payload: AuthPayload) {
  const token = requireText(payload.session_token, "자동로그인 토큰이 필요합니다.");
  const tokenHash = await sha256Hex(token);
  const session = await selectOne("ra_auth_sessions", `token_hash=eq.${tokenHash}&select=*`);
  if (!session || session.revoked_at) throw new Error("VALIDATION: 자동로그인이 만료되었습니다.");

  const now = new Date();
  const createdAt = new Date(session.created_at);
  const lastSeenAt = new Date(session.last_seen_at || session.created_at);
  const expiresAt = new Date(session.expires_at);
  if (now > expiresAt || daysBetween(createdAt, now) >= SESSION_TTL_DAYS || daysBetween(lastSeenAt, now) >= SESSION_IDLE_DAYS) {
    await revokeSession(tokenHash);
    throw new Error("VALIDATION: 자동로그인이 만료되었습니다.");
  }

  const staff = await findActiveStaffById(session.staff_id);
  await patchRows("ra_auth_sessions", `token_hash=eq.${tokenHash}`, { last_seen_at: now.toISOString() });
  return jsonResponse({ ok: true, user: publicUser(staff) });
}

async function handleLogout(payload: AuthPayload) {
  if (payload.session_token) {
    const tokenHash = await sha256Hex(payload.session_token);
    await revokeSession(tokenHash);
  }
  return jsonResponse({ ok: true });
}

async function maybeCreateSession(staff: StaffRow, remember: boolean) {
  if (!remember) return null;
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await insertRows("ra_auth_sessions", [{
    staff_id: staff.staff_id,
    email: staff.email,
    token_hash: tokenHash,
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: expires.toISOString(),
  }]);
  return { token, rememberUntil: expires.toISOString() };
}

async function assertSetupCode(setupCode: string, consume: boolean) {
  const codeHash = await sha256Hex(setupCode);
  const code = await selectOne("ra_setup_codes", `code_hash=eq.${codeHash}&select=*`);
  const now = new Date();
  if (!code || code.revoked_at || (code.expires_at && now > new Date(code.expires_at))) {
    throw new Error("VALIDATION: 설정 코드가 올바르지 않거나 만료되었습니다.");
  }
  if (code.max_uses !== null && code.max_uses !== undefined && Number(code.use_count || 0) >= Number(code.max_uses)) {
    throw new Error("VALIDATION: 설정 코드 사용 한도를 초과했습니다.");
  }
  if (consume) {
    await patchRows("ra_setup_codes", `code_hash=eq.${codeHash}`, {
      use_count: Number(code.use_count || 0) + 1,
      last_used_at: now.toISOString(),
    });
  }
}

async function findActiveStaff(email: string): Promise<StaffRow> {
  const staff = await selectOne("staff", `email=ilike.${encodeURIComponent(email)}&select=staff_id,employee_no,name,email,status`);
  if (!staff || staff.status !== "active") throw new Error("VALIDATION: 등록된 재직자 이메일만 사용할 수 있습니다.");
  return staff as StaffRow;
}

async function findActiveStaffById(staffId: string): Promise<StaffRow> {
  const staff = await selectOne("staff", `staff_id=eq.${encodeURIComponent(staffId)}&select=staff_id,employee_no,name,email,status`);
  if (!staff || staff.status !== "active") throw new Error("VALIDATION: 등록된 재직자 이메일만 사용할 수 있습니다.");
  return staff as StaffRow;
}

async function upsertCredential(staff: StaffRow, passwordHash: string, salt: string) {
  await postgrest("ra_user_credentials", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{
      staff_id: staff.staff_id,
      email: normalizeEmail(staff.email),
      password_hash: passwordHash,
      password_salt: salt,
      hash_algo: PASSWORD_ALGO,
      hash_iterations: PASSWORD_ITERATIONS,
      password_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]),
    query: "on_conflict=staff_id",
  });
}

async function selectOne(table: string, query: string) {
  const rows = await postgrest(table, { method: "GET", query });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function insertRows(table: string, rows: unknown[]) {
  return await postgrest(table, { method: "POST", body: JSON.stringify(rows) });
}

async function patchRows(table: string, filter: string, body: Record<string, unknown>) {
  return await postgrest(table, {
    method: "PATCH",
    query: filter,
    body: JSON.stringify(body),
  });
}

async function revokeSession(tokenHash: string) {
  await patchRows("ra_auth_sessions", `token_hash=eq.${tokenHash}`, { revoked_at: new Date().toISOString() });
}

async function postgrest(table: string, init: { method: string; query?: string; headers?: HeadersInit; body?: string }) {
  const url = `${requireEnv("SUPABASE_URL")}/rest/v1/${table}${init.query ? `?${init.query}` : ""}`;
  const key = getSupabaseKey();
  const response = await fetch(url, {
    method: init.method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init.headers,
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
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function publicUser(staff: StaffRow) {
  return {
    staff_id: staff.staff_id,
    employee_no: staff.employee_no || null,
    name: staff.name,
    email: normalizeEmail(staff.email),
  };
}

function normalizeEmail(email?: string) {
  return String(email || "").trim().toLowerCase();
}

function assertCompanyEmail(email: string) {
  if (!email.endsWith(`@${COMPANY_DOMAIN}`)) throw new Error("VALIDATION: 회사 이메일 계정만 사용할 수 있습니다.");
}

function requireText(value: unknown, message: string) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`VALIDATION: ${message}`);
  return text;
}

function requirePassword(value: unknown) {
  const password = String(value || "");
  if (password.length < 8) throw new Error("VALIDATION: 비밀번호는 8자 이상이어야 합니다.");
  return password;
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
      // Fall back below.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: utf8(salt), iterations: PASSWORD_ITERATIONS },
    key,
    256,
  );
  return base64(new Uint8Array(bits));
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", utf8(value.trim()));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes: number) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function base64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function timingSafeEqual(a: string, b: string) {
  const left = utf8(a);
  const right = utf8(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function daysBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
}
