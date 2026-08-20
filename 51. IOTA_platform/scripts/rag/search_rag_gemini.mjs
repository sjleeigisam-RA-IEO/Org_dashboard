import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_FILES = [
  ".env",
  path.join("..", ".env"),
  path.join("..", "..", ".env"),
];

function getArgValue(name, fallback = null) {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
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

async function embedQuery(text) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent`;
  const body = {
    content: {
      parts: [{ text }],
    },
    output_dimensionality: EMBEDDING_DIMENSIONS,
  };

  if (GEMINI_MODEL === "gemini-embedding-001") {
    body.taskType = "RETRIEVAL_QUERY";
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

async function matchChunks(queryEmbedding, matchCount) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_rag_chunks`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query_embedding: queryEmbedding,
      match_count: matchCount,
      source_table_filter: null,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`match_rag_chunks failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

loadEnv();

const SUPABASE_URL = requiredEnv("SUPABASE_URL", ["VITE_SUPABASE_URL"]).replace(/\/$/, "");
const SUPABASE_KEY = requiredEnv("SUPABASE_KEY", [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "VITE_SUPABASE_ANON_KEY",
]);
const GEMINI_API_KEY = requiredEnv("GEMINI_API_KEY", ["GOOGLE_API_KEY"]);
const GEMINI_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2";
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || "768");

const question = getArgValue("--q", "남대문교회 협상 관련 업무");
const matchCount = Number(getArgValue("--match-count", "5"));

if (EMBEDDING_DIMENSIONS !== 768) {
  throw new Error("rag_chunks.embedding is vector(768). Keep GEMINI_EMBEDDING_DIMENSIONS=768.");
}

console.log(`Supabase: ${new URL(SUPABASE_URL).host}`);
console.log(`Question: ${question}`);

const embedding = await embedQuery(question);
const matches = await matchChunks(embedding, matchCount);

console.log(JSON.stringify(matches, null, 2));
