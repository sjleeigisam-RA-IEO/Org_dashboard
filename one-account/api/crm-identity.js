'use strict';
const crypto = require('node:crypto');
const auth = require('../lib/auth.cjs');
const shared = require('../lib/shared-db.cjs');
const identity = require('../lib/crm-identity.cjs');
const mail = require('../lib/mail.cjs');
function createHandler({ rpc = shared.rpc, send = mail.sendVerification, enabled = mail.verificationEnabled } = {}) {
  return async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' }); }
    try {
      const session = auth.readSession(req);
      if (!session) { identity.clearCookies(res); return auth.json(res, 401, { message: '다시 로그인해 주세요.' }); }
      if (req.method === 'GET') {
        const view = await identity.status(req, session, rpc);
        if (!view.identityVerified) identity.clearProof(res);
        return auth.json(res, 200, view);
      }
      if (!req.headers.origin || !auth.sameOrigin(req)) return auth.json(res, 403, { message: 'One Account 화면에서 본인 인증을 진행해 주세요.' });
      let body;
      try {
        body = await auth.readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || !['request-code', 'verify', 'lock'].includes(body.action) || Object.keys(body).some(k => !['action', 'code'].includes(k)) || (body.action === 'verify' ? !/^\d{6}$/.test(body.code) || typeof body.code !== 'string' : body.code !== undefined)) throw new Error('BAD_BODY');
      } catch { return auth.json(res, 400, { message: '인증 요청과 6자리 인증번호를 확인해 주세요.' }); }
      const sessionBinding = identity.binding(req);
      if (body.action === 'lock') {
        const credentials = identity.proof(req);
        identity.clearCookies(res);
        if (credentials) await rpc('oa_crm_identity', { p_action: 'revoke', p_args: { proof_digest: credentials.p_proof_digest, session_binding: sessionBinding } });
        const challengeId = identity.challenge(req);
        if (challengeId) await rpc('oa_crm_identity', { p_action: 'cancel', p_args: { challenge_id: challengeId, session_binding: sessionBinding } });
        return auth.json(res, 200, identity.unverified(session));
      }
      if (body.action === 'request-code') {
        if (!enabled()) return auth.json(res, 503, { message: '인증메일 발송 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.' });
        const challengeId = crypto.randomUUID(), code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const args = { challenge_id: challengeId, email: session.email, session_binding: sessionBinding, ip_digest: identity.ipDigest(req), code_digest: identity.codeDigest(challengeId, sessionBinding, code), parent_expires_at: new Date(session.exp * 1000).toISOString() };
        const reserved = await rpc('oa_crm_identity', { p_action: 'start', p_args: args });
        if (reserved.status === 'rate_limited') {
          const retry = Number.isSafeInteger(reserved.retry_after) ? Math.max(1, Math.min(3600, reserved.retry_after)) : 60;
          res.setHeader('Retry-After', String(retry));
          return auth.json(res, 429, { message: '인증메일 요청이 많습니다. 잠시 후 다시 요청해 주세요.', retryAfterSeconds: retry });
        }
        if (reserved.status === 'denied') return auth.json(res, 403, { message: '현재 계정에는 상세정보 편집 권한이 부여되지 않았습니다.', code: 'CRM_PERMISSION_DENIED' });
        if (reserved.status !== 'pending') throw new Error('IDENTITY_RESPONSE_INVALID');
        try {
          await send(session.email, code);
          const marked = await rpc('oa_crm_identity', { p_action: 'mark_sent', p_args: { challenge_id: challengeId, session_binding: sessionBinding } });
          if (marked.status !== 'sent') throw new Error('IDENTITY_RESPONSE_INVALID');
        } catch {
          try { await rpc('oa_crm_identity', { p_action: 'cancel', p_args: { challenge_id: challengeId, session_binding: sessionBinding } }); } catch { /* pending challenges cannot be verified */ }
          identity.clearChallenge(res);
          return auth.json(res, 502, { message: '인증메일을 발송하지 못했습니다. 1분 후 다시 요청해 주세요.', retryAfterSeconds: 60 });
        }
        identity.setCookie(res, identity.CHALLENGE_COOKIE, challengeId, Math.min(600, session.exp - Math.floor(Date.now() / 1000)));
        return auth.json(res, 200, { email: session.email, retryAfterSeconds: 60, codeExpiresAt: reserved.expires_at, message: '회사메일로 인증번호를 발송했습니다. 수신한 6자리 번호를 입력해 주세요.' });
      }
      const challengeId = identity.challenge(req);
      if (!challengeId) return auth.json(res, 400, { message: '인증번호를 먼저 요청해 주세요.' });
      const token = crypto.randomBytes(32).toString('base64url');
      const raw = await rpc('oa_crm_identity', { p_action: 'verify', p_args: { challenge_id: challengeId, session_binding: sessionBinding, code_digest: identity.codeDigest(challengeId, sessionBinding, body.code), proof_digest: identity.proofDigest(token) } });
      const view = identity.verified(raw, session);
      if (!view) {
        if (raw.status !== 'invalid_code') identity.clearChallenge(res);
        return auth.json(res, raw.status === 'denied' ? 403 : 400, { code: 'CRM_VERIFICATION_FAILED', message: raw.status === 'invalid_code' ? '인증번호가 일치하지 않습니다. 다시 확인해 주세요.' : raw.status === 'denied' ? '현재 계정에는 편집 권한이 없습니다.' : '인증번호가 만료되었거나 사용되었습니다. 새 번호를 요청해 주세요.' });
      }
      identity.clearChallenge(res);
      identity.setCookie(res, identity.COOKIE, token, (Date.parse(view.verifiedUntil) - Date.now()) / 1000);
      return auth.json(res, 200, view);
    } catch {
      return auth.json(res, 503, { message: '본인 인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
