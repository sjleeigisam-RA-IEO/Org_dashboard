import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "beneficiary_category_cleanup_20260813");
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
  if (!response.ok) {
    throw new Error(`Supabase query failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function csvCell(value) {
  const text = Array.isArray(value) || (value && typeof value === "object")
    ? JSON.stringify(value)
    : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

await fs.mkdir(outputDir, { recursive: true });

const [columns, summary, categories, names, mixedNames, counterparties] = await Promise.all([
  query(`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'beneficiary_exposures'
    order by ordinal_position;
  `),
  query(`
    select
      count(*)::int as row_count,
      count(distinct fund_id)::int as fund_count,
      count(distinct nullif(btrim(beneficiary_clean), ''))::int as beneficiary_name_count,
      count(distinct nullif(btrim(beneficiary_cat), ''))::int as category_count,
      count(*) filter (where nullif(btrim(beneficiary_clean), '') is null)::int as missing_name_rows,
      count(*) filter (where nullif(btrim(beneficiary_cat), '') is null)::int as missing_category_rows,
      count(*) filter (where counterparty_id is not null)::int as counterparty_linked_rows,
      min(base_date) as min_base_date,
      max(base_date) as max_base_date
    from public.beneficiary_exposures;
  `),
  query(`
    select
      coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>') as beneficiary_cat,
      count(*)::int as row_count,
      count(distinct fund_id)::int as fund_count,
      count(distinct nullif(btrim(beneficiary_clean), ''))::int as beneficiary_count,
      coalesce(sum(committed_amt), 0)::bigint as committed_amt,
      coalesce(sum(invested_amt), 0)::bigint as invested_amt,
      min(base_date) as min_base_date,
      max(base_date) as max_base_date
    from public.beneficiary_exposures
    group by 1
    order by beneficiary_count desc, row_count desc, beneficiary_cat;
  `),
  query(`
    select
      beneficiary_clean,
      array_agg(distinct coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>') order by coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>')) as beneficiary_categories,
      array_agg(distinct coalesce(nullif(btrim(beneficiary_type), ''), '<NULL>') order by coalesce(nullif(btrim(beneficiary_type), ''), '<NULL>')) as beneficiary_types,
      count(*)::int as row_count,
      count(distinct fund_id)::int as fund_count,
      coalesce(sum(committed_amt), 0)::bigint as committed_amt,
      coalesce(sum(invested_amt), 0)::bigint as invested_amt,
      coalesce(sum(remaining_amt), 0)::bigint as remaining_amt,
      min(base_date) as min_base_date,
      max(base_date) as max_base_date
    from public.beneficiary_exposures
    where nullif(btrim(beneficiary_clean), '') is not null
    group by beneficiary_clean
    order by invested_amt desc, beneficiary_clean;
  `),
  query(`
    select
      beneficiary_clean,
      array_agg(distinct coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>') order by coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>')) as beneficiary_categories,
      count(*)::int as row_count,
      count(distinct fund_id)::int as fund_count,
      coalesce(sum(invested_amt), 0)::bigint as invested_amt
    from public.beneficiary_exposures
    where nullif(btrim(beneficiary_clean), '') is not null
    group by beneficiary_clean
    having count(distinct coalesce(nullif(btrim(beneficiary_cat), ''), '<NULL>')) > 1
    order by invested_amt desc, beneficiary_clean;
  `),
  query(`
    select
      count(*)::int as counterparty_count,
      count(*) filter (where category is not null)::int as categorized_count,
      count(*) filter (where metadata is not null)::int as metadata_count
    from public.counterparties;
  `),
]);

const result = {
  auditedAt: new Date().toISOString(),
  projectRef,
  columns,
  summary: summary[0],
  categoryCount: categories.length,
  nameCount: names.length,
  mixedNameCount: mixedNames.length,
  counterpartySummary: counterparties[0],
};

await Promise.all([
  fs.writeFile(path.join(outputDir, "audit_summary.json"), JSON.stringify(result, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_category_counts.csv"), `\uFEFF${toCsv(categories)}`, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_category_counts.json"), JSON.stringify(categories, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_name_category_audit.csv"), `\uFEFF${toCsv(names)}`, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_name_category_audit.json"), JSON.stringify(names, null, 2), "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_mixed_categories.csv"), `\uFEFF${toCsv(mixedNames)}`, "utf8"),
  fs.writeFile(path.join(outputDir, "beneficiary_mixed_categories.json"), JSON.stringify(mixedNames, null, 2), "utf8"),
]);

console.log(JSON.stringify({
  ...result,
  categories,
  mixedNames,
}, null, 2));
