param(
    [Parameter(Mandatory = $true)]
    [string]$Job,
    [string]$Date
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pythonArgs = @("$root\automation_runtime\run_automation.py", "--job", $Job)

if ($Date) {
    $pythonArgs += @("--date", $Date)
}

python @pythonArgs
exit $LASTEXITCODE
