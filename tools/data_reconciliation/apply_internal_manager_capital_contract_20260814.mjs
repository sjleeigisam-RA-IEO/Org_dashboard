import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = path.join(
  repoRoot,
  "CRM_base",
  "migrations",
  "2026-08-14_internal_manager_capital_contract.sql",
);

function parseEnv(text) {
  return Object.fromEntries(
    text.replace(/^\uFEFF/, "").split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const env = parseEnv(await fs.readFile(path.join(repoRoot, ".env"), "utf8"));
if (!env.SUPABASE_URL || !env.SUPABASE_TOKEN) {
  throw new Error("SUPABASE_URL or SUPABASE_TOKEN is missing from .env");
}

const projectRef = new URL(env.SUPABASE_URL).hostname.split(".")[0];
async function query(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

const apply = process.argv.includes("--apply");
const migrationSql = (await fs.readFile(migrationPath, "utf8")).replace(/^\uFEFF/, "");
const sql = apply
  ? migrationSql
  : migrationSql.replace(/commit;\s*$/i, `
      select * from public.party_internal_manager_capital_resolution_v1;
      select * from public.party_external_investor_scope_reconciliation_v1 order by role_type;
      rollback;
    `);

const execution = await query(sql);
const verification = apply
  ? await query(`
      select * from public.party_internal_manager_capital_resolution_v1;
      select * from public.party_external_investor_scope_reconciliation_v1 order by role_type;
    `)
  : execution;

console.log(JSON.stringify({
  mode: apply ? "apply" : "rollback-dry-run",
  projectRef,
  migrationPath,
  migrationSha256: crypto.createHash("sha256").update(migrationSql, "utf8").digest("hex"),
  verification,
}, null, 2));
