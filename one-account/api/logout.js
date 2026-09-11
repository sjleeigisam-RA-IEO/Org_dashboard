'use strict';
const auth = require('../lib/auth.cjs');
module.exports = function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return auth.json(res, 405, { message: '로그아웃 버튼을 이용해 주세요.' }); }
  if (!auth.sameOrigin(req)) return auth.json(res, 403, { message: '허용되지 않은 요청입니다.' });
  auth.clearSession(res);
  auth.noStore(res);
  res.writeHead(303, { Location: '/' });
  res.end();
};
