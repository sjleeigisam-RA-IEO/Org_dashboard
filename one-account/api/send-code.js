'use strict';
const auth = require('../lib/auth.cjs');
const mail = require('../lib/mail.cjs');
const { createLimiter } = require('../lib/mail-limit.cjs');

function createHandler({ enabled = mail.enabled, send = mail.send, reserve = createLimiter(), now = Date.now } = {}) {
  return async function handler(req, res) {
    if (req.method === 'GET') return auth.json(res, 200, { enabled: enabled() });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' });
    }
    if (!req.headers.origin || !auth.sameOrigin(req)) return auth.json(res, 403, { message: '로그인 화면에서 다시 요청해 주세요.' });
    let body;
    try { body = await auth.readBody(req); } catch { return auth.json(res, 400, { message: '회사메일을 확인해 주세요.' }); }
    const email = auth.emailAddress(body && !Array.isArray(body) ? body.email : null);
    if (!email) return auth.json(res, 400, { message: '@igisam.com 회사메일을 입력해 주세요.' });
    if (!enabled()) return auth.json(res, 503, { message: '메일 발송 연결을 준비 중입니다. 안내받은 코드로 로그인해 주세요.' });
    const wait = reserve(req, email, now());
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      return auth.json(res, 429, { message: '발송 요청이 많습니다. 잠시 후 다시 시도해 주세요.', retryAfter: wait });
    }
    try {
      await send(email);
      return auth.json(res, 200, { message: '배포코드 메일 발송을 요청했습니다. 받은편지함과 스팸함을 확인해 주세요.', retryAfter: 60 });
    } catch {
      // Never expose SMTP errors, message contents, account credentials or codes.
      return auth.json(res, 502, { message: '메일 발송을 확인하지 못했습니다. 받은편지함을 확인한 뒤 잠시 후 다시 시도해 주세요.', retryAfter: 60 });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
