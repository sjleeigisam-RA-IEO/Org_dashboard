'use strict';
const auth = require('../lib/auth.cjs');
const identity = require('../lib/crm-identity.cjs');
const shared = require('../lib/shared-db.cjs');
function createHandler({ rpc = shared.rpc } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return auth.json(res, 405, { message: '로그아웃 버튼을 이용해 주세요.' }); }
    if (!auth.sameOrigin(req)) return auth.json(res, 403, { message: '허용되지 않은 요청입니다.' });
    try {
      if (auth.readSession(req)) {
        const credentials = identity.proof(req);
        const challengeId = identity.challenge(req);
        if (credentials) {
          try { await rpc('oa_crm_identity', { p_action: 'revoke', p_args: { proof_digest: credentials.p_proof_digest, session_binding: credentials.p_session_binding } }); }
          catch { /* Browser cookies are cleared even when the DB is unavailable. */ }
        }
        if (challengeId) {
          try { await rpc('oa_crm_identity', { p_action: 'cancel', p_args: { challenge_id: challengeId, session_binding: identity.binding(req) } }); }
          catch { /* An expired or unavailable challenge cannot prevent local logout. */ }
        }
      }
    } catch { /* Missing/invalid base sessions must still be removable from this browser. */ }
    auth.clearSession(res);
    identity.clearCookies(res);
    auth.noStore(res);
    res.writeHead(303, { Location: '/' });
    res.end();
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
