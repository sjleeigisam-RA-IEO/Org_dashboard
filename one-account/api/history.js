'use strict';
const auth = require('../lib/auth.cjs');
const db = require('../lib/shared-db.cjs');
function createHandler({ rpc = db.rpc } = {}) {
  return async function handler(req,res) {
    if (req.method !== 'GET') { res.setHeader('Allow','GET'); return auth.json(res,405,{ message:'허용되지 않은 요청입니다.' }); }
    try {
      if (!auth.readSession(req)) return auth.json(res,401,{ message:'로그인이 필요합니다.' });
      const params = new URL(req.url,'https://localhost').searchParams;
      const beforeText = params.get('before'), limitText = params.get('limit');
      const before = beforeText === null ? null : Number(beforeText), limit = limitText === null ? 20 : Number(limitText);
      if (!db.positiveInt(limit) || limit > 50 || (before !== null && (!/^[1-9]\d*$/.test(beforeText) || !db.positiveInt(before)))) return auth.json(res,400,{ message:'이력 조회 범위를 확인해 주세요.' });
      const raw = await rpc('oa_get_history',{p_dataset_id:db.DATASET_ID,p_limit:limit,p_before_revision:before});
      return auth.json(res,200,db.historyView(raw));
    } catch { return auth.json(res,503,{ message:'변경 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
  };
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
