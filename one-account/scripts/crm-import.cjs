'use strict';
// Operator-only import. Local input contains personal data and must remain ignored.
// Never print a provider error body: it can contain rejected source cell values.
const fs = require('node:fs');
const [envPath, payloadPath, actor, mode] = process.argv.slice(2);
if (!envPath || !payloadPath || !/^[a-z0-9._%+-]+@igisam\.com$/.test(actor || '')) {
  console.error('Usage: node scripts/crm-import.cjs <workspace.env> <private-payload.json> <operator-company-email>');
  process.exitCode = 1;
} else {
  (async () => {
    const env = {};
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][\w]*)=(.*)$/);
      if (match) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
    const url = env.SUPABASE_URL || env.ONE_ACCOUNT_SUPABASE_URL;
    const key = env.SUPABASE_SECRET_KEY || env.ONE_ACCOUNT_SUPABASE_SECRET_KEY;
    if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || '') || !key?.startsWith('sb_secret_')) throw new Error('CONFIG_INVALID');
    const original = JSON.parse(fs.readFileSync(payloadPath, 'utf8').replace(/^\uFEFF/, ''));
    const collections = ['sources','source_records','accounts','persons','affiliations','contact_points','gift_campaigns','gift_items','gift_recipients','receiving_preferences','life_events','field_claims'];
    const payloads = [];
    if (mode === '--chunked') {
      let part = 0;
      for (const collection of collections) {
        let rows = [], bytes = 0;
        const flush = () => {
          if (!rows.length) return;
          payloads.push({ schema_version: 1, batch_id: original.batch_id + '-part-' + String(++part).padStart(3, '0'), manifest_sha256: original.manifest_sha256, [collection]: rows });
          rows = []; bytes = 0;
        };
        for (const row of original[collection] || []) {
          const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
          // Self-referencing account anchors must be inserted in one statement.
          if (collection !== 'accounts' && bytes + size > 750000) flush();
          rows.push(row); bytes += size;
        }
        flush();
      }
      payloads.push({ schema_version: 1, batch_id: original.batch_id, manifest_sha256: original.manifest_sha256, completed_parts: part, expected_counts: Object.fromEntries(collections.map(k => [k, (original[k] || []).length])) });
    } else payloads.push(original);
    for (const payload of payloads) {
    const management = mode === '--management';
    const ref = new URL(url).hostname.split('.')[0];
    if (management && !env.SUPABASE_TOKEN) throw new Error('CONFIG_INVALID');
    const query = management ? "begin; set local statement_timeout='120s'; select public.oa_crm_import('" + JSON.stringify(payload).replace(/'/g, "''") + "'::jsonb,'" + actor + "') as result; commit;" : null;
    const response = await fetch(management ? `https://api.supabase.com/v1/projects/${ref}/database/query` : `${url.replace(/\/$/, '')}/rest/v1/rpc/oa_crm_import`, {
      method: 'POST', headers: { ...(management ? { Authorization: `Bearer ${env.SUPABASE_TOKEN}` } : { apikey: key }), 'Content-Type': 'application/json' },
      body: JSON.stringify(management ? { query } : { p_payload: payload, p_actor_email: actor }), signal: AbortSignal.timeout(150000),
    });
    const raw = await response.json().catch(() => null);
    const result = management && response.ok ? raw?.[0]?.result : raw;
    if (!response.ok) {
      console.error(JSON.stringify({ status: 'failed', http: response.status, dbCode: /^[A-Z0-9]{5,10}$/.test(result?.code || '') ? result.code : 'UNAVAILABLE' }));
      process.exitCode = 1; return;
    }
    if (!['imported', 'replayed'].includes(result?.status) || result.batch_id !== payload.batch_id) throw new Error('INVALID_RESULT');
    console.log(JSON.stringify({ status: result.status, batch_id: result.batch_id, counts: Object.fromEntries(Object.entries(result.counts || {}).filter(([, value]) => value > 0)) }));
    }
  })().catch(error => { console.error(JSON.stringify({ status: 'uncertain', errorType: error.name })); process.exitCode = 1; });
}
