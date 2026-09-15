'use strict';
const auth = require('../lib/auth.cjs');
const shared = require('../lib/shared-db.cjs');
const account = require('../lib/account-db.cjs');
const identity = require('../lib/crm-identity.cjs');
function createHandler({ rpc = shared.rpc } = {}) {
  return async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' }); }
    try {
      const session = auth.readSession(req);
      if (!session) return auth.json(res, 401, { message: '로그인이 필요합니다. 다시 로그인해 주세요.' });
      if (req.method === 'GET') {
        let query;
        try { query = account.readQuery(req.url); } catch { return auth.json(res, 400, { message: '어카운트와 조회 조건을 확인해 주세요.' }); }
        if (query.p_action === 'metadata' && identity.proof(req)) {
          if ((await identity.status(req, session, rpc)).identityVerified) return auth.json(res, 200, account.view(await rpc('oa_account_verified_read', { p_account_id: query.p_account_id, ...identity.proof(req) }), 'metadata'));
          identity.clearProof(res);
        }
        return auth.json(res, 200, account.view(await rpc('oa_account_read', query), query.p_action));
      }
      if (!req.headers.origin || !auth.sameOrigin(req)) return auth.json(res, 403, { message: 'One Account 화면에서 다시 저장해 주세요.' });
      let body;
      try { body = account.commitBody(await auth.readBody(req, 65536)); } catch { return auth.json(res, 400, { message: '입력값과 저장 요청을 확인해 주세요.' }); }
      let raw;
      if (body.action === 'save-team') {
        raw = await rpc('oa_account_save_team', { p_dataset_id: shared.DATASET_ID, p_account_id: body.accountId, p_expected_revision: body.expectedRevision, p_patch: body.patch, p_note: body.note, p_request_id: body.requestId, p_actor_email: session.email });
      } else {
        const credentials = identity.proof(req);
        if (!credentials || !(await identity.status(req, session, rpc)).identityVerified) { identity.clearProof(res); return auth.json(res, 403, identity.denied()); }
        raw = await rpc('oa_account_verified_commit', { p_action: body.action, p_account_id: body.accountId, p_expected_revision: body.expectedRevision ?? 0, p_patch: body.patch, p_request_id: body.requestId, ...credentials });
      }
      const result = account.view(raw, body.action);
      return auth.json(res, result.status === 'conflict' ? 409 : 200, result);
    } catch (error) {
      if (error.dbCode === '42501') { identity.clearProof(res); return auth.json(res, 403, identity.denied()); }
      if (['22023', '22P02', '23514', '23502', '23503', '22007', '22008', '22001', '23505'].includes(error.dbCode)) return auth.json(res, 400, { message: '어카운트, RM 역할 및 입력값을 확인해 주세요.' });
      if (error.dbCode === 'P0002') return auth.json(res, 404, { message: '요청한 어카운트가 없습니다.' });
      return auth.json(res, 503, { message: '공용 DB에 연결하지 못했습니다. 입력 내용을 보관한 뒤 다시 시도해 주세요.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
