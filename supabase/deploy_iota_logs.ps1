param(
  [string]$ProjectRef = "qvegpozwrcmspdvjokiz",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ApiToken = $env:IOTA_LOGS_API_TOKEN
)

$ErrorActionPreference = "Stop"

if (-not $AccessToken) {
  throw "SUPABASE_ACCESS_TOKEN is not set. Pass -AccessToken or set the environment variable before deployment."
}

$functionPath = Join-Path $PSScriptRoot "functions\iota-logs\index.ts"
if (-not (Test-Path $functionPath)) {
  throw "Function source was not found at $functionPath"
}

$headers = @{
  Authorization = "Bearer $AccessToken"
}

if ($ApiToken) {
  $secretBody = @(
    @{ name = "IOTA_LOGS_API_TOKEN"; value = $ApiToken }
  ) | ConvertTo-Json

  Invoke-RestMethod `
    -Uri "https://api.supabase.com/v1/projects/$ProjectRef/secrets" `
    -Method Post `
    -Headers $headers `
    -ContentType "application/json" `
    -Body $secretBody | Out-Null
}

$env:IOTA_LOGS_DEPLOY_TOKEN = $AccessToken
$env:IOTA_LOGS_DEPLOY_PROJECT_REF = $ProjectRef
$env:IOTA_LOGS_DEPLOY_FUNCTION_PATH = $functionPath

try {
  @'
const fs = require("fs");
const token = process.env.IOTA_LOGS_DEPLOY_TOKEN;
const projectRef = process.env.IOTA_LOGS_DEPLOY_PROJECT_REF;
const functionPath = process.env.IOTA_LOGS_DEPLOY_FUNCTION_PATH;

const form = new FormData();
form.append("metadata", JSON.stringify({
  entrypoint_path: "index.ts",
  name: "iota-logs",
  verify_jwt: false,
  import_map: null,
}));
form.append("file", new Blob([fs.readFileSync(functionPath)], {
  type: "application/typescript",
}), "index.ts");

fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions/deploy?slug=iota-logs`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
}).then(async (response) => {
  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(text || "iota-logs deployed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | node -
} finally {
  Remove-Item Env:IOTA_LOGS_DEPLOY_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:IOTA_LOGS_DEPLOY_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:IOTA_LOGS_DEPLOY_FUNCTION_PATH -ErrorAction SilentlyContinue
}
