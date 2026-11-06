[CmdletBinding()]
param(
    [string]$Objective,
    [string[]]$Next,
    [string[]]$Blocker,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$file = Join-Path $root 'HANDOFF.md'

function Invoke-Git {
    param([string[]]$Arguments)
    $output = & git -C $root @Arguments 2>$null
    [pscustomobject]@{ Output = @($output); Code = $LASTEXITCODE }
}

$headResult = Invoke-Git @('rev-parse', '--short', 'HEAD')
if ($headResult.Code -ne 0) {
    Write-Host 'HANDOFF requires a Git commit.' -ForegroundColor Red
    exit 1
}
$head = $headResult.Output[0].Trim()

if ($Check) {
    if (-not (Test-Path -LiteralPath $file)) {
        Write-Host 'HANDOFF.md is missing.' -ForegroundColor Red
        exit 1
    }

    $handoffCommit = @((Invoke-Git @('log', '-1', '--format=%H', '--', 'HANDOFF.md')).Output)
    if ($handoffCommit.Count -eq 0 -or -not $handoffCommit[0]) {
        Write-Host 'HANDOFF.md has never been committed.' -ForegroundColor Red
        exit 1
    }
    $handoffCommit = $handoffCommit[0].Trim()

    $otherCommit = @((Invoke-Git @('log', '-1', '--format=%H', '--', '.', ':(exclude)HANDOFF.md')).Output)
    if ($otherCommit.Count -gt 0 -and $otherCommit[0]) {
        $otherCommit = $otherCommit[0].Trim()
        $ancestor = Invoke-Git @('merge-base', '--is-ancestor', $otherCommit, $handoffCommit)
        if ($ancestor.Code -ne 0) {
            $behind = @((Invoke-Git @('rev-list', '--count', "$handoffCommit..HEAD")).Output)
            $count = if ($behind.Count -gt 0) { $behind[0].Trim() } else { 'some' }
            Write-Host "HANDOFF is stale: $count commit(s) changed code after the last handoff." -ForegroundColor Yellow
            Write-Host "Run .\scripts\handoff.ps1 to refresh it, then commit HANDOFF.md." -ForegroundColor Yellow
            exit 1
        }
    }

    Write-Host "HANDOFF is current (last updated in $($handoffCommit.Substring(0, 7)))." -ForegroundColor Green
    exit 0
}

$branch = ($(Invoke-Git @('rev-parse', '--abbrev-ref', 'HEAD')).Output[0]).Trim()
$status = @((Invoke-Git @('status', '--porcelain')).Output) |
    Where-Object { $_ -and -not ($_ -match '(^|\s)HANDOFF\.md$') }
$dirty = @($status).Count
$dirtyText = if ($dirty -eq 0) { 'working tree clean' } else { "$dirty changed file(s)" }

$sync = 'no upstream'
$upstream = Invoke-Git @('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
if ($upstream.Code -eq 0 -and $upstream.Output.Count -gt 0 -and $upstream.Output[0]) {
    $counts = @((Invoke-Git @('rev-list', '--left-right', '--count', "$($upstream.Output[0])...HEAD")).Output)
    if ($counts.Count -gt 0 -and $counts[0]) {
        $parts = ($counts -join ' ').Trim() -split '\s+'
        if ($parts.Count -ge 2) {
            $behind = [int]$parts[0]
            $ahead = [int]$parts[1]
            $sync = if ($ahead -eq 0 -and $behind -eq 0) { 'in sync' } else { "ahead $ahead, behind $behind" }
        }
    }
}

$recent = (@((Invoke-Git @('log', '-3', '--pretty=format:%h %s')).Output) -join ' | ').Trim()
$updated = Get-Date -Format 'yyyy-MM-dd HH:mm (zzz)'

# Commit counts and tree state live in git itself; recording them here would be
# wrong for the very commit that carries this file.
$snapshotText = @"
<!-- snapshot:start -->
## Snapshot
- Updated: $updated
- Branch: $branch
- Recent: $recent
<!-- snapshot:end -->
"@

if (Test-Path -LiteralPath $file) {
    $text = [System.IO.File]::ReadAllText($file)
} else {
    $text = @"
# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: pending
- Branch: pending
- Sync: pending
- Recent: pending
<!-- snapshot:end -->

## Objective

## Next steps

## Blockers

## Decisions

## Commands
"@
}

if ([regex]::IsMatch($text, '(?s)<!-- snapshot:start -->.*?<!-- snapshot:end -->')) {
    $text = [regex]::Replace($text, '(?s)<!-- snapshot:start -->.*?<!-- snapshot:end -->', { param($m) $snapshotText })
} else {
    $text = $text.TrimEnd() + "`n`n" + $snapshotText + "`n"
}

function Set-Section([string]$Body, [string]$Heading, [string]$Content) {
    $pattern = '(?ms)^## ' + [regex]::Escape($Heading) + '\r?\n.*?(?=^## |\z)'
    $replacement = "## $Heading`n`n$Content`n`n"
    if ([regex]::IsMatch($Body, $pattern)) {
        return [regex]::Replace($Body, $pattern, { param($m) $replacement })
    }
    return $Body.TrimEnd() + "`n`n" + $replacement
}

if ($PSBoundParameters.ContainsKey('Objective')) {
    $text = Set-Section $text 'Objective' $Objective
}
if ($PSBoundParameters.ContainsKey('Next')) {
    if ($Next.Count -eq 0) {
        $nextContent = 'None.'
    } else {
        $lines = for ($i = 0; $i -lt $Next.Count; $i++) { "{0}. {1}" -f ($i + 1), $Next[$i] }
        $nextContent = $lines -join "`n"
    }
    $text = Set-Section $text 'Next steps' $nextContent
}
if ($PSBoundParameters.ContainsKey('Blocker')) {
    if ($Blocker.Count -eq 0) {
        $blockerContent = 'None.'
    } else {
        $blockerContent = ($Blocker | ForEach-Object { "- $_" }) -join "`n"
    }
    $text = Set-Section $text 'Blockers' $blockerContent
}

$text = $text.TrimEnd() + "`n"
[System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Updated HANDOFF.md at $head ($branch, $sync)." -ForegroundColor Green
