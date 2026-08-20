import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
const migrationPath = path.join(repoRoot, "01. RA Portal", "migrations", "2026-08-13_beneficiary_category_contract.sql");
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

if (!env.SUPABASE_TOKEN || !env.SUPABASE_URL) {
  throw new Error("SUPABASE_TOKEN or SUPABASE_URL is missing from .env");
}

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

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

const dryRunSql = await fs.readFile(path.join(outputDir, "beneficiary_category_dry_run.sql"), "utf8");
const dryRun = await query(dryRunSql);
await fs.writeFile(path.join(outputDir, "beneficiary_category_dry_run_impact.json"), JSON.stringify(dryRun, null, 2), "utf8");
console.log("Dry-run impact:");
console.log(JSON.stringify(dryRun, null, 2));

if (!process.argv.includes("--apply")) {
  console.log("Dry-run only. Re-run with --apply to execute the migration.");
} else {
const backup = await query(`
  select id, fund_id, beneficiary_clean, beneficiary_raw, beneficiary_type,
         beneficiary_cat, committed_amt, invested_amt, remaining_amt, base_date
  from public.beneficiary_exposures
  order by id;
`);
const backupHeaders = Object.keys(backup[0] || {});
const backupCsv = [backupHeaders, ...backup.map((row) => backupHeaders.map((header) => row[header]))]
  .map((row) => row.map(csvCell).join(","))
  .join("\r\n");
const backupJsonPath = path.join(outputDir, "beneficiary_exposures_preapply_backup.json");
const backupCsvPath = path.join(outputDir, "beneficiary_exposures_preapply_backup.csv");
try {
  await fs.access(backupJsonPath);
} catch {
  await Promise.all([
    fs.writeFile(backupJsonPath, JSON.stringify(backup, null, 2), "utf8"),
    fs.writeFile(backupCsvPath, `\uFEFF${backupCsv}`, "utf8"),
  ]);
}

const migrationSql = await fs.readFile(migrationPath, "utf8");
await query(migrationSql);

const [contractAudit, categories, examples, columns, reviewQueue] = await Promise.all([
  query("select * from public.beneficiary_category_contract_audit;"),
  query(`
    select beneficiary_class, beneficiary_cat,
           count(*)::int as row_count,
           count(distinct beneficiary_clean)::int as beneficiary_count,
           count(distinct fund_id)::int as fund_count,
           coalesce(sum(invested_amt), 0)::bigint as invested_amt
    from public.beneficiary_exposures
    group by beneficiary_class, beneficiary_cat
    order by beneficiary_class, beneficiary_cat;
  `),
  query(`
    select beneficiary_clean, beneficiary_cat_source, beneficiary_cat,
           beneficiary_class, beneficiary_cat_basis, beneficiary_cat_review_status
    from public.beneficiary_exposures
    where beneficiary_clean in (
      '이지스자산운용', '신한투자증권', '신협중앙회', '신용협동조합중앙회',
      '엠디엠플러스', '넥슨코리아', '개인(정석우)', '448-3호',
      '이지스인컴앤그로스 2-4-4호', '성담솔트베이'
    )
    order by beneficiary_clean, id;
  `),
  query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_schema = 'public' and table_name = 'beneficiary_exposures'
      and column_name like 'beneficiary%'
    order by ordinal_position;
  `),
  query(`
    select beneficiary_name, beneficiary_cat, beneficiary_class,
           classification_basis, classification_confidence,
           exposure_row_count, fund_count, invested_amt
    from public.beneficiary_classification_review_queue
    order by invested_amt desc, beneficiary_name
    limit 30;
  `),
]);

const audit = contractAudit[0];
if (!audit || Number(audit.exposure_row_count) !== backup.length) {
  throw new Error(`Row count changed unexpectedly: before=${backup.length}, after=${audit?.exposure_row_count}`);
}
if (Number(audit.master_unmatched_rows) !== 0 || Number(audit.invalid_controlled_category_rows) !== 0) {
  throw new Error(`Classification contract verification failed: ${JSON.stringify(audit)}`);
}

const postApply = {
  appliedAt: new Date().toISOString(),
  projectRef,
  dryRun: dryRun[0],
  contractAudit: audit,
  categoryDistribution: categories,
  examples,
  columns,
  topReviewQueue: reviewQueue,
};
await fs.writeFile(path.join(outputDir, "beneficiary_category_postapply_verification.json"), JSON.stringify(postApply, null, 2), "utf8");
console.log("Post-apply verification:");
console.log(JSON.stringify(postApply, null, 2));
}
