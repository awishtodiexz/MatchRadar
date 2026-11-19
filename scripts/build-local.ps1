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
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { $npmCommand = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $npmCommand) { throw 'npm was not found on PATH. Install Node.js 22 first.' }
    $npm = $npmCommand.Source
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

    $stamp = Join-Path $root 'src-tauri\target\release\bundle\nsis\verified-commit'
    Remove-Item $stamp -ErrorAction SilentlyContinue
    $startHead = (git rev-parse HEAD).Trim()
    $startClean = -not (git status --porcelain)

    # MSVC and the linker create temporary files under %TEMP%. Keep them inside
    # the ignored target directory so builds are not affected by locked temp files.
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
    Invoke-Step 'Version check' { & node 'scripts/check-version.mjs' }
    Invoke-Step 'Format check' { & $npm run format:check }
    Invoke-Step 'Lint' { & $npm run lint }
    if (-not $SkipTests) {
        Invoke-Step 'Frontend tests' { & $npm test }
    }
    Invoke-Step 'Frontend build' { & $npm run build }
    if (-not $SkipTests) {
        Invoke-Step 'UI journeys and accessibility' { & $npm run verify:ui }
    }
    Invoke-Step 'Rust format check' {
        cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    }
    Invoke-Step 'Rust lint' {
        cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
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

    $installerHash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash
    $unchanged = (git rev-parse HEAD).Trim() -eq $startHead -and -not (git status --porcelain)
    if (-not $SkipTests -and $startClean -and $unchanged) {
        Set-Content -Path $stamp -Value "$startHead $installerHash" -NoNewline
    }

    Write-Host "`nInstaller: $($installer.FullName)" -ForegroundColor Green
    Write-Host "Size:      $($installer.Length) bytes"
    Write-Host "SHA-256:   $installerHash"
}
finally {
    if ($null -ne $originalTemp) { $env:TEMP = $originalTemp }
    if ($null -ne $originalTmp) { $env:TMP = $originalTmp }
    Pop-Location
}
