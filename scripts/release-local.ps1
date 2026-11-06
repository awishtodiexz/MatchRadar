[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    node 'scripts/check-version.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Version check failed.' }

    $version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    $tag = "v$version"

    if (-not $SkipBuild) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-local.ps1')
        if ($LASTEXITCODE -ne 0) { throw "Installer build failed (exit $LASTEXITCODE)." }
    }

    $installer = Get-ChildItem 'src-tauri\target\release\bundle\nsis\MatchRadar_*_x64-setup.exe' `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*_$($version)_*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) {
        throw "No $version installer found. Run without -SkipBuild or build it locally first."
    }
    $hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash
    Write-Host "Installer: $($installer.FullName)"
    Write-Host "Size:      $($installer.Length) bytes"
    Write-Host "SHA-256:   $hash"

    if (-not $Publish) {
        Write-Host "`nReady to publish $tag. Review the SHA-256 and release notes, then run with -Publish."
        Write-Host "This does not push commits or create tags unless -Publish is used."
        return
    }

    if (git status --porcelain) { throw 'Commit or stash changes before publishing.' }
    $head = (git rev-parse HEAD).Trim()
    $remote = (git rev-parse origin/main).Trim()
    if ($head -ne $remote) { throw 'Push main before publishing so the tag and installer match.' }
    $commitTime = [DateTimeOffset]::FromUnixTimeSeconds([int64](git log -1 --format=%ct)).LocalDateTime
    if ($installer.LastWriteTime -lt $commitTime) { throw 'Installer predates HEAD; rebuild before publishing.' }
    if (git tag --list $tag) { throw "Tag $tag already exists." }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is required to publish.' }

    gh release create $tag "$($installer.FullName)#MatchRadar $version installer" `
        --target main --title "MatchRadar $version" --generate-notes --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)." }
    Write-Host "Published $tag with the locally built installer."
}
finally {
    Pop-Location
}
