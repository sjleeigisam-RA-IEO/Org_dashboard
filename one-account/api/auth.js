'use strict';
const auth = require('../lib/auth.cjs');
module.exports = async function handler(req, res) {
  try {
    const settings = auth.config();
    if (req.method === 'GET') {
      const session = auth.readSession(req);
      return auth.json(res, 200, session ? { authenticated: true, email: session.email, expiresAt: session.exp } : { authenticated: false });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' });
    }
    if (!auth.sameOrigin(req)) return auth.json(res, 403, { message: '이 페이지에서 다시 로그인해 주세요.' });
    let body;
    try { body = await auth.readBody(req); } catch { return auth.json(res, 400, { message: '회사메일과 배포코드를 확인해 주세요.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return auth.json(res, 400, { message: '입력값을 확인해 주세요.' });
    const email = auth.emailAddress(body.email);
    const key = auth.failureKey(req, email || 'invalid');
    const ipKey = auth.ipFailureKey(req);
    if (auth.isLimited(key) || auth.isLimited(ipKey, auth.IP_FAILURE_LIMIT)) {
      res.setHeader('Retry-After', '900');
      return auth.json(res, 429, { message: '로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.' });
    }
    const codeMatches = auth.validCode(body.code, settings.code);
    if (!email || !codeMatches) {
      auth.recordFailure(key);
      auth.recordFailure(ipKey);
      return auth.json(res, 401, { message: '회사메일 또는 배포코드가 올바르지 않습니다.' });
    }
    auth.resetFailures(key);
    // A successful coworker's login must not clear the shared IP's failure window.
    const rememberMe = body.rememberMe === true;
    const session = auth.makeSession(email, rememberMe, settings.key);
    auth.setSession(res, session, rememberMe);
    return auth.json(res, 200, { authenticated: true, expiresAt: session.expiresAt });
  } catch {
    return auth.json(res, 503, { message: '로그인 서비스 준비 중입니다. 잠시 후 다시 시도해 주세요.' });
  }
};
