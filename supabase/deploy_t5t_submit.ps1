param(
  [string]$ProjectRef = "qvegpozwrcmspdvjokiz",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN
)

$ErrorActionPreference = "Stop"

if (-not $AccessToken) {
  throw "SUPABASE_ACCESS_TOKEN is not set. Pass -AccessToken or set the environment variable before deployment."
}

$repo = Split-Path -Parent $PSScriptRoot
$notionConfigPath = Join-Path $repo "notion_config.json"
$functionPath = Join-Path $PSScriptRoot "functions\t5t-submit\index.ts"

if (-not (Test-Path $notionConfigPath)) {
  throw "notion_config.json was not found at $notionConfigPath"
}
if (-not (Test-Path $functionPath)) {
  throw "Function source was not found at $functionPath"
}
$notionConfig = Get-Content -Path $notionConfigPath -Encoding UTF8 | ConvertFrom-Json

$headers = @{
  Authorization = "Bearer $AccessToken"
}

$secretBody = @(
  @{ name = "NOTION_API_KEY"; value = $notionConfig.NOTION_API_KEY }
  @{ name = "RAW_T5T_DB_ID"; value = $notionConfig.RAW_T5T_DB_ID }
) | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/secrets" `
  -Method Post `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $secretBody | Out-Null

$env:T5T_DEPLOY_TOKEN = $AccessToken
$env:T5T_DEPLOY_PROJECT_REF = $ProjectRef
$env:T5T_DEPLOY_FUNCTION_PATH = $functionPath
try {
  @'
const fs = require("fs");

(async () => {
  const token = process.env.T5T_DEPLOY_TOKEN;
  const projectRef = process.env.T5T_DEPLOY_PROJECT_REF;
  const functionPath = process.env.T5T_DEPLOY_FUNCTION_PATH;
  const form = new FormData();
  form.append("metadata", JSON.stringify({
    entrypoint_path: "index.ts",
    name: "t5t-submit",
    verify_jwt: false,
  }));
  form.append("file", new Blob([fs.readFileSync(functionPath)], {
    type: "application/typescript",
  }), "index.ts");

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions/deploy?slug=t5t-submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.text();
  console.log(body);
  if (!response.ok) process.exit(1);
})();
'@ | node -
}
finally {
  Remove-Item Env:T5T_DEPLOY_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:T5T_DEPLOY_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:T5T_DEPLOY_FUNCTION_PATH -ErrorAction SilentlyContinue
}
