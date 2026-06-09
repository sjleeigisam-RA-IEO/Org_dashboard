param(
  [string]$ProjectRef = "qvegpozwrcmspdvjokiz",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN
)

$ErrorActionPreference = "Stop"

if (-not $AccessToken) {
  throw "SUPABASE_ACCESS_TOKEN is not set. Pass -AccessToken or set the environment variable before deployment."
}

$functionPath = Join-Path $PSScriptRoot "functions\ra-auth\index.ts"
if (-not (Test-Path $functionPath)) {
  throw "Function source was not found at $functionPath"
}

$env:RA_AUTH_DEPLOY_TOKEN = $AccessToken
$env:RA_AUTH_DEPLOY_PROJECT_REF = $ProjectRef
$env:RA_AUTH_DEPLOY_FUNCTION_PATH = $functionPath

try {
  @'
const fs = require("fs");
const token = process.env.RA_AUTH_DEPLOY_TOKEN;
const projectRef = process.env.RA_AUTH_DEPLOY_PROJECT_REF;
const functionPath = process.env.RA_AUTH_DEPLOY_FUNCTION_PATH;

const form = new FormData();
form.append("metadata", JSON.stringify({
  entrypoint_path: "index.ts",
  name: "ra-auth",
  verify_jwt: false,
  import_map: null,
}));
form.append("file", new Blob([fs.readFileSync(functionPath)], {
  type: "application/typescript",
}), "index.ts");

fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions/deploy?slug=ra-auth`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
}).then(async (response) => {
  const text = await response.text();
  if (!response.ok) {
    console.error(text);
    process.exit(1);
  }
  console.log(text || "ra-auth deployed");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | node -
} finally {
  Remove-Item Env:RA_AUTH_DEPLOY_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:RA_AUTH_DEPLOY_PROJECT_REF -ErrorAction SilentlyContinue
  Remove-Item Env:RA_AUTH_DEPLOY_FUNCTION_PATH -ErrorAction SilentlyContinue
}
