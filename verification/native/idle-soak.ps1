param(
    [ValidateRange(0.01, 10080)][double]$DurationMinutes = 30,
    [ValidateRange(1, 3600)][int]$IntervalSeconds = 30,
    [Parameter(Mandatory = $true)][string]$OutCsv
)

$ErrorActionPreference = "Stop"
$installed = Join-Path $env:LOCALAPPDATA "MatchRadar\matchradar.exe"
$cores = [Environment]::ProcessorCount
$parent = Split-Path ([IO.Path]::GetFullPath($OutCsv)) -Parent
if (!(Test-Path $parent -PathType Container)) { throw "Output directory does not exist: $parent" }
if (Test-Path $OutCsv) { throw "Refusing to overwrite $OutCsv" }
$rows = New-Object System.Collections.Generic.List[object]
$previous = @{}
$clock = [Diagnostics.Stopwatch]::StartNew()
$previousElapsed = 0.0
$duration = $DurationMinutes * 60
Write-Output "SOAK_START=$([DateTimeOffset]::Now.ToString('o')) CORES=$cores CSV=$OutCsv"

while ($true) {
    $tree = @(Get-CimInstance Win32_Process)
    $roots = @($tree | Where-Object { $_.Name -ieq "matchradar.exe" -and $_.ExecutablePath -ieq $installed })
    if ($roots.Count -ne 1) { throw "Expected one installed MatchRadar process; found $($roots.Count)" }
    $ids = @{}
    $ids[[int]$roots[0].ProcessId] = $true
    do {
        $added = $false
        foreach ($node in $tree) {
            if ($ids.ContainsKey([int]$node.ParentProcessId) -and !$ids.ContainsKey([int]$node.ProcessId)) {
                $ids[[int]$node.ProcessId] = $true
                $added = $true
            }
        }
    } while ($added)
    $selected = @($tree | Where-Object {
        $ids.ContainsKey([int]$_.ProcessId) -and ($_.Name -ieq "matchradar.exe" -or $_.Name -ieq "msedgewebview2.exe")
    })
    $current = @{}
    $cpuDelta = 0.0
    $working = 0.0; $private = 0.0; $handles = 0L; $threads = 0L
    $newProcesses = 0
    foreach ($node in $selected) {
        $key = "$($node.ProcessId):$($node.CreationDate.ToUniversalTime().Ticks)"
        $cpu = ([double]$node.KernelModeTime + [double]$node.UserModeTime) / 10000000
        $current[$key] = $cpu
        if ($previous.ContainsKey($key)) { $cpuDelta += [Math]::Max(0, $cpu - $previous[$key]) }
        elseif ($rows.Count -gt 0) { $cpuDelta += $cpu; $newProcesses++ }
        $working += [double]$node.WorkingSetSize
        $private += [double]$node.PrivatePageCount
        $handles += [long]$node.HandleCount
        $threads += [long]$node.ThreadCount
    }
    $elapsed = $clock.Elapsed.TotalSeconds
    $interval = $elapsed - $previousElapsed
    $cpuPercent = $null
    if ($rows.Count -gt 0) { $cpuPercent = 100 * $cpuDelta / $interval / $cores }
    $lost = @($previous.Keys | Where-Object { !$current.ContainsKey($_) }).Count
    $row = [pscustomobject]@{
        Timestamp = [DateTimeOffset]::Now.ToString("o")
        ElapsedSeconds = $elapsed
        IntervalSeconds = $interval
        ProcessCount = $selected.Count
        CpuDeltaSeconds = $(if ($rows.Count -gt 0) { $cpuDelta } else { $null })
        CpuPercent = $cpuPercent
        WorkingSetBytes = $working
        PrivateBytes = $private
        Handles = $handles
        Threads = $threads
        NewProcesses = $newProcesses
        ExitedProcesses = $lost
    }
    $row | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Append
    $rows.Add($row)
    $previous = $current
    $previousElapsed = $elapsed
    if ($elapsed -ge $duration) { break }
    Start-Sleep -Milliseconds ([int](1000 * [Math]::Min($IntervalSeconds, $duration - $elapsed)))
}

Write-Output "SOAK_END=$([DateTimeOffset]::Now.ToString('o')) SAMPLES=$($rows.Count)"
foreach ($field in @("WorkingSetBytes", "PrivateBytes")) {
    $values = @($rows | ForEach-Object { $_.$field / 1MB })
    $stats = $values | Measure-Object -Minimum -Maximum -Average
    $meanX = ($rows | Measure-Object ElapsedSeconds -Average).Average
    $numerator = 0.0; $denominator = 0.0
    for ($i = 0; $i -lt $rows.Count; $i++) {
        $dx = $rows[$i].ElapsedSeconds - $meanX
        $numerator += $dx * ($values[$i] - $stats.Average)
        $denominator += $dx * $dx
    }
    $slope = $(if ($denominator -gt 0) { 3600 * $numerator / $denominator } else { 0 })
    Write-Output ("{0} MiB: start={1:F3} end={2:F3} min={3:F3} max={4:F3} mean={5:F3} slopeMiBPerHour={6:F3}" -f $field,$values[0],$values[-1],$stats.Minimum,$stats.Maximum,$stats.Average,$slope)
}
$cpuValues = @($rows | Where-Object { $null -ne $_.CpuPercent } | ForEach-Object { $_.CpuPercent } | Sort-Object)
if ($cpuValues.Count -gt 0) {
    $p95 = $cpuValues[[Math]::Ceiling(0.95 * $cpuValues.Count) - 1]
    Write-Output ("CPU normalized percent: mean={0:F4} p95={1:F4}" -f ($cpuValues | Measure-Object -Average).Average,$p95)
}
Write-Output "CPU excludes unsampled final CPU of exited processes; see ExitedProcesses for incomplete intervals."
