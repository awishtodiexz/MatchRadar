# Rebuilds the local app whenever its sources change, then reopens it.
#
# Triggered by the git hooks in .githooks (after commits, merges and pulls) and
# optionally by a Claude Code Stop hook. Runs the fast build (no test suites):
# use scripts/build-local.ps1 for the full checked build.
#
#   -Background  start a hidden worker and return immediately (used by hooks)
#   -Force       build even if the sources match the last build
#
# Builds are skipped when the app sources are identical to the last successful
# build, so doc-only commits and repeated triggers cost nothing. Only one build
# runs at a time; a trigger that arrives mid-build queues one more pass.
# Log: src-tauri/target/auto-build/auto-build.log
[CmdletBinding()]
param(
    [switch]$Background,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $root 'src-tauri\target\auto-build'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$log = Join-Path $stateDir 'auto-build.log'
$lockFile = Join-Path $stateDir 'build.lock'
$pendingFile = Join-Path $stateDir 'pending'
$stampFile = Join-Path $stateDir 'last-built'
$exe = Join-Path $root 'src-tauri\target\release\matchradar.exe'

if ($Background) {
    $shell = (Get-Process -Id $PID).Path
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($Force) { $arguments += '-Force' }
    Start-Process -FilePath $shell -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    exit 0
}

function Write-Log([string]$Message) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Add-Content -Path $log
}

# A content hash of everything that ends up in the app. A throwaway git index
# includes uncommitted and untracked (non-ignored) files without touching the
# real index.
$sourcePaths = @('src', 'public', 'index.html', 'package.json', 'package-lock.json',
    'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json',
    'src-tauri/src', 'src-tauri/capabilities', 'src-tauri/icons', 'src-tauri/build.rs',
    'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json')
function Get-SourceFingerprint {
    $index = Join-Path $stateDir 'fingerprint.index'
    Remove-Item $index -ErrorAction SilentlyContinue
    $previous = $env:GIT_INDEX_FILE
    try {
        $env:GIT_INDEX_FILE = $index
        $present = $sourcePaths | Where-Object { Test-Path (Join-Path $root $_) }
        git -C $root add -A -- @present 2>$null
        (git -C $root write-tree).Trim()
    }
    finally {
        $env:GIT_INDEX_FILE = $previous
        Remove-Item $index -ErrorAction SilentlyContinue
    }
}

# Single-builder lock: a live PID in the lock file means a build is running.
if (Test-Path $lockFile) {
    $owner = [int](Get-Content $lockFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($owner -and (Get-Process -Id $owner -ErrorAction SilentlyContinue)) {
        New-Item -ItemType File -Force -Path $pendingFile | Out-Null
        exit 0
    }
}
Set-Content -Path $lockFile -Value $PID

try {
    do {
        Remove-Item $pendingFile -ErrorAction SilentlyContinue
        $fingerprint = Get-SourceFingerprint
        $last = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }
        if (-not $Force -and $fingerprint -eq $last) {
            Write-Log "Sources unchanged ($($fingerprint.Substring(0, 8))), skipping build."
            continue
        }
        $Force = $false

        Write-Log "Building $($fingerprint.Substring(0, 8))..."
        # The installer step must overwrite the exe, so close the running build.
        $running = @(Get-CimInstance Win32_Process -Filter "Name = 'matchradar.exe'" |
            Where-Object { $_.ExecutablePath -eq $exe })
        foreach ($process in $running) { Stop-Process -Id $process.ProcessId -Force }
        if ($running.Count) { Start-Sleep -Seconds 2 }

        $buildLog = Join-Path $stateDir 'last-build-output.log'
        & (Join-Path $PSScriptRoot 'build-local.ps1') -SkipInstall -SkipTests *> $buildLog
        $ok = $?
        if ($ok -and (Test-Path $exe)) {
            Set-Content -Path $stampFile -Value $fingerprint
            Write-Log 'Build succeeded.'
        } else {
            Write-Log "Build FAILED. See $buildLog"
        }
        # Reopen the app either way: on failure the previous exe is still there.
        if (Test-Path $exe) { Start-Process -FilePath $exe }
    } while (Test-Path $pendingFile)
}
catch {
    Write-Log "Build FAILED: $($_.Exception.Message). See $(Join-Path $stateDir 'last-build-output.log')"
    if (Test-Path $exe) { Start-Process -FilePath $exe }
}
finally {
    Remove-Item $lockFile -ErrorAction SilentlyContinue
}
