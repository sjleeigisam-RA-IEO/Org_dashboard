import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(
  repoRoot,
  'CRM_base',
  'migrations',
  '2026-08-14_party_commitment_year_contract.sql',
);
const outputDir = path.join(repoRoot, 'outputs', 'party_classification_clean_contract');

function parseEnv(text) {
  return Object.fromEntries(
    text.replace(/^\uFEFF/, '').split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      }),
  );
}

const env = parseEnv(await fs.readFile(path.join(repoRoot, '.env'), 'utf8'));
if (!env.SUPABASE_URL || !env.SUPABASE_TOKEN) {
  throw new Error('SUPABASE_URL or SUPABASE_TOKEN is missing from .env');
}

const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0];
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) {
    throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

const apply = process.argv.includes('--apply');
const migrationSql = (await fs.readFile(migrationPath, 'utf8')).replace(/^\uFEFF/, '');
const verificationSql = `
  select *
  from public.party_exposure_commitment_contract_audit
  order by role_type;
`;
const sql = apply
  ? migrationSql
  : migrationSql.replace(/commit;\s*$/i, `${verificationSql}\nrollback;`);
const startedAt = new Date().toISOString();
const executionResult = await query(sql);
const verification = apply ? await query(verificationSql) : executionResult;

const report = {
  mode: apply ? 'apply' : 'rollback-dry-run',
  startedAt,
  completedAt: new Date().toISOString(),
  projectRef,
  migrationPath,
  migrationSha256: crypto.createHash('sha256').update(migrationSql, 'utf8').digest('hex'),
  verification,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, apply ? 'commitment_year_apply_result.json' : 'commitment_year_dry_run_result.json'),
  JSON.stringify(report, null, 2),
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
