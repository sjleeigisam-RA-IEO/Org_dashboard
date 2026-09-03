param(
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ProjectRef = "qvegpozwrcmspdvjokiz"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  throw "SUPABASE_ACCESS_TOKEN 환경변수 또는 -AccessToken 값이 필요합니다."
}

$functionDir = Join-Path $PSScriptRoot "functions\ra-asset-map"
$indexPath = Join-Path $functionDir "index.ts"
$configPath = Join-Path $PSScriptRoot "config.toml"

if (-not (Test-Path $indexPath)) {
  throw "Function source not found: $indexPath"
}
if (-not (Test-Path $configPath)) {
  throw "Gateway policy not found: $configPath"
}

$configText = Get-Content -LiteralPath $configPath -Raw
if ($configText -notmatch '(?ms)\[functions\.ra-asset-map\].*?verify_jwt\s*=\s*false') {
  throw "config.toml must declare [functions.ra-asset-map] verify_jwt = false"
}

$metadata = @{
  entrypoint_path = "index.ts"
  name = "ra-asset-map"
  verify_jwt = $false
} | ConvertTo-Json -Compress

$headers = @{ Authorization = "Bearer $AccessToken" }
$form = @{
  metadata = $metadata
  file = Get-Item -LiteralPath $indexPath
}

$response = Invoke-RestMethod `
  -Uri "https://api.supabase.com/v1/projects/$ProjectRef/functions/deploy?slug=ra-asset-map" `
  -Method Post `
  -Headers $headers `
  -Form $form

[pscustomobject]@{
  slug = $response.slug
  status = $response.status
  version = $response.version
} | ConvertTo-Json -Compress