'use strict';
// Operator-only CLI: credentials are read from a supplied local env file, never Git.
const fs = require('node:fs');
const [envPath, sqlPath] = process.argv.slice(2);
if (!envPath || !sqlPath) throw new Error('Usage: node scripts/db-admin.cjs <workspace.env> <query.sql>');
const env = {};
for (const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][\w]*)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g,'');
}
const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
(async () => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method:'POST', headers:{Authorization:`Bearer ${env.SUPABASE_TOKEN}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:fs.readFileSync(sqlPath,'utf8')}), signal:AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) { console.error(JSON.stringify(result).slice(0,1500)); process.exitCode=1; return; }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error.name); process.exitCode=1; });
