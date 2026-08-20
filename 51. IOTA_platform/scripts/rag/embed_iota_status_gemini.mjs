import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_FILES = [".env", path.join("..", ".env"), path.join("..", "..", ".env")];

const SOURCE_GROUPS = {
  status: [
    "iota_workspace_kpis",
    "iota_project_metrics",
    "iota_project_history",
    "iota_capital_stack",
  ],
  tasks: [
    "iota_pm_tasks",
    "iota_financing_tasks",
    "iota_development_tasks",
    "iota_digital_tasks",
    "iota_fund_tasks",
    "iota_ipr_tasks",
    "iota_marketing_tasks",
    "iota_marketing_pipelines",
    "iota_marketing_pipeline_logs",
  ],
  stakeholders: ["iota_stakeholder_master"],
};

function getArgValue(name, fallback = null) {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadEnv() {
  const explicitEnv = getArgValue("--env");
  const candidates = explicitEnv ? [explicitEnv] : DEFAULT_ENV_FILES;

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function requiredEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`Missing required env var: ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function normalize(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function compactJson(value) {
  if (!value || typeof value !== "object") return "";
  return JSON.stringify(value);
}

function getRowId(table, row) {
  return String(
    row.id ??
    row.log_id ??
    row.pipeline_id ??
    row.project_id ??
    row.vehicle_name ??
    `${table}_${hash(JSON.stringify(row)).slice(0, 16)}`,
  );
}

function buildTitle(table, row) {
  if (row.task_name) return row.task_name;
  if (row.channel_name) return row.channel_name;
  if (row.progress_detail) return `마케팅 파이프라인 로그 ${row.id || row.pipeline_id || ""}`.trim();
  if (row.vehicle_name && row.phase && row.tranche_name) return `${row.vehicle_name} ${row.phase} ${row.tranche_name}`;
  if (row.vehicle_name && row.category) return `${row.vehicle_name} ${row.category}`;
  if (row.vehicle_name) return `${row.vehicle_name} 현황`;
  if (row.project_id) return `${row.project_id} KPI`;
  if (row.company_name || row.contact_name) return [row.company_name, row.contact_name].filter(Boolean).join(" - ");
  return `${table} ${getRowId(table, row)}`;
}

function buildContent(table, row) {
  const lines = [`# ${buildTitle(table, row)}`, `원천 테이블: ${table}`];

  switch (table) {
    case "iota_capital_stack":
      lines.push(`Vehicle: ${row.vehicle_name || ""}`);
      lines.push(`Phase: ${row.phase || ""}`);
      lines.push(`Tranche: ${row.tranche_type || ""} / ${row.tranche_name || ""}`);
      lines.push(`기관: ${row.institution_name || ""}`);
      lines.push(`금액(억원): ${row.amount_krw_100m ?? ""}`);
      lines.push(`Counterparty ID: ${row.counterparty_id || ""}`);
      break;
    case "iota_project_metrics":
      lines.push(`Vehicle: ${row.vehicle_name || ""}`);
      lines.push(`GFA: ${row.gfa || ""}`);
      lines.push(`Office Area: ${row.office_area || ""}`);
      lines.push(`Retail Area: ${row.retail_area || ""}`);
      lines.push(`Hotel Area: ${row.hotel_area || ""}`);
      lines.push(`Target IRR: ${row.target_irr || ""}`);
      break;
    case "iota_project_history":
      lines.push(`Vehicle: ${row.vehicle_name || ""}`);
      lines.push(`Category: ${row.category || ""}`);
      lines.push(`Sort Order: ${row.sort_order ?? ""}`);
      for (const key of ["phase1", "phase2", "phase3", "phase4", "phase5"]) {
        if (row[key]) lines.push(`${key}: ${row[key]}`);
      }
      break;
    case "iota_workspace_kpis":
      lines.push(`Project: ${row.project_id || ""}`);
      lines.push(`Progress: ${row.progress_percent ?? ""}%`);
      lines.push(`Budget Variance: ${row.budget_variance ?? ""}`);
      lines.push(`Schedule Slippage Days: ${row.schedule_slippage_days ?? ""}`);
      lines.push(`Covenant Status: ${row.covenant_status || ""}`);
      lines.push(`Covenant LTV: ${row.covenant_ltv ?? ""}`);
      lines.push(`Covenant DSCR: ${row.covenant_dscr ?? ""}`);
      break;
    case "iota_stakeholder_master":
      lines.push(`회사: ${row.company_name || ""}`);
      lines.push(`담당자: ${row.contact_name || ""}`);
      lines.push(`분류: ${row.role_category || ""}`);
      break;
    case "iota_marketing_pipelines":
      lines.push(`채널/기업: ${row.channel_name || ""}`);
      lines.push(`상태: ${row.status || ""}`);
      lines.push(`관련 자산: ${row.related_asset || ""}`);
      lines.push(`컨택포인트: ${row.contact_point || ""}`);
      break;
    case "iota_marketing_pipeline_logs":
      lines.push(`Pipeline ID: ${row.pipeline_id || ""}`);
      lines.push(`진행 내용: ${row.progress_detail || ""}`);
      lines.push(`관리 방안: ${row.management_plan || ""}`);
      break;
    default:
      lines.push(`Task: ${row.task_name || ""}`);
      lines.push(`회사: ${row.company_name || ""}`);
      lines.push(`관련 자산: ${row.related_asset || row.ssc_theme || ""}`);
      lines.push(`상태: ${row.status || ""}`);
      lines.push(`우선순위: ${row.priority || ""}`);
      lines.push(`기한: ${row.due_date || ""}`);
      lines.push(`다음 액션: ${row.next_action || ""}`);
      lines.push(`메모: ${row.notes || ""}`);
      lines.push(`파일: ${row.file_name || ""} ${row.file_url || ""}`.trim());
      break;
  }

  return normalize(lines.filter((line) => normalize(line).replace(/^[^:]+:\s*$/, "")).join("\n"));
}

async function supabaseRequest(pathname, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${pathname} failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

async function fetchRows(table, limit) {
  const rows = [];
  const pageSize = 100;

  for (let offset = 0; rows.length < limit; offset += pageSize) {
    const take = Math.min(pageSize, limit - rows.length);
    const page = await supabaseRequest(`/rest/v1/${table}?select=*&limit=${take}&offset=${offset}`);
    if (!Array.isArray(page)) return rows;
    rows.push(...page);
    if (page.length < take) break;
  }
  return rows;
}

async function embedText(text) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`;
  const body = {
    content: { parts: [{ text }] },
    output_dimensionality: EMBEDDING_DIMENSIONS,
  };

  if (GEMINI_MODEL === "gemini-embedding-001") {
    body.taskType = "RETRIEVAL_DOCUMENT";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Gemini embedding failed: ${res.status} ${JSON.stringify(json)}`);
  const values = json.embedding?.values || json.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding length: ${values?.length || "missing"}`);
  }
  return values;
}

async function upsertChunk(chunk) {
  return supabaseRequest("/rest/v1/rag_chunks?on_conflict=source_table,source_id,chunk_index", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [chunk],
  });
}

function getSources() {
  const sourceArg = getArgValue("--source", "status,tasks");
  const names = sourceArg.split(",").map((item) => item.trim()).filter(Boolean);
  const tables = [];
  for (const name of names) {
    if (name === "all") {
      tables.push(...Object.values(SOURCE_GROUPS).flat());
    } else if (SOURCE_GROUPS[name]) {
      tables.push(...SOURCE_GROUPS[name]);
    } else {
      tables.push(name);
    }
  }
  return [...new Set(tables)];
}

loadEnv();

const SUPABASE_URL = requiredEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]).replace(/\/$/, "");
const SUPABASE_KEY = hasFlag("--dry-run")
  ? requiredEnv("SUPABASE_KEY", ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "VITE_SUPABASE_ANON_KEY"])
  : requiredEnv("SUPABASE_KEY", ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"]);
const GEMINI_API_KEY = hasFlag("--dry-run") ? "" : requiredEnv("GEMINI_API_KEY", ["GOOGLE_API_KEY"]);
const GEMINI_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || "768");

const dryRun = hasFlag("--dry-run");
const perTableLimit = Number(getArgValue("--per-table-limit", "1000"));
const delayMs = Number(getArgValue("--delay-ms", "250"));
const tables = getSources();

if (EMBEDDING_DIMENSIONS !== 768) {
  throw new Error("rag_chunks.embedding is vector(768). Keep GEMINI_EMBEDDING_DIMENSIONS=768.");
}

console.log(`Supabase: ${new URL(SUPABASE_URL).host}`);
console.log(`Sources: ${tables.join(", ")}`);
console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);

let fetched = 0;
let written = 0;
let skipped = 0;

for (const table of tables) {
  const rows = await fetchRows(table, perTableLimit);
  console.log(`${table}: fetched ${rows.length}`);
  fetched += rows.length;

  for (const row of rows) {
    const content = buildContent(table, row);
    if (!content) {
      skipped += 1;
      continue;
    }

    const sourceId = getRowId(table, row);
    const title = buildTitle(table, row);
    const digest = hash(content);

    if (dryRun) {
      console.log(`[dry-run] ${table}:${sourceId} ${title}`);
      continue;
    }

    const embedding = await embedText(content);
    await upsertChunk({
      source_table: table,
      source_id: sourceId,
      source_type: table === "iota_stakeholder_master" ? "stakeholder" : table.includes("task") || table.includes("pipeline") ? "task_status" : "status",
      chunk_index: 0,
      title,
      content,
      metadata: {
        source_table: table,
        source_row: row,
        raw_json: compactJson(row),
      },
      embedding,
      embedding_model: `${GEMINI_MODEL}:${EMBEDDING_DIMENSIONS}`,
      content_hash: digest,
      updated_at: new Date().toISOString(),
    });
    written += 1;
    console.log(`[upserted] ${table}:${sourceId} ${title}`);
    if (delayMs > 0) await sleep(delayMs);
  }
}

console.log(JSON.stringify({ fetched, written, skipped, dryRun }, null, 2));
