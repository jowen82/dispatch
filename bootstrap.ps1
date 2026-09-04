# Dispatch bootstrap — Windows
#
# UNTESTED on real Windows hardware. This mirrors bootstrap.command's macOS
# flow (find/install Python, copy studio/ into a home dir, launch the app)
# using winget instead of Homebrew. Please run this on an actual Windows
# machine and report exactly what breaks — path handling, winget prompts,
# and PowerShell execution-policy quirks are the likely trouble spots.
#
# If PowerShell refuses to run this at all, that's execution policy, not a
# bug here: run once as yourself (not admin):
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppHome = Join-Path $env:USERPROFILE "Dispatch"
New-Item -ItemType Directory -Force -Path (Join-Path $AppHome "logs") | Out-Null
$Log = Join-Path $AppHome "logs\bootstrap.log"
Start-Transcript -Path $Log -Append | Out-Null

Write-Host "Dispatch bootstrap (Windows)"
Write-Host "Package: $Root"

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "python") -and -not (Test-Command "python3")) {
    if (Test-Command "winget") {
        $answer = Read-Host "Python was not found. Install it with winget? [Y/n]"
        if ($answer -and $answer.ToLower() -ne "y") { exit 1 }
        winget install -e --id Python.Python.3.12
    } else {
        Write-Host "winget is not available and Python was not found."
        Write-Host "Install Python 3 from https://python.org/downloads/ and re-run this script."
        Start-Process "https://python.org/downloads/"
        exit 0
    }
}

$PythonCmd = if (Test-Command "python3") { "python3" } else { "python" }

Copy-Item -Recurse -Force (Join-Path $Root "studio") $AppHome
Copy-Item -Force (Join-Path $Root "VERSION") $AppHome
Copy-Item -Force (Join-Path $Root "run.ps1") $AppHome -ErrorAction SilentlyContinue

Set-Location $Root
& $PythonCmd -m studio.app --package-root $Root --home $AppHome --open-browser

Stop-Transcript | Out-Null
