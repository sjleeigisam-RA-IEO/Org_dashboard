'use strict';
const auth = require('../lib/auth.cjs');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
module.exports = function handler(req, res) {
  auth.noStore(res);
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' }); }
  try {
    const session = auth.readSession(req);
    if (!session) { res.writeHead(302, { Location: '/' }); return res.end(); }
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-src 'self'; form-action 'self'; base-uri 'none'");
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.method === 'HEAD') return res.end();
    return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One Account</title><script src="/session.js" defer></script><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Arial,"Malgun Gothic",sans-serif}body{display:flex;flex-direction:column;background:#f3f5f8}header{flex:0 0 46px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;background:#0e223f;color:#fff;gap:12px}strong{font-size:13px;letter-spacing:.02em}.session{display:flex;align-items:center;gap:14px;font-size:12px}.email{max-width:48vw;overflow:hidden;text-overflow:ellipsis}button{cursor:pointer;border:1px solid #607089;color:white;background:transparent;padding:6px 12px;border-radius:5px;font:inherit}button:hover{background:#263d5a}button:focus-visible{outline:2px solid #a8d6ff;outline-offset:2px}form{margin:0}iframe{flex:1 1 auto;min-height:0;border:0;width:100%;background:#f3f5f8}</style></head><body><header><strong>ONE ACCOUNT</strong><div class="session"><span class="email">${escape(session.email)}</span><form method="post" action="/api/logout"><button type="submit">로그아웃</button></form></div></header><iframe src="/api/dashboard" title="One Account 대시보드"></iframe></body></html>`);
  } catch { return auth.json(res, 503, { message: '로그인 서비스 준비 중입니다.' }); }
};
