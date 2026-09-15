'use strict';
const auth = require('../lib/auth.cjs');
const shared = require('../lib/shared-db.cjs');
const crm = require('../lib/crm-db.cjs');
const privacy = require('../lib/crm-privacy.cjs');
const identity = require('../lib/crm-identity.cjs');
function createHandler({ rpc = shared.rpc } = {}) {
  return async function handler(req, res) {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' }); }
    try {
      const session = auth.readSession(req);
      if (!session) return auth.json(res, 401, { message: '로그인이 필요합니다. 다시 로그인해 주세요.' });
      if (req.method === 'GET') {
        let query;
        try { query = crm.readQuery(req.url); } catch { return auth.json(res, 400, { message: '조회 조건을 확인해 주세요.' }); }
        if (query.p_action === 'person' && identity.proof(req)) {
          const access = await identity.status(req, session, rpc);
          if (access.identityVerified) {
            const view = crm.readView(await rpc('oa_crm_verified_read', { ...query, ...identity.proof(req) }), 'person');
            return auth.json(res, 200, { ...view, privacy: { detailAccess: 'verified', identityVerified: true, canEdit: true, verifiedUntil: access.verifiedUntil } });
          }
          identity.clearProof(res);
        }
        const view = crm.readView(await rpc('oa_crm_read', query), query.p_action);
        return auth.json(res, 200, privacy.projectRead(view, query.p_action));
      }
      if (!req.headers.origin || !auth.sameOrigin(req)) return auth.json(res, 403, { message: 'One Account 화면에서 다시 저장해 주세요.' });
      const credentials = identity.proof(req);
      if (!credentials || !(await identity.status(req, session, rpc)).identityVerified) {
        identity.clearProof(res);
        return auth.json(res, 403, identity.denied());
      }
      let body;
      try { body = crm.commitBody(await auth.readBody(req, 65536)); } catch { return auth.json(res, 400, { message: '입력값과 저장 요청을 확인해 주세요.' }); }
      const view = crm.mutationView(await rpc('oa_crm_verified_commit', {
        p_action: body.action, p_entity: body.entity, p_id: body.id, p_expected_revision: body.expectedRevision,
        p_patch: body.patch, p_request_id: body.requestId, ...credentials,
      }));
      return auth.json(res, view.status === 'conflict' ? 409 : 200, view);
    } catch (error) {
      if (error.dbCode === '42501') { identity.clearProof(res); return auth.json(res, 403, identity.denied()); }
      if (['22023', '22P02', '23514', '23502', '23503', '22007', '22008', '22001', '23505'].includes(error.dbCode)) return auth.json(res, 400, { message: '소속, 날짜, 상태 및 입력값을 확인해 주세요.' });
      if (error.dbCode === 'P0002') return auth.json(res, 404, { message: '요청한 인물 또는 어카운트가 없습니다.' });
      return auth.json(res, 503, { message: '고객 DB에 연결하지 못했습니다. 입력 내용을 보관한 뒤 다시 시도해 주세요.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
