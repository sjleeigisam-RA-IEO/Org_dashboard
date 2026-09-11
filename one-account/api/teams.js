'use strict';
const auth = require('../lib/auth.cjs');
const db = require('../lib/shared-db.cjs');
function createHandler({ rpc = db.rpc } = {}) {
  return async function handler(req, res) {
    if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow','GET, POST'); return auth.json(res,405,{ message:'허용되지 않은 요청입니다.' }); }
    try {
      const session = auth.readSession(req);
      if (!session) return auth.json(res,401,{ message:'로그인이 필요합니다. 다시 로그인해 주세요.' });
      if (req.method === 'GET') {
        const value = new URL(req.url,'https://localhost').searchParams.get('revision');
        const revision = value === null ? null : Number(value);
        if (revision !== null && (!/^[1-9]\d*$/.test(value) || !db.positiveInt(revision))) return auth.json(res,400,{ message:'버전 번호를 확인해 주세요.' });
        const raw = await rpc('oa_get_state',{ p_dataset_id: db.DATASET_ID, p_revision: revision });
        return auth.json(res,200,db.stateView(raw,session.email));
      }
      if (!req.headers.origin || !auth.sameOrigin(req)) return auth.json(res,403,{ message:'One Account 화면에서 다시 저장해 주세요.' });
      let body;
      try { body = db.commitBody(await db.readJson(req)); } catch { return auth.json(res,400,{ message:'저장할 배정과 버전 정보를 확인해 주세요.' }); }
      const raw = await rpc('oa_commit_state',{
        p_dataset_id: db.DATASET_ID, p_expected_revision: body.expected, p_assignments: body.assignments,
        p_actor_email: session.email, p_request_id: body.requestId, p_note: body.note, p_restore_revision: body.restore,
      });
      return auth.json(res,raw.status === 'conflict' ? 409 : 200,db.stateView(raw,session.email));
    } catch (error) {
      if (error.dbCode === '22023') return auth.json(res,400,{ message:'허용된 Account·RM·역할인지 확인해 주세요.' });
      if (error.dbCode === 'P0002') return auth.json(res,404,{ message:'요청한 데이터 또는 버전이 없습니다.' });
      return auth.json(res,503,{ message:'공용 DB 연결을 확인하지 못했습니다. 작업 중인 수정본을 보관한 뒤 다시 시도해 주세요.' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
