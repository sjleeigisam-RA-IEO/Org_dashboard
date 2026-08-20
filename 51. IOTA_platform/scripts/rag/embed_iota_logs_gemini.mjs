import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_FILES = [
  ".env",
  path.join("..", ".env"),
  path.join("..", "..", ".env"),
];

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

function requiredEnv(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    if (process.env[key]) return process.env[key];
  }
  throw new Error(`Missing required env var: ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function buildLogContent(log) {
  const lines = [];
  if (log.summary) lines.push(`# ${log.summary}`);
  if (log.work_date || log.writer_name) {
    lines.push(`작성일: ${log.work_date || ""}`);
    lines.push(`작성자: ${log.writer_name || ""}`);
  }

  const meta = log.metadata || {};
  if (meta.project_name || meta.source_project_text || meta.workspace_label) {
    lines.push(`프로젝트/워크스페이스: ${meta.project_name || meta.source_project_text || meta.workspace_label}`);
  }
  if (Array.isArray(meta.iota_matches) && meta.iota_matches.length) {
    const labels = meta.iota_matches.map((item) => item.label || item.project_id || item.proj_id).filter(Boolean);
    if (labels.length) lines.push(`IOTA 매칭: ${labels.join(", ")}`);
  }
  if (Array.isArray(meta.classification_tokens) && meta.classification_tokens.length) {
    lines.push(`분류 토큰: ${meta.classification_tokens.join(", ")}`);
  }

  if (log.raw_text) {
    lines.push("");
    lines.push(log.raw_text);
  }

  return normalizeWhitespace(lines.join("\n"));
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
  return { json, res };
}

async function fetchLogs({ limit }) {
  const pageSize = 100;
  const rows = [];

  for (let offset = 0; rows.length < limit; offset += pageSize) {
    const remaining = limit - rows.length;
    const take = Math.min(pageSize, remaining);
    const select = [
      "log_id",
      "writer_staff_id",
      "writer_name",
      "work_date",
      "summary",
      "raw_text",
      "metadata",
      "created_at",
      "updated_at",
    ].join(",");
    const pathname = `/rest/v1/iota_seoul_logs?select=${encodeURIComponent(select)}&order=work_date.desc&order=created_at.desc&limit=${take}&offset=${offset}`;
    const { json } = await supabaseRequest(pathname, {
      method: "GET",
      prefer: `count=exact`,
    });
    const page = Array.isArray(json) ? json : [];
    rows.push(...page);
    if (page.length < take) break;
  }

  return rows.slice(0, limit);
}

async function embedText(text, task) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`;
  const body = {
    content: {
      parts: [{ text }],
    },
    output_dimensionality: EMBEDDING_DIMENSIONS,
  };

  if (GEMINI_MODEL === "gemini-embedding-001") {
    body.taskType = task;
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
  if (!res.ok) {
    throw new Error(`Gemini embedding failed: ${res.status} ${JSON.stringify(json)}`);
  }

  const values = json.embedding?.values || json.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding length: ${values?.length || "missing"}`);
  }
  return values;
}

async function upsertChunk(chunk) {
  return supabaseRequest(
    "/rest/v1/rag_chunks?on_conflict=source_table,source_id,chunk_index",
    {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [chunk],
    },
  );
}

loadEnv();

const limit = Number(getArgValue("--limit", "10"));
const dryRun = hasFlag("--dry-run");
const delayMs = Number(getArgValue("--delay-ms", "250"));

const SUPABASE_URL = requiredEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]).replace(/\/$/, "");
const SUPABASE_KEY = dryRun
  ? requiredEnv("SUPABASE_KEY", ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "VITE_SUPABASE_ANON_KEY"])
  : requiredEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_KEY", "SUPABASE_KEY"]);
const GEMINI_API_KEY = dryRun ? "" : requiredEnv("GEMINI_API_KEY", ["GOOGLE_API_KEY"]);
const GEMINI_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || "768");

if (EMBEDDING_DIMENSIONS !== 768) {
  throw new Error("rag_chunks.embedding is vector(768). Keep GEMINI_EMBEDDING_DIMENSIONS=768.");
}

console.log(`Supabase: ${new URL(SUPABASE_URL).host}`);
console.log(`Gemini model: ${GEMINI_MODEL}, dimensions: ${EMBEDDING_DIMENSIONS}`);
console.log(`Mode: ${dryRun ? "dry-run" : "write"}, limit: ${limit}`);

const logs = await fetchLogs({ limit });
console.log(`Fetched logs: ${logs.length}`);

let written = 0;
let skipped = 0;

for (const log of logs) {
  const content = buildLogContent(log);
  if (!content) {
    skipped += 1;
    continue;
  }

  const hash = contentHash(content);
  const title = log.summary || content.split("\n")[0].slice(0, 120);
  const metadata = {
    writer_staff_id: log.writer_staff_id,
    writer_name: log.writer_name,
    work_date: log.work_date,
    source_created_at: log.created_at,
    source_updated_at: log.updated_at,
    source_metadata: log.metadata || {},
  };

  if (dryRun) {
    console.log(`[dry-run] ${log.log_id} ${title}`);
    continue;
  }

  const embedding = await embedText(content, "RETRIEVAL_DOCUMENT");
  await upsertChunk({
    source_table: "iota_seoul_logs",
    source_id: log.log_id,
    source_type: "work_log",
    chunk_index: 0,
    title,
    content,
    metadata,
    embedding,
    embedding_model: `${GEMINI_MODEL}:${EMBEDDING_DIMENSIONS}`,
    content_hash: hash,
    updated_at: new Date().toISOString(),
  });

  written += 1;
  console.log(`[upserted] ${log.log_id} ${title}`);
  if (delayMs > 0) await sleep(delayMs);
}

console.log(JSON.stringify({ fetched: logs.length, written, skipped, dryRun }, null, 2));
