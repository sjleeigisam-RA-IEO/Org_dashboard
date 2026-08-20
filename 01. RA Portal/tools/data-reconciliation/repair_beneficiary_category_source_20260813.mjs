import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
const backup = JSON.parse(await fs.readFile(path.join(outputDir, "beneficiary_exposures_preapply_backup.json"), "utf8"));
const envText = await fs.readFile(path.join(repoRoot, ".env"), "utf8");
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "")];
    }),
);
if (!env.SUPABASE_TOKEN || !env.SUPABASE_URL) throw new Error("Supabase management credentials are missing");
const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  return response.json();
}

const sourceSeed = backup.map((row) => ({ id: row.id, beneficiaryCatSource: row.beneficiary_cat ?? null }));
const seedText = JSON.stringify(sourceSeed);
if (seedText.includes("$beneficiary_source_backup$")) throw new Error("Unexpected SQL dollar tag in backup");
const seedSql = `$beneficiary_source_backup$${seedText}$beneficiary_source_backup$::jsonb`;
const repairSql = `begin;
alter table public.beneficiary_exposures disable trigger beneficiary_category_contract_trigger;
with source_backup as (
  select (item->>'id')::bigint as id, item->>'beneficiaryCatSource' as beneficiary_cat_source
  from jsonb_array_elements(${seedSql}) as item
)
update public.beneficiary_exposures as exposure
set beneficiary_cat_source = source_backup.beneficiary_cat_source
from source_backup
where source_backup.id = exposure.id;
alter table public.beneficiary_exposures enable trigger beneficiary_category_contract_trigger;
commit;
notify pgrst, 'reload schema';`;

const verificationSql = `with source_backup as (
  select (item->>'id')::bigint as id, item->>'beneficiaryCatSource' as beneficiary_cat_source
  from jsonb_array_elements(${seedSql}) as item
)
select
  count(*)::int as row_count,
  count(*) filter (where exposure.beneficiary_cat_source is null)::int as source_null_rows,
  count(*) filter (where exposure.beneficiary_cat_source is distinct from source_backup.beneficiary_cat_source)::int as source_mismatch_rows,
  count(*) filter (where exposure.beneficiary_class is null)::int as missing_class_rows
from public.beneficiary_exposures as exposure
join source_backup on source_backup.id = exposure.id;`;

await fs.writeFile(path.join(outputDir, "beneficiary_category_source_repair.sql"), repairSql, "utf8");
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ backupRows: backup.length, sourceNullRows: sourceSeed.filter((item) => item.beneficiaryCatSource === null).length }, null, 2));
} else {
  await query(repairSql);
  const verification = await query(verificationSql);
  if (Number(verification[0]?.row_count) !== backup.length || Number(verification[0]?.source_mismatch_rows) !== 0) {
    throw new Error(`Source repair verification failed: ${JSON.stringify(verification)}`);
  }
  await fs.writeFile(path.join(outputDir, "beneficiary_category_source_repair_verification.json"), JSON.stringify(verification, null, 2), "utf8");
  console.log(JSON.stringify(verification, null, 2));
}
