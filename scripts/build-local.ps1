[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
try {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) { $npm = (Get-Command npm -ErrorAction SilentlyContinue).Source }
    if (-not $npm) { throw 'npm was not found on PATH. Install Node.js 22 first.' }
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw 'cargo was not found on PATH. Install stable Rust with the MSVC toolchain first.'
    }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw 'vswhere.exe was not found. Install Visual Studio Build Tools with the "Desktop development with C++" workload.'
    }
    $vsPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsPath) {
        throw 'MSVC C++ build tools were not found. Install the "Desktop development with C++" workload in Visual Studio Build Tools.'
    }

    $devShell = Join-Path $vsPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
    if (-not (Test-Path $devShell)) {
        throw "Visual Studio developer shell module was not found at $devShell."
    }
    Import-Module $devShell
    Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation `
        -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null

    # MSVC and the linker create temporary files under %TEMP%; on this machine that
    # fails with D8050/LNK1104, so keep them inside the ignored target directory.
    $tempDir = Join-Path $root 'src-tauri\target\.build-temp'
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $env:TEMP = $tempDir
    $env:TMP = $tempDir

    function Invoke-Step([string]$Label, [scriptblock]$Command) {
        Write-Host "`n==> $Label" -ForegroundColor Cyan
        & $Command
        $code = $LASTEXITCODE
        if ($code -ne 0) { throw "$Label failed (exit $code)." }
    }

    if (-not $SkipInstall) {
        Invoke-Step 'Install locked dependencies' { & $npm ci --no-audit --no-fund }
    }
    Invoke-Step 'Lint' { & $npm run lint }
    if (-not $SkipTests) {
        Invoke-Step 'Frontend tests' { & $npm test }
    }
    Invoke-Step 'Frontend build' { & $npm run build }
    Invoke-Step 'Rust format check' {
        cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    }
    if (-not $SkipTests) {
        Invoke-Step 'Rust tests' {
            cargo test --locked --manifest-path src-tauri/Cargo.toml
        }
    }
    Invoke-Step 'Tauri installer' { & $npm run tauri build }

    $installer = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' `
        -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) {
        throw 'The build finished but no NSIS installer was produced.'
    }

    Write-Host "`nInstaller: $($installer.FullName)" -ForegroundColor Green
    Write-Host "Size:      $($installer.Length) bytes"
    Write-Host "SHA-256:   $((Get-FileHash $installer.FullName -Algorithm SHA256).Hash)"
}
finally {
    if ($null -ne $originalTemp) { $env:TEMP = $originalTemp }
    if ($null -ne $originalTmp) { $env:TMP = $originalTmp }
    Pop-Location
}
