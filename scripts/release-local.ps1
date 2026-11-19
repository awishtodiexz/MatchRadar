[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$Publish,
    [string]$Tag,
    # Run the trust checks against a specific file (for example a stand-in) instead of the built installer. Not allowed with -Publish.
    [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    if ($Publish -and $InstallerPath) { throw '-InstallerPath is for checking a file only; publish uses the locally built installer.' }

    node 'scripts/check-version.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Version check failed.' }

    $version = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    $head = (git rev-parse HEAD).Trim()
    if (-not $Tag) { $Tag = "v$version" }
    git check-ref-format "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) { throw "Invalid release tag: $Tag" }
    if ($Tag -ne "v$version") { throw "Release tag $Tag must match app version v$version." }

    if (-not $SkipBuild -and -not $InstallerPath) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-local.ps1')
        if ($LASTEXITCODE -ne 0) { throw "Installer build failed (exit $LASTEXITCODE)." }
    }

    if ($InstallerPath) {
        $installer = Get-Item -LiteralPath $InstallerPath
    } else {
        $installer = Get-ChildItem 'src-tauri\target\release\bundle\nsis\MatchRadar_*_x64-setup.exe' `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*_$($version)_*" } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1
    }
    if (-not $installer) {
        throw "No $version installer found. Run without -SkipBuild or build it locally first."
    }

    # Trust checks: every result is printed, in a dry run and before publishing.
    $checks = New-Object System.Collections.Generic.List[object]
    function Add-Check([string]$Name, [bool]$Ok, [string]$Detail) {
        $checks.Add([pscustomobject]@{ Check = $Name; Result = $(if ($Ok) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
    }

    $hash = (Get-FileHash $installer.FullName -Algorithm SHA256).Hash
    $stamp = Join-Path $root 'src-tauri\target\release\bundle\nsis\verified-commit'
    $verified = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { '' }
    Add-Check 'Checksum' ($verified -eq "$head $hash") $(if ($verified -eq "$head $hash") {
            "SHA-256 matches the checked build of $head"
        } elseif ($verified) { "verified-commit stamp is '$verified', not '$head $hash'" } else {
            'no verified-commit stamp; run scripts/build-local.ps1 without -SkipTests on a clean tree' })

    $dirty = @(git status --porcelain)
    Add-Check 'Clean tree' ($dirty.Count -eq 0) $(if ($dirty.Count -eq 0) { 'no uncommitted changes' } else { "$($dirty.Count) uncommitted change(s)" })
    $branch = (git branch --show-current).Trim()
    Add-Check 'Branch' ($branch -eq 'main') "on '$branch'"
    Add-Check 'Tag matches version' ($Tag -eq "v$version") "tag $Tag, package.json $version"
    $tagCommit = if (git tag --list $Tag) { (git rev-list -n 1 $Tag).Trim() } else { '' }
    Add-Check 'Tag is new' (-not $tagCommit) $(if ($tagCommit) {
            "$Tag already exists at $tagCommit$(if ($tagCommit -eq $head) { ' (HEAD)' } else { ', not HEAD' })"
        } else { "$Tag will be created at HEAD $head" })
    $commitTime = [DateTimeOffset]::FromUnixTimeSeconds([int64](git log -1 --format=%ct)).LocalDateTime
    Add-Check 'Installer newer than HEAD' ($installer.LastWriteTime -ge $commitTime) "built $($installer.LastWriteTime), HEAD committed $commitTime"

    $sig = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    $sigStatus = "$($sig.Status)"
    $signer = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }
    $signed = $sigStatus -eq 'Valid'
    # Unsigned is allowed and disclosed; a present but broken signature is not.
    Add-Check 'Authenticode' ($signed -or $sigStatus -eq 'NotSigned') $(switch ($sigStatus) {
            'Valid' { "signed and valid: $signer" }
            'NotSigned' { 'UNSIGNED - users will see a SmartScreen warning' }
            default { "signature present but $sigStatus$(if ($signer) { " ($signer)" }): $($sig.StatusMessage)" }
        })

    Write-Host "Installer: $($installer.FullName)"
    Write-Host "Size:      $($installer.Length) bytes"
    Write-Host "SHA-256:   $hash"
    Write-Host "Signature: $(if ($signed) { "Authenticode-signed by $signer" } else { "NOT SIGNED ($sigStatus)" })"
    Write-Host "Source:    $head on '$branch', tag $Tag"
    $checks | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
    $failed = @($checks | Where-Object { $_.Result -eq 'FAIL' })

    if (-not $Publish) {
        if ($failed.Count) {
            Write-Host "Not ready to publish ${Tag}: $($failed.Count) check(s) failed." -ForegroundColor Yellow
        } else {
            Write-Host "Ready to publish $Tag. Review the checks and release notes, then run with -Publish."
        }
        Write-Host "This does not push commits or create tags unless -Publish is used."
        if ($failed.Count) { exit 1 }
        return
    }

    if ($failed.Count) { throw "Refusing to publish: $(($failed | ForEach-Object { $_.Check }) -join ', ') failed." }
    git fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify origin/main.' }
    $remote = (git rev-parse origin/main).Trim()
    if ($head -ne $remote) { throw 'Push main before publishing so the tag and installer match.' }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is required to publish.' }
    $staging = Join-Path $root 'src-tauri\target\release\upload'
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $staging | Out-Null
    $upload = Copy-Item $installer.FullName (Join-Path $staging $installer.Name) -PassThru
    $uploadHash = (Get-FileHash $upload.FullName -Algorithm SHA256).Hash
    if ($uploadHash -ne $hash) { throw "Staged installer hash $uploadHash differs from checked hash $hash." }

    $signing = if ($signed) {
        "Authenticode-signed Windows x64 installer for MatchRadar $version (signer: $signer)."
    } else {
        "Unsigned Windows x64 installer for MatchRadar $version. It has no Authenticode signature, so Windows SmartScreen may warn before running it; verify the SHA-256 below first, then choose More info, then Run anyway."
    }
    $notes = "$signing`n`nSHA-256: $hash`nBuilt from commit $head (tag $Tag).`n`nRequires 64-bit Windows 10/11 with the WebView2 runtime. Quit MatchRadar from the tray before installing. There is no auto-updater; future updates install over this version."
    $notesPath = Join-Path $installer.DirectoryName "release-notes.txt"
    [IO.File]::WriteAllText($notesPath, $notes, [Text.UTF8Encoding]::new($false))
    gh release create $Tag "$($upload.FullName)#MatchRadar $version installer" `
        --target $head --title "MatchRadar $version" --notes-file $notesPath --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed (exit $LASTEXITCODE)." }
    Write-Host "Published $Tag with the locally built installer."
}
finally {
    Pop-Location
}
