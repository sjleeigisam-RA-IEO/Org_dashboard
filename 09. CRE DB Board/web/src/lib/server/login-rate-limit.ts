import type { AuthSqlExecutor } from "@/lib/server/email-allowlist";

const encoder = new TextEncoder();

const CONSUME = `
WITH requested_keys AS (
  SELECT DISTINCT rate_limit_key
  FROM (VALUES ($1::text), ($2::text)) AS supplied(rate_limit_key)
), pruned AS (
  DELETE FROM app_security.dashboard_login_rate_limits
  WHERE updated_at < clock_timestamp() - interval '7 days'
  RETURNING 1
), prune_status AS (
  SELECT count(*) AS pruned_count FROM pruned
), upserted AS (
  INSERT INTO app_security.dashboard_login_rate_limits(
    rate_limit_key,window_started_at,attempt_count,blocked_until,updated_at
  )
  SELECT rate_limit_key,clock_timestamp(),1,NULL,clock_timestamp()
  FROM requested_keys CROSS JOIN prune_status
  ON CONFLICT(rate_limit_key) DO UPDATE SET
    window_started_at=CASE WHEN dashboard_login_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE dashboard_login_rate_limits.window_started_at END,
    attempt_count=CASE WHEN dashboard_login_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN 1 ELSE dashboard_login_rate_limits.attempt_count+1 END,
    blocked_until=CASE
      WHEN dashboard_login_rate_limits.blocked_until>clock_timestamp() THEN dashboard_login_rate_limits.blocked_until
      WHEN dashboard_login_rate_limits.window_started_at<clock_timestamp()-interval '15 minutes' THEN NULL
      WHEN dashboard_login_rate_limits.attempt_count+1>=10 THEN clock_timestamp()+interval '15 minutes'
      ELSE NULL END,
    updated_at=clock_timestamp()
  RETURNING blocked_until>clock_timestamp() AS blocked
)
SELECT coalesce(bool_or(blocked),FALSE) AS blocked FROM upserted`;

const CLEAR = `
WITH requested_keys AS (
  SELECT DISTINCT rate_limit_key
  FROM (VALUES ($1::text), ($2::text)) AS supplied(rate_limit_key)
)
DELETE FROM app_security.dashboard_login_rate_limits
WHERE rate_limit_key IN (SELECT rate_limit_key FROM requested_keys)`;

export async function loginRateLimitKeys(request: Request, sessionSecret: string, email: string) {
  const forwarded = (request.headers.get("x-vercel-forwarded-for") ?? "").split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim()
    || "unknown";
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const values = [`login-ip:${forwarded}`, `login-account:${email || "invalid"}`];
  return Promise.all(values.map(async (value) => Buffer.from(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  ).toString("base64url")));
}

function normalizedKeyPair(keys: readonly string[]): [string, string] | null {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return null;
  return [unique[0], unique[1] ?? unique[0]];
}

export async function consumeLoginAttempts(execute: AuthSqlExecutor, keys: readonly string[]) {
  const pair = normalizedKeyPair(keys);
  if (!pair) return false;
  const result = await execute(CONSUME, pair);
  return result.rows[0]?.blocked === true;
}

export async function clearLoginAttempts(execute: AuthSqlExecutor, keys: readonly string[]) {
  const pair = normalizedKeyPair(keys);
  if (!pair) return;
  await execute(CLEAR, pair);
}
