# Dispatch — resume (Windows). UNTESTED on real hardware, mirrors run.command.
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (Test-Path (Join-Path $Here "studio")) {
    $Root = $Here
    $HomeDir = Join-Path $env:USERPROFILE "Dispatch"
} else {
    $Root = Join-Path $env:USERPROFILE "Dispatch"
    $HomeDir = $Root
}

$PythonCmd = if (Get-Command "python3" -ErrorAction SilentlyContinue) { "python3" } else { "python" }
Set-Location $Root
& $PythonCmd -m studio.app --package-root $Root --home $HomeDir --open-browser
