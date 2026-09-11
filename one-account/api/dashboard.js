'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const auth = require('../lib/auth.cjs');
let cached;
function dashboardGzip() {
  const keyValue = process.env.ONE_ACCOUNT_DATA_KEY || '';
  const key = Buffer.from(keyValue, 'base64url');
  if (key.length !== 32) throw new Error('DATA_NOT_CONFIGURED');
  if (cached?.keyValue === keyValue) return cached.data;
  const file = fs.readFileSync(path.join(process.cwd(), 'private', 'dashboard.enc'));
  if (file.subarray(0, 4).toString('ascii') !== 'OAG1' || file.length < 33) throw new Error('BAD_PAYLOAD');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, file.subarray(4, 16));
  decipher.setAAD(Buffer.from('one-account-dashboard:v1'));
  decipher.setAuthTag(file.subarray(16, 32));
  const data = Buffer.concat([decipher.update(file.subarray(32)), decipher.final()]);
  cached = { keyValue, data };
  return data;
}
function supportsGzip(value) {
  return String(value || '').split(',').some(part => /^gzip(?:\s*;|\s*$)/i.test(part.trim()) && !/;\s*q=0(?:\.0*)?\s*$/i.test(part));
}
module.exports = async function handler(req, res) {
  auth.noStore(res);
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return auth.json(res, 405, { message: '허용되지 않은 요청입니다.' }); }
  try {
    if (!auth.readSession(req)) return auth.json(res, 401, { message: '로그인이 필요합니다.' });
    const data = dashboardGzip();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (supportsGzip(req.headers['accept-encoding'])) {
      res.setHeader('Content-Encoding', 'gzip');
      res.writeHead(200);
      return res.end(req.method === 'HEAD' ? undefined : data);
    }
    res.writeHead(200);
    if (req.method === 'HEAD') return res.end();
    // Stream the uncompressed 9.5 MB document instead of buffering a platform response.
    res.flushHeaders();
    await pipeline(Readable.from([data]), zlib.createGunzip(), res);
  } catch {
    if (!res.headersSent) return auth.json(res, 503, { message: '대시보드를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.' });
    res.destroy();
  }
};
