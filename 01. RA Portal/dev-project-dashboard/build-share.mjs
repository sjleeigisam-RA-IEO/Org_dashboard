import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "dist");
const tableName = "dev_project_34_dashboard_info";

function extractConfigValue(configJs, name) {
  const match = configJs.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`Missing ${name} in config.js`);
  return match[1];
}

function safeInlineScript(value) {
  return value.replace(/<\/script/gi, "<\\/script");
}

function stripAppScript(bodyHtml) {
  return bodyHtml.replace(/\s*<script\s+src="\.\/app\.js[^"]*"><\/script>\s*/i, "\n");
}

function extractBody(indexHtml) {
  const match = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error("Could not find body in index.html");
  return stripAppScript(match[1].trim());
}

async function fetchRows(configJs) {
  const supabaseUrl = extractConfigValue(configJs, "SUPABASE_URL");
  const supabaseKey = extractConfigValue(configJs, "SUPABASE_KEY");
  const endpoint = new URL(`/rest/v1/${tableName}`, supabaseUrl);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "list_no.asc");

  const response = await fetch(endpoint.toString(), {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase read failed: ${response.status} ${message}`);
  }

  return response.json();
}

function renderHtml({ title, css, body, beforeAppScript, appJs }) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
${css}
  </style>
</head>
<body>
${body}
  <script>
${beforeAppScript}
  </script>
  <script>
${safeInlineScript(appJs)}
  </script>
</body>
</html>
`;
}

const [indexHtml, css, appJs, configJs] = await Promise.all([
  readFile(path.join(__dirname, "index.html"), "utf8"),
  readFile(path.join(__dirname, "style.css"), "utf8"),
  readFile(path.join(__dirname, "app.js"), "utf8"),
  readFile(path.join(__dirname, "..", "portfolio-analysis", "config.js"), "utf8")
]);

const body = extractBody(indexHtml);
await mkdir(outDir, { recursive: true });

const rows = await fetchRows(configJs);
const snapshotScript = `window.SNAPSHOT_ROWS = ${safeInlineScript(JSON.stringify(rows))};`;
const snapshotHtml = renderHtml({
  title: "개발사업 프로젝트 34 - Snapshot",
  css,
  body,
  beforeAppScript: snapshotScript,
  appJs
});

const liveHtml = renderHtml({
  title: "개발사업 프로젝트 34 - Live",
  css,
  body,
  beforeAppScript: safeInlineScript(configJs),
  appJs
});

await Promise.all([
  writeFile(path.join(outDir, "dev-project-dashboard-snapshot.html"), snapshotHtml, "utf8"),
  writeFile(path.join(outDir, "dev-project-dashboard-live.html"), liveHtml, "utf8")
]);

console.log(JSON.stringify({
  tableName,
  rowCount: rows.length,
  outputs: [
    path.join(outDir, "dev-project-dashboard-snapshot.html"),
    path.join(outDir, "dev-project-dashboard-live.html")
  ]
}, null, 2));
