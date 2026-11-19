param(
    [ValidateSet('Start', 'Stop', 'Check')][string]$Action = 'Start',
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDir = Join-Path $taskRoot '.local-test\copy-workbench'
$statePath = Join-Path $taskDir 'process.json'
$workbenchUrl = 'http://127.0.0.1:5701'
$taskRecord = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
function Get-RuntimeHash {
    $runtimeFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $taskRoot 'scripts\copy-workbench') -File -Recurse
        Get-ChildItem -LiteralPath (Join-Path $taskRoot 'tools\copy-workbench') -File -Recurse
        Get-Item -LiteralPath (Join-Path $taskRoot 'vite.config.ts')
    ) | Where-Object { $_.Name -notmatch '\.test\.' } | Sort-Object FullName
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hashInput = ($runtimeFiles | ForEach-Object {
            [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($_.FullName))).Replace('-', '')
        }) -join "`n"
        return [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($hashInput))).Replace('-', '')
    }
    finally { $hasher.Dispose() }
}
function Get-OwnedProcess {
    if (-not $taskRecord) { return $null }
    $process = Get-Process -Id $taskRecord.Id -ErrorAction SilentlyContinue
    if (-not $process -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $taskRecord.StartTicks) { return $null }
    $actualPath = $process.Path
    if (-not $actualPath) { try { $actualPath = $process.MainModule.FileName } catch { return $null } }
    # Previous Start-Process records could have an empty Path. Both the exact
    # recorded creation time and the configured Node executable must still match.
    $expectedPath = if ($taskRecord.Path) { $taskRecord.Path } else { (Get-Command node.exe -ErrorAction Stop).Source }
    if ($actualPath -and $actualPath -eq $expectedPath) { return $process }
    return $null
}
function Request-IdleRestart {
    $editorHtml = Invoke-WebRequest -UseBasicParsing -Uri $workbenchUrl -TimeoutSec 10
    $configMatch = [regex]::Match($editorHtml.Content, 'window\.__COPY_WORKBENCH__=(\{[^;]+\});')
    if (-not $configMatch.Success) { throw 'Cannot obtain the local editor restart key.' }
    $editorConfig = $configMatch.Groups[1].Value | ConvertFrom-Json
    try {
        $claim = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/restart-claim') -Method Post -ContentType 'application/json' `
            -Headers @{ Origin = $workbenchUrl; 'X-Copy-Workbench-Token' = $editorConfig.csrfToken } -Body '{}' -TimeoutSec 10
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) {
            # Older runtimes cannot claim restart after failed initialization. They reject
            # all source mutations while unready; stop only this exact owned, idle process.
            $failedStatus = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/status?quick=1') -TimeoutSec 5
            if (-not $failedStatus.ready -and -not $failedStatus.busy -and
                $failedStatus.operation.kind -eq 'initialize' -and
                $failedStatus.message -ne $failedStatus.operation.message) {
                $failedProcess = Get-OwnedProcess
                if (-not $failedProcess) { throw 'Editor ownership changed during recovery.' }
                Stop-Process -Id $failedProcess.Id
                return $true
            }
            return $false
        }
        throw 'This editor must be stopped while idle with stop-copy-editor.bat before its first upgrade.'
    }
    if (-not $claim.claimed) { return $false }
    $expiresAt = [DateTime]::Parse($claim.expiresAt).ToUniversalTime()
    if ([DateTime]::UtcNow.AddSeconds(1) -ge $expiresAt) { return $false }
    $claimedProcess = Get-OwnedProcess
    if (-not $claimedProcess) { throw 'Editor ownership changed during restart.' }
    Stop-Process -Id $claimedProcess.Id
    return $true
}
if ($Action -eq 'Stop') {
    $process = Get-OwnedProcess
    if ($process) {
        try {
            if (-not (Request-IdleRestart)) { throw 'An editor operation is still running; let it finish before stopping.' }
        } catch {
            if ($_.Exception.Message -ne 'This editor must be stopped while idle with stop-copy-editor.bat before its first upgrade.') { throw }
            # One-time compatibility with the previous editor, which has no restart claim route.
            $legacyStatus = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/status') -TimeoutSec 5
            if ($legacyStatus.busy) { throw 'An editor operation is still running; let it finish before stopping.' }
            $legacyProcess = Get-OwnedProcess
            if ($legacyProcess) { Stop-Process -Id $legacyProcess.Id }
        }
    }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Write-Output 'Copy workbench stopped; source edits and backups preserved.'
    exit 0
}
if ($Action -eq 'Check') {
    $status = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/status?quick=1') -TimeoutSec 5
    if (-not $status.ready) { throw 'Copy workbench is not ready.' }
    $catalog = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/catalog') -TimeoutSec 20
    $scenarios = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/scenarios') -TimeoutSec 5
    if (-not $catalog.entries.Count -or -not $scenarios.scenarios.Count) { throw 'Copy workbench catalog is empty.' }
    Write-Output ('PASS: ' + $catalog.entries.Count + ' source texts, ' + $catalog.visualEntries.Count + ' visual elements, ' + $catalog.iconOptions.Count + ' icons, ' + $scenarios.scenarios.Count + ' preview states, ' + $scenarios.routes.Count + ' pages; local environment ready.')
    exit 0
}
$null = New-Item -ItemType Directory -Path $taskDir -Force
$process = Get-OwnedProcess
$runtimeHash = Get-RuntimeHash
if ($process) {
    # A new feature or updated editor needs a new catalog/build. Never interrupt an Apply.
    $currentStatus = $null
    try {
        $currentStatus = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/status?quick=1') -TimeoutSec 5
    } catch {
        if ($process.HasExited) { $process = $null }
        # A temporarily busy server remains owned and is checked below.
    }
    if ($process -and $currentStatus -and -not $currentStatus.busy) {
        $currentCatalog = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/catalog') -TimeoutSec 20
        $buildState = Get-Content -LiteralPath (Join-Path $taskDir 'state.json') -Raw | ConvertFrom-Json
        if ($taskRecord.RuntimeHash -ne $runtimeHash -or $buildState.revision -ne $currentCatalog.revision -or -not $currentStatus.ready) {
            if (Request-IdleRestart) { $process = $null }
        }
    }
}
if (-not $process) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), 5701)
    try { $listener.Start() } catch { throw 'Port 5701 is occupied by another process; no process was stopped.' } finally { $listener.Stop() }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $entryPath = Join-Path $taskRoot 'scripts\copy-workbench\server.mjs'
    $process = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryPath + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskDir 'server.out.log') -RedirectStandardError (Join-Path $taskDir 'server.err.log')
    $liveProcess = Get-Process -Id $process.Id -ErrorAction Stop
    $recordPath = $liveProcess.Path
    if (-not $recordPath) { $recordPath = $liveProcess.MainModule.FileName }
    if (-not $recordPath) { throw 'Cannot record the copy editor process identity.' }
    $record = @{ Id = $liveProcess.Id; Path = $recordPath; StartTicks = $liveProcess.StartTime.ToUniversalTime().Ticks.ToString(); RuntimeHash = $runtimeHash }
    [IO.File]::WriteAllText($statePath, ($record | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
Write-Output 'Preparing the copy editor and its current app preview...'
for ($attempt = 0; $attempt -lt 240; $attempt++) {
    if ($process.HasExited) { throw 'Copy workbench exited; inspect .local-test/copy-workbench/server.err.log.' }
    try {
        $status = Invoke-RestMethod -Uri ($workbenchUrl + '/__copy/status?quick=1') -TimeoutSec 2
        if ($status.ready) {
            Write-Output $workbenchUrl
            if (-not $NoOpen) { Start-Process -FilePath $workbenchUrl }
            exit 0
        }
    } catch { }
    Start-Sleep -Milliseconds 500
}
throw 'Copy workbench is still preparing; inspect the local logs and run the launcher again.'
