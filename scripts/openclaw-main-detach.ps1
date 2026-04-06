# Detach local OpenClaw clone: remove origin; optional delete .git
# Usage (from repo root):
#   powershell -File scripts/openclaw-main-detach.ps1
#   powershell -File scripts/openclaw-main-detach.ps1 -DeleteDotGit
param(
    [switch] $DeleteDotGit,
    [string] $Path = ""
)

$ErrorActionPreference = "Stop"
$root = if ($Path) { $Path } else { Join-Path $PSScriptRoot "..\openclaw-main" }
$root = [System.IO.Path]::GetFullPath($root)

if (-not (Test-Path $root)) {
    Write-Error "Path not found: $root"
    exit 1
}

$gitDir = Join-Path $root ".git"
if (-not (Test-Path $gitDir)) {
    Write-Host "No .git under openclaw-main (e.g. ZIP without metadata). Nothing to detach."
    Write-Host "openclaw-main/ is in LCLAW .gitignore so it will not be committed by mistake."
    exit 0
}

Push-Location $root
try {
    git remote remove origin 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removed remote: origin"
    } else {
        Write-Host "No origin or already removed (ok)"
    }

    if ($DeleteDotGit) {
        Remove-Item -LiteralPath $gitDir -Recurse -Force
        Write-Host "Removed: $gitDir"
    } else {
        Write-Host "Done. Still a local repo without origin. Use -DeleteDotGit to remove .git entirely."
    }
} finally {
    Pop-Location
}
