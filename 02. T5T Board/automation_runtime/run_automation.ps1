param(
    [Parameter(Mandatory = $true)]
    [string]$Job,
    [string]$Date
)

$ErrorActionPreference = "Stop"
$pythonArgs = @((Join-Path $PSScriptRoot "run_automation.py"), "--job", $Job)

if ($Date) {
    $pythonArgs += @("--date", $Date)
}

python @pythonArgs
exit $LASTEXITCODE
