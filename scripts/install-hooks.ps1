[CmdletBinding()]
param()

$root = Split-Path -Parent $PSScriptRoot
& git -C $root config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to set core.hooksPath.'
}
Write-Host 'Git hooks installed: core.hooksPath=.githooks' -ForegroundColor Green
Write-Host 'The pre-push hook blocks pushes when HANDOFF.md is stale.'
