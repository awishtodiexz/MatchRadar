[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Publish,
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    node 'scripts/check-version.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Version check failed.' }

    $version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    $head = (git rev-parse HEAD).Trim()
    if (-not $Tag) { $Tag = "v$version-build.$($head.Substring(0, 7))" }
    git check-ref-format "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) { throw "Invalid release tag: $Tag" }

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
        Write-Host "`nReady to publish $Tag. Review the SHA-256 and release notes, then run with -Publish."
        Write-Host "This does not push commits or create tags unless -Publish is used."
        return
    }

    if (git status --porcelain) { throw 'Commit or stash changes before publishing.' }
    if ((git branch --show-current).Trim() -ne 'main') { throw 'Publish from the local main branch.' }
    git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify origin/main.' }
    $remote = (git rev-parse origin/main).Trim()
    if ($head -ne $remote) { throw 'Push main before publishing so the tag and installer match.' }
    $commitTime = [DateTimeOffset]::FromUnixTimeSeconds([int64](git log -1 --format=%ct)).LocalDateTime
    if ($installer.LastWriteTime -lt $commitTime) { throw 'Installer predates HEAD; rebuild before publishing.' }
    if (git tag --list $Tag) { throw "Tag $Tag already exists." }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is required to publish.' }

    $notes = "Unsigned Windows x64 installer for MatchRadar $version, built from main commit $head.`n`nSee CHANGELOG.md for changes.`n`nApp version: $version`nSHA-256: $hash`n`nRequires 64-bit Windows 10/11 with the WebView2 runtime. Quit MatchRadar from the tray before installing. There is no auto-updater; install this build over the previous version."
    $notesPath = Join-Path $installer.DirectoryName "release-notes.txt"
    [IO.File]::WriteAllText($notesPath, $notes, [Text.UTF8Encoding]::new($false))
    gh release create $Tag "$($installer.FullName)#MatchRadar $version installer" `
        --target $head --title "MatchRadar $version (build $($head.Substring(0, 7)))" --notes-file $notesPath --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)." }
    Write-Host "Published $Tag with the locally built installer."
}
finally {
    Pop-Location
}
