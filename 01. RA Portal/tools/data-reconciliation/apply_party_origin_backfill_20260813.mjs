import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(
  repoRoot,
  '01. RA Portal',
  'migrations',
  '2026-08-13_party_origin_unclassified_backfill.sql',
);
const outputDir = path.join(repoRoot, 'outputs', 'beneficiary_category_cleanup_20260813');

const env = Object.fromEntries(
  (await fs.readFile(path.join(repoRoot, '.env'), 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ''),
      ];
    }),
);

if (!env.SUPABASE_TOKEN || !env.SUPABASE_URL) {
  throw new Error('SUPABASE_TOKEN or SUPABASE_URL is missing from .env');
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

if (!process.argv.includes('--apply')) {
  throw new Error('This script changes live classifications. Re-run with --apply.');
}

const migrationSql = (await fs.readFile(migrationPath, 'utf8')).replace(/^\uFEFF/, '');
await query(migrationSql);

const [audit, distribution, gic, unclassified] = await Promise.all([
  query('select * from public.beneficiary_classification_backfill_audit;'),
  query(`
    select beneficiary_class,
           count(distinct public.normalize_beneficiary_key(
             coalesce(nullif(btrim(beneficiary_clean), ''), beneficiary_raw)
           ))::int as party_count,
           coalesce(sum(invested_amt), 0)::bigint as invested_amt
    from public.beneficiary_exposures
    group by beneficiary_class
    order by beneficiary_class;
  `),
  query(`
    select beneficiary_clean, beneficiary_cat, beneficiary_class,
           beneficiary_cat_basis, beneficiary_cat_review_status
    from public.beneficiary_exposures
    where public.normalize_beneficiary_key(coalesce(beneficiary_clean, beneficiary_raw))
      = public.normalize_beneficiary_key('GIC')
    order by id;
  `),
  query(`
    select distinct
           coalesce(nullif(btrim(beneficiary_clean), ''), beneficiary_raw) as beneficiary_name
    from public.beneficiary_exposures
    where beneficiary_class = '미분류'
    order by beneficiary_name;
  `),
]);

const check = audit[0];
if (
  !check
  || Number(check.target_party_count) !== 33
  || Number(check.resolved_target_party_count) !== 33
  || Number(check.remaining_unclassified_party_count) !== 5
  || check.remaining_unclassified_only_allowed !== true
  || check.gic_contract_valid !== true
  || check.origin_subtotals_match !== true
) {
  throw new Error(`Post-apply verification failed: ${JSON.stringify({ check, unclassified })}`);
}

const result = {
  appliedAt: new Date().toISOString(),
  projectRef,
  audit: check,
  distribution,
  gic,
  unclassified,
};
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, 'party_origin_backfill_postapply_verification.json'),
  JSON.stringify(result, null, 2),
  'utf8',
);
console.log(JSON.stringify(result, null, 2));
