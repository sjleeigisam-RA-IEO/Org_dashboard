import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(
  repoRoot,
  '01. RA Portal',
  'migrations',
  '2026-08-14_party_classification_clean_contract.sql',
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
const hash = crypto.createHash('sha256').update(migrationSql, 'utf8').digest('hex');
const sql = apply
  ? migrationSql
  : migrationSql.replace(/commit;\s*$/i, `
      select * from public.party_exposure_contract_audit;
      rollback;
    `);

const startedAt = new Date().toISOString();
const executionResult = await query(sql);
const verification = apply
  ? {
      audit: await query('select * from public.party_exposure_contract_audit;'),
      counts: await query(`
        select 'party_identity_map' as object_name, count(*)::bigint as row_count from public.party_identity_map
        union all select 'party_role_classifications', count(*) from public.party_role_classifications
        union all select 'party_groups', count(*) from public.party_groups
        union all select 'party_group_memberships', count(*) from public.party_group_memberships
        union all select 'party_external_identifiers', count(*) from public.party_external_identifiers
        union all select 'beneficiary_exposure_source_metadata', count(*) from public.beneficiary_exposure_source_metadata
        union all select 'lender_exposure_source_metadata', count(*) from public.lender_exposure_source_metadata;
      `),
      roleDistribution: await query(`
        select role_type, role_class,
               count(distinct party_id)::int as party_count,
               count(*)::int as exposure_count,
               coalesce(sum(committed_amt), 0)::bigint as committed_amt,
               coalesce(sum(primary_amount), 0)::bigint as primary_amount,
               coalesce(sum(remaining_amt), 0)::bigint as remaining_amt
        from public.party_exposure_current
        group by role_type, role_class
        order by role_type, role_class;
      `),
      legacyObjects: await query(`
        select n.nspname as schema_name, c.relname as object_name, c.relkind
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'beneficiary_category_dictionary', 'beneficiary_category_source_map',
            'beneficiary_classification_master', 'beneficiary_exposures_classified',
            'party_exposure_current_v1', 'party_exposure_analysis_fact_v1',
            'party_exposure_analysis_fact_v2', 'party_exposure_rankings_v1',
            'party_exposure_rankings_v2', 'party_exposure_facets_v1',
            'party_exposure_facets_v2'
          );
      `),
    }
  : { rollbackAudit: executionResult };

if (apply) await query(`notify pgrst, 'reload schema';`);

const report = {
  mode: apply ? 'apply' : 'rollback-dry-run',
  startedAt,
  completedAt: new Date().toISOString(),
  projectRef,
  migrationPath,
  migrationSha256: hash,
  migrationBytes: Buffer.byteLength(migrationSql, 'utf8'),
  verification,
};

await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, apply ? 'apply_result.json' : 'dry_run_result.json'),
  JSON.stringify(report, null, 2),
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
