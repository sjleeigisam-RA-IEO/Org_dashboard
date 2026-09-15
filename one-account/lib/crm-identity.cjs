'use strict';
const crypto = require('node:crypto');
const auth = require('./auth.cjs');
const COOKIE = '__Host-one_account_identity';
const CHALLENGE_COOKIE = '__Host-one_account_challenge';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function cookie(req, name) {
  const matches = String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}
function hmac(purpose, value) { return crypto.createHmac('sha256', auth.config().key).update('one-account-crm:' + purpose + '\0' + value).digest('hex'); }
function binding(req) {
  const token = cookie(req, auth.COOKIE);
  if (!token) throw new Error('IDENTITY_REQUIRED');
  return hmac('session', token);
}
function ipDigest(req) {
  const ip = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  return hmac('ip', ip);
}
function codeDigest(challenge, sessionBinding, code) { return hmac('otp', challenge + '\0' + sessionBinding + '\0' + code); }
function proofDigest(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function proof(req) {
  const token = cookie(req, COOKIE);
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? { p_proof_digest: proofDigest(token), p_session_binding: binding(req) } : null;
}
function challenge(req) { const value = cookie(req, CHALLENGE_COOKIE); return typeof value === 'string' && UUID.test(value) ? value : null; }
function appendCookie(res, value) {
  const previous = res.getHeader?.('Set-Cookie') || res.headers?.['set-cookie'];
  res.setHeader('Set-Cookie', [...(Array.isArray(previous) ? previous : previous ? [previous] : []), value]);
}
function setCookie(res, name, value, seconds) {
  appendCookie(res, `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(seconds))}`);
}
function clearChallenge(res) { setCookie(res, CHALLENGE_COOKIE, '', 0); }
function clearProof(res) { setCookie(res, COOKIE, '', 0); }
function clearCookies(res) { clearProof(res); clearChallenge(res); }
function unverified(session) { return { email: session.email, identityVerified: false, verifiedUntil: null, canEdit: false }; }
function verified(raw, session) {
  const expires = Date.parse(raw?.expires_at);
  if (raw?.status !== 'verified' || raw.email !== session.email || raw.auth_method !== 'email_otp' || !Number.isFinite(expires) || expires <= Date.now() || expires > session.exp * 1000 + 1000) return null;
  return { email: session.email, identityVerified: true, verifiedUntil: new Date(expires).toISOString(), canEdit: true };
}
async function status(req, session, rpc) {
  const credentials = proof(req);
  if (!credentials) return unverified(session);
  const raw = await rpc('oa_crm_identity', { p_action: 'status', p_args: { proof_digest: credentials.p_proof_digest, session_binding: credentials.p_session_binding } });
  return verified(raw, session) || unverified(session);
}
function denied() { return { code: 'CRM_IDENTITY_VERIFICATION_REQUIRED', message: '회사메일 본인 인증 후 상세정보를 조회하고 저장할 수 있습니다.', privacy: { detailAccess: 'locked', identityVerified: false, canEdit: false } }; }
module.exports = { COOKIE, CHALLENGE_COOKIE, cookie, binding, ipDigest, codeDigest, proofDigest, proof, challenge, setCookie, clearProof, clearChallenge, clearCookies, unverified, verified, status, denied };
