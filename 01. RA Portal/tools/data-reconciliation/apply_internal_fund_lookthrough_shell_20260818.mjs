import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationCandidates = ["01. RA Portal"].map((portalDir) => path.join(
  repoRoot,
  portalDir,
  "migrations",
  "2026-08-18_internal_fund_lookthrough_shell_contract.sql",
));

async function findMigrationPath() {
  for (const candidate of migrationCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue to the compatibility path while the folder rename is rolled out.
    }
  }
  throw new Error(`Migration file not found: ${migrationCandidates.join(", ")}`);
}

const migrationPath = await findMigrationPath();

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

const verificationSql = `
  select *
  from public.party_internal_fund_lookthrough_shell_resolution_v1;

  select
    lookthrough_coverage_status,
    count(*)::int as target_funds,
    coalesce(sum(shell_rows), 0)::int as shell_rows,
    coalesce(sum(shell_committed_amt), 0)::bigint as shell_committed_amt
  from public.party_internal_fund_lookthrough_shell_target_v1
  group by lookthrough_coverage_status
  order by lookthrough_coverage_status;

  select *
  from public.party_external_investor_scope_reconciliation_v1
  order by role_type;
`;

const apply = process.argv.includes("--apply");
const migrationSql = (await fs.readFile(migrationPath, "utf8")).replace(/^\uFEFF/, "");
const sql = apply
  ? migrationSql
  : migrationSql.replace(/commit;\s*$/i, `${verificationSql}\nrollback;`);

const execution = await query(sql);
const verification = apply ? await query(verificationSql) : execution;

console.log(JSON.stringify({
  mode: apply ? "apply" : "rollback-dry-run",
  projectRef,
  migrationPath,
  migrationSha256: crypto.createHash("sha256").update(migrationSql, "utf8").digest("hex"),
  verification,
}, null, 2));
