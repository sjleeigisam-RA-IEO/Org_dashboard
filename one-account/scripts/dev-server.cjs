'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, '..');
process.chdir(base);
const routes = { '/api/send-code': require('../api/send-code.js'), '/api/auth': require('../api/auth.js'), '/api/logout': require('../api/logout.js'), '/api/app': require('../api/app.js'), '/app': require('../api/app.js'), '/api/dashboard': require('../api/dashboard.js') };
const publicFiles = { '/': ['index.html','text/html; charset=utf-8'], '/index.html': ['index.html','text/html; charset=utf-8'], '/login.css': ['login.css','text/css; charset=utf-8'], '/login.js': ['login.js','text/javascript; charset=utf-8'], '/session.js': ['session.js','text/javascript; charset=utf-8'] };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (routes[pathname]) return await routes[pathname](req, res);
    const file = publicFiles[pathname];
    if (file && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(path.join(base, 'public', file[0])).pipe(res);
    }
    res.writeHead(404); res.end('Not found');
  } catch { if (!res.headersSent) res.writeHead(500); res.end('Internal server error'); }
});
server.listen(Number(process.env.PORT || 5818), '127.0.0.1', () => console.log('One Account login preview at http://127.0.0.1:' + server.address().port));
