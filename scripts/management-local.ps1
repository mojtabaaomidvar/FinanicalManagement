param(
    [ValidateSet('Start', 'Stop', 'Check')][string]$Action = 'Start',
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$state = Join-Path $project '.local-test\management'
$config = Join-Path $state 'config.json'
$pidFile = Join-Path $state 'server.pid'
$origin = if (Test-Path $config) { (Get-Content $config -Raw | ConvertFrom-Json).origin } else { 'http://127.0.0.1:5910' }
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Find-ManagementProcess {
    if (-not (Test-Path $pidFile)) { return $null }
    $serverProcessId = [int](Get-Content $pidFile -Raw)
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId" -ErrorAction SilentlyContinue
    if ($serverProcess -and $serverProcess.CommandLine -match 'app\.management\.cli' -and $serverProcess.CommandLine -like "*$config*") { return $serverProcess }
    return $null
}

$running = Find-ManagementProcess
if ($Action -eq 'Stop') {
    if ($running) { Stop-Process -Id $running.ProcessId -ErrorAction Stop }
    Write-Output 'Management demo stopped. Its data and credentials were retained.'
    exit 0
}
if ($Action -eq 'Check') {
    if (-not $running) { throw 'Management demo is not running.' }
    $response = Invoke-RestMethod "$origin/management/api/session" -TimeoutSec 5
    if ($response.mode -ne 'demo') { throw 'Unexpected management service.' }
    Write-Output "Management demo ready: $origin"
    exit 0
}
if (-not $running) {
    New-Item -ItemType Directory -Force -Path $state | Out-Null
    $port = $null
    foreach ($candidate in @(5910, 0)) {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
        try {
            $listener.Start()
            $port = $listener.LocalEndpoint.Port
            break
        } catch { } finally { $listener.Stop() }
    }
    if (-not $port) { throw 'No loopback port is available for the management demo.' }
    $origin = "http://127.0.0.1:$port"
    Push-Location $project
    try {
        & npm.cmd run management:build
        if ($LASTEXITCODE -ne 0) { throw 'Management build failed.' }
    } finally { Pop-Location }
    $configuration = @{ mode = 'demo'; origin = $origin; port = $port; state_dir = $state; web_root = (Join-Path $project '.local-test\management-web') }
    [System.IO.File]::WriteAllText($config, ($configuration | ConvertTo-Json), $utf8)
    Push-Location (Join-Path $project 'backend')
    try {
        & python -X utf8 -m app.management.cli --config $config init --credentials-file (Join-Path $state 'access.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Management demo initialization failed.' }
    } finally { Pop-Location }
    $arguments = @('-X', 'utf8', '-m', 'app.management.cli', '--config', ('"' + $config + '"'), 'serve')
    $server = Start-Process -FilePath (Get-Command python).Source -ArgumentList $arguments -WorkingDirectory (Join-Path $project 'backend') -RedirectStandardOutput (Join-Path $state 'stdout.log') -RedirectStandardError (Join-Path $state 'stderr.log') -WindowStyle Hidden -PassThru
    [System.IO.File]::WriteAllText($pidFile, [string]$server.Id, $utf8)
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-RestMethod "$origin/management/api/session" -TimeoutSec 2
            if ($response.mode -eq 'demo') { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "Management service did not become ready. See $state\stderr.log" }
}
Write-Output "Management demo: $origin"
Write-Output "Local credentials: $state\access.txt"
if (-not $NoOpen) { Start-Process $origin }
