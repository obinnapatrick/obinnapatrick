# UK Strategic Supplier Dependency Atlas - one-command local runner (Windows)
#
# Usage (from the repository root, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume
#   powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Supplier "NAME"
#
# What it does: verifies Python + Git, checks (without displaying) the
# optional COMPANIES_HOUSE_API_KEY, runs the local preflight, then drives
# the full Level-4 pipeline (probe -> capture -> lock -> score -> select ->
# truth slice -> gates -> render -> verify -> handoff). Stdlib-only Python:
# no virtual environment and no package installs are required. A failure
# preserves completed work and prints the exact resume command.

param(
    [switch]$Resume,
    [string]$Supplier = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $RepoRoot
$env:PYTHONUTF8 = "1"

Write-Host "=== UK Strategic Supplier Dependency Atlas - local bootstrap ==="
Write-Host ("Repository: " + $RepoRoot)

# --- 1. Python ---------------------------------------------------------
$Python = $null
foreach ($candidate in @("py", "python", "python3")) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($null -ne $cmd) {
        if ($candidate -eq "py") { $probe = & $candidate -3 --version 2>$null }
        else { $probe = & $candidate --version 2>$null }
        if ($LASTEXITCODE -eq 0 -and "$probe" -match "Python 3") {
            $Python = $candidate
            break
        }
    }
}
if ($null -eq $Python) {
    Write-Host "ERROR: Python 3 was not found. Install it from https://www.python.org/downloads/"
    Write-Host "(tick 'Add python.exe to PATH' during installation), then rerun this script."
    exit 2
}
if ($Python -eq "py") { $PyArgs = @("-3") } else { $PyArgs = @() }
$PyVersion = & $Python @PyArgs --version
Write-Host ("Python: " + $PyVersion + " (via '" + $Python + "')")

# --- 2. Git (optional but recommended) ---------------------------------
$Git = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $Git) {
    Write-Host "WARNING: git not found. The run works without it, but you will"
    Write-Host "need it to pull updates and push results. https://git-scm.com/downloads"
} else {
    Write-Host ("Git: " + (& git --version))
}

# --- 3. Dependencies ---------------------------------------------------
Write-Host "Dependencies: none required (Python standard library only; no venv needed)."

# --- 4. Companies House key presence (value never displayed) -----------
if ([string]::IsNullOrWhiteSpace($env:COMPANIES_HOUSE_API_KEY)) {
    Write-Host "COMPANIES_HOUSE_API_KEY: absent (optional - the run continues on the key-free path;"
    Write-Host "  Companies House enrichment will be recorded as an explicit limitation)."
} else {
    Write-Host "COMPANIES_HOUSE_API_KEY: present (value not shown)."
}

# --- 5. Preflight ------------------------------------------------------
& $Python @PyArgs "scripts\preflight_local.py"
$Preflight = $LASTEXITCODE
if ($Preflight -eq 3) {
    Write-Host ""
    Write-Host "Preflight is BLOCKED - not proceeding to real output."
    Write-Host "See docs\LOCAL_TROUBLESHOOTING.md and data\inbox\README.md (file-drop fallback)."
    exit 3
}
if ($Preflight -ne 0) {
    Write-Host "Preflight hit an environment error (see message above)."
    exit 2
}

# --- 6. Level-4 run ----------------------------------------------------
$RunArgs = @("scripts\run_level4.py")
if ($Resume) { $RunArgs += "--resume" }
if (-not [string]::IsNullOrWhiteSpace($Supplier)) { $RunArgs += @("--supplier", $Supplier) }

& $Python @PyArgs @RunArgs
$RunExit = $LASTEXITCODE
if ($RunExit -ne 0) {
    Write-Host ""
    Write-Host "The run stopped. Completed work is preserved."
    Write-Host "Resume with:"
    if ([string]::IsNullOrWhiteSpace($Supplier)) {
        Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume"
    } else {
        Write-Host ("  powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_local.ps1 -Resume -Supplier `"" + $Supplier + "`"")
    }
    Write-Host "Troubleshooting: docs\LOCAL_TROUBLESHOOTING.md"
    exit $RunExit
}

Write-Host ""
Write-Host "=== DONE - Level 4 run finished ==="
Write-Host "Open the generated profile from outputs\profiles\ (exact path printed above)."
Write-Host "Then commit and push:"
Write-Host "  git add -A"
Write-Host "  git commit -m `"add one-supplier truth slice (local run)`""
Write-Host "  git push -u origin claude/uk-supplier-dependency-atlas-ukhu0y"
exit 0
