'use strict';
const crypto = require('node:crypto');
const COOKIE = '__Host-one_account_session';
const NORMAL_SECONDS = 8 * 60 * 60;
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
const PAIR_FAILURE_LIMIT = 8;
const IP_FAILURE_LIMIT = 40;
// Best-effort per-instance throttling: counters are not shared across Vercel instances.
const failures = new Map();

function config() {
  const code = process.env.ONE_ACCOUNT_CODE_SCRYPT || '';
  const secret = process.env.ONE_ACCOUNT_SESSION_SECRET || '';
  if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(code) || secret.length < 43) {
    throw new Error('AUTH_NOT_CONFIGURED');
  }
  return { code, key: crypto.createHmac('sha256', secret).update(code).digest() };
}
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  const local = email.split('@')[0];
  return /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@igisam\.com$/.test(email) && !local.includes('..') ? email : null;
}
function validCode(code, stored) {
  if (typeof code !== 'string' || code.length > 256) return false;
  const [, salt, hash] = stored.split(':');
  const actual = crypto.scryptSync(code, Buffer.from(salt, 'hex'), 32);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie, Accept-Encoding');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function json(res, status, body) {
  noStore(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function sign(payload, key) { return crypto.createHmac('sha256', key).update(payload).digest('base64url'); }
function makeSession(email, rememberMe, key, now = Math.floor(Date.now() / 1000)) {
  const duration = rememberMe ? REMEMBER_SECONDS : NORMAL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ v: 1, email, remember: rememberMe, iat: now, exp: now + duration })).toString('base64url');
  return { token: payload + '.' + sign(payload, key), expiresAt: now + duration, duration };
}
function verifySession(token, key, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  const expected = Buffer.from(sign(parts[0], key), 'base64url');
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (data.v !== 1 || !emailAddress(data.email) || typeof data.remember !== 'boolean') return null;
    if (!Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp) || data.iat > now + 60 || data.exp <= now) return null;
    const maxDuration = data.remember ? REMEMBER_SECONDS : NORMAL_SECONDS;
    if (data.exp <= data.iat || data.exp - data.iat > maxDuration) return null;
    return data;
  } catch { return null; }
}
function readSession(req) {
  const { key } = config();
  const cookie = String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(COOKIE + '='));
  if (cookie.length !== 1) return null;
  return verifySession(cookie[0].slice(COOKIE.length + 1), key);
}
function setSession(res, session, rememberMe) {
  let cookie = `${COOKIE}=${session.token}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (rememberMe) cookie += `; Max-Age=${session.duration}; Expires=${new Date(session.expiresAt * 1000).toUTCString()}`;
  res.setHeader('Set-Cookie', cookie);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return origin.host === req.headers.host && (origin.protocol === 'https:' || (origin.protocol === 'http:' && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin.host)));
  } catch { return false; }
}
async function readBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('BAD_BODY');
  if (Number(req.headers['content-length'] || 0) > 4096) throw new Error('BAD_BODY');
  if (req.body !== undefined) {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > 4096) throw new Error('BAD_BODY');
    return JSON.parse(raw);
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 4096) throw new Error('BAD_BODY');
  }
  return JSON.parse(raw);
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
function failureKey(req, email) {
  return 'pair:' + crypto.createHash('sha256').update(clientIp(req) + ':' + String(email || '').toLowerCase()).digest('hex');
}
function ipFailureKey(req) {
  return 'ip:' + crypto.createHash('sha256').update(clientIp(req)).digest('hex');
}
function isLimited(key, limit = PAIR_FAILURE_LIMIT, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || entry.until <= now) { failures.delete(key); return false; }
  return entry.count >= limit;
}
function recordFailure(key, now = Date.now()) {
  if (failures.size > 2048) failures.delete(failures.keys().next().value);
  let entry = failures.get(key);
  if (!entry || entry.until <= now) entry = { count: 0, until: now + 15 * 60 * 1000 };
  entry.count += 1;
  failures.set(key, entry);
}
function resetFailures(key) { failures.delete(key); }
module.exports = { COOKIE, NORMAL_SECONDS, REMEMBER_SECONDS, PAIR_FAILURE_LIMIT, IP_FAILURE_LIMIT, config, emailAddress, validCode, noStore, json, makeSession, verifySession, readSession, setSession, clearSession, sameOrigin, readBody, failureKey, ipFailureKey, isLimited, recordFailure, resetFailures };
