param(
    [ValidateSet('Start', 'Stop', 'Check', 'Refresh')][string]$Action = 'Start',
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDir = Join-Path $taskRoot '.local-test'
$configPath = Join-Path $taskDir 'config.json'
$statePath = Join-Path $taskDir 'processes.json'
$dataPath = Join-Path $taskDir 'pgdata'
$sitePath = Join-Path $taskDir 'site'
$backendPath = Join-Path $taskRoot 'backend'
$browserUrl = 'http://127.0.0.1:5700'

function Write-JsonFile($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}

function Get-SandboxEnvironment($Config) {
    $environment = @{
        APP_ENV = 'local-sandbox'
        DATABASE_URL = 'postgresql+psycopg://khaneyar_sandbox:' + $Config.AppPassword + '@127.0.0.1:55439/khaneyar_local_sandbox'
        FILE_SIGNING_SECRET = $Config.SigningSecret
        DOCUMENT_ENCRYPTION_KEY = $Config.DocumentEncryptionKey
        RATE_LIMIT_SALT = $Config.RateLimitSalt
        STORAGE_DIR = Join-Path $taskDir 'uploads'
        PYTHONUTF8 = '1'
    }
    $operatorPath = Join-Path $taskDir 'support-operator.json'
    if (Test-Path -LiteralPath $operatorPath) {
        $operator = Get-Content -LiteralPath $operatorPath -Raw | ConvertFrom-Json
        $environment['SUPPORT_USERNAME'] = $operator.Username
        $environment['SUPPORT_PASSWORD_HASH'] = $operator.PasswordHash
    }
    return $environment
}

function Test-OwnedProcess($Record) {
    if (-not $Record) { return $false }
    $process = Get-Process -Id $Record.Id -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    $actualProcessPath = $process.Path
    if (-not $actualProcessPath) { try { $actualProcessPath = $process.MainModule.FileName } catch { return $false } }
    return ($process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Record.StartTicks -and
            $actualProcessPath -eq $Record.Path)
}

function Get-ProcessRecord($Process) {
    # Start-Process objects can retain an empty Path; query the live process after readiness.
    $recordProcess = Get-Process -Id $Process.Id -ErrorAction Stop
    $recordPath = $recordProcess.Path
    if (-not $recordPath) { $recordPath = $recordProcess.MainModule.FileName }
    if (-not $recordPath) { throw 'Cannot record the identity of the local service.' }
    return @{ Id = $recordProcess.Id; StartTicks = $recordProcess.StartTime.ToUniversalTime().Ticks.ToString(); Path = $recordPath }
}

function Assert-FreePort([int]$Port) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $Port)
    try { $listener.Start() }
    catch { throw "Local test port $Port is unavailable. Stop the other process first." }
    finally { $listener.Stop() }
}

function Invoke-PgControl([string]$Operation) {
    $pgArgs = '-D "' + $dataPath + '" '
    if ($Operation -eq 'start') {
        $pgArgs += '-l "' + (Join-Path $taskDir 'postgres.log') + '" -o "-h 127.0.0.1 -p 55439 -c timezone=UTC" '
    }
    $pgArgs += '-w -t 30 ' + $Operation
    $control = Start-Process -FilePath (Join-Path $taskConfig.PgBin 'pg_ctl.exe') -ArgumentList $pgArgs `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskDir 'pgctl.out.log') `
        -RedirectStandardError (Join-Path $taskDir 'pgctl.err.log')
    # Keep the process handle so Windows PowerShell 5 retains its exit code.
    $null = $control.Handle
    if (-not $control.WaitForExit(40000)) { throw 'PostgreSQL control timed out. See .local-test/pgctl.err.log.' }
    $control.Refresh()
    if ($control.ExitCode -ne 0) { throw 'PostgreSQL control failed. See .local-test/pgctl.err.log.' }
}

function Wait-Http([string]$Url, $Process) {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($Process.HasExited) { throw 'Local test service exited. See the logs in .local-test.' }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Local test service did not become ready: $Url"
}

$taskState = if (Test-Path -LiteralPath $statePath) { Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } else { $null }
$taskConfig = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { $null }

if ($Action -eq 'Stop') {
    if ($taskState) {
        foreach ($record in @($taskState.Frontend, $taskState.Api)) {
            if (Test-OwnedProcess $record) { Stop-Process -Id $record.Id }
        }
    }
    if ($taskConfig -and (Test-Path -LiteralPath (Join-Path $dataPath 'postmaster.pid'))) { Invoke-PgControl 'stop' }
    if (Test-Path -LiteralPath $statePath) { Remove-Item -LiteralPath $statePath }
    Write-Output 'Local test environment stopped. Your test data is preserved.'
    exit 0
}

$pythonPath = if (Test-Path -LiteralPath (Join-Path $backendPath '.venv\Scripts\python.exe')) {
    Join-Path $backendPath '.venv\Scripts\python.exe'
} else { (Get-Command python.exe -ErrorAction Stop).Source }

if ($Action -eq 'Refresh') {
    if (-not $taskConfig -or -not $taskState -or
        -not (Test-OwnedProcess $taskState.Api) -or -not (Test-OwnedProcess $taskState.Frontend)) {
        throw 'Start the local test environment with start-test.bat before refreshing it.'
    }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $vitePath = Join-Path $taskRoot 'node_modules\vite\bin\vite.js'
    $refreshId = [DateTime]::UtcNow.Ticks.ToString()
    $stagedSite = [IO.Path]::GetFullPath((Join-Path $taskDir ('site-refresh-' + $refreshId)))
    $previousSite = [IO.Path]::GetFullPath((Join-Path $taskDir ('site-previous-' + $refreshId)))
    $allowedPrefix = [IO.Path]::GetFullPath($taskDir).TrimEnd('\') + '\'
    foreach ($refreshTarget in @($sitePath, $stagedSite, $previousSite)) {
        $absoluteTarget = [IO.Path]::GetFullPath($refreshTarget)
        if (-not $absoluteTarget.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refresh paths must remain inside this project local-test directory.'
        }
        if ((Test-Path -LiteralPath $absoluteTarget) -and
            ((Get-Item -LiteralPath $absoluteTarget).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refresh refuses a linked site directory.'
        }
    }
    Write-Output 'Building the updated local app; current services and data remain available.'
    Push-Location $taskRoot
    try {
        & $nodePath (Join-Path $taskRoot 'node_modules\typescript\bin\tsc') -b
        if ($LASTEXITCODE -ne 0) { throw 'Code check failed; the running local app was preserved.' }
        & $nodePath $vitePath build --mode local-sandbox --outDir $stagedSite
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed; the running local app was preserved.' }
    } finally { Pop-Location }
    $newFrontend = $null
    $newApi = $null
    $siteMoved = $false
    $previousSiteMoved = $false
    $frontendStopped = $false
    $apiStopped = $false
    $savedRefreshEnvironment = @{}
    try {
        # Recheck ownership after the build before stopping or moving anything.
        if (-not (Test-OwnedProcess $taskState.Api) -or -not (Test-OwnedProcess $taskState.Frontend)) {
            throw 'Local services changed during the build; refresh was not applied.'
        }
        Stop-Process -Id $taskState.Frontend.Id
        $frontendStopped = $true
        if (Test-Path -LiteralPath $sitePath) {
            Move-Item -LiteralPath $sitePath -Destination $previousSite
            $previousSiteMoved = $true
        }
        Move-Item -LiteralPath $stagedSite -Destination $sitePath
        $siteMoved = $true
        $newFrontend = Start-Process -FilePath $nodePath -ArgumentList ('"' + $vitePath + '" preview --mode local-sandbox --outDir "' + $sitePath + '" --host 127.0.0.1 --port 5700 --strictPort') `
            -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $taskDir 'frontend.out.log') -RedirectStandardError (Join-Path $taskDir 'frontend.err.log')
        Wait-Http ($browserUrl + '/api/v1/auth/config') $newFrontend
        $refreshEnvironment = Get-SandboxEnvironment $taskConfig
        foreach ($key in $refreshEnvironment.Keys) {
            $savedRefreshEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $refreshEnvironment[$key], 'Process')
        }
        if (-not (Test-OwnedProcess $taskState.Api)) { throw 'The local API changed during refresh.' }
        Stop-Process -Id $taskState.Api.Id
        $apiStopped = $true
        $newApi = Start-Process -FilePath $pythonPath -ArgumentList ('"' + (Join-Path $backendPath 'scripts\serve_local_sandbox.py') + '"') `
            -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $taskDir 'api.out.log') -RedirectStandardError (Join-Path $taskDir 'api.err.log')
        Wait-Http 'http://127.0.0.1:5800/api/v1/auth/config' $newApi
        Write-JsonFile $statePath @{ Api = Get-ProcessRecord $newApi; Frontend = Get-ProcessRecord $newFrontend }
        Write-Output ('Local app refreshed: ' + $browserUrl + '. Existing database and uploads were preserved.')
        if ($OpenBrowser) { Start-Process $browserUrl }
    } catch {
        $refreshFailure = $_
        if (-not $frontendStopped) { throw }
        if ($newFrontend -and -not $newFrontend.HasExited) { Stop-Process -Id $newFrontend.Id -ErrorAction SilentlyContinue }
        if ($previousSiteMoved -and (Test-Path -LiteralPath $previousSite)) {
            # Both resolved targets were checked above; keep the failed build for inspection.
            if ($siteMoved) { Move-Item -LiteralPath $sitePath -Destination $stagedSite }
            Move-Item -LiteralPath $previousSite -Destination $sitePath
        }
        try {
            $restoredFrontend = Start-Process -FilePath $nodePath -ArgumentList ('"' + $vitePath + '" preview --mode local-sandbox --outDir "' + $sitePath + '" --host 127.0.0.1 --port 5700 --strictPort') `
                -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput (Join-Path $taskDir 'frontend.out.log') -RedirectStandardError (Join-Path $taskDir 'frontend.err.log')
            Wait-Http $browserUrl $restoredFrontend
            if ($apiStopped) {
                if ($newApi -and -not $newApi.HasExited) { Stop-Process -Id $newApi.Id -ErrorAction SilentlyContinue }
                # The isolated environment is still set and is restored only in finally.
                $currentApi = Start-Process -FilePath $pythonPath -ArgumentList ('"' + (Join-Path $backendPath 'scripts\serve_local_sandbox.py') + '"') `
                    -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru `
                    -RedirectStandardOutput (Join-Path $taskDir 'api.out.log') -RedirectStandardError (Join-Path $taskDir 'api.err.log')
                Wait-Http 'http://127.0.0.1:5800/api/v1/auth/config' $currentApi
            } elseif (Test-OwnedProcess $taskState.Api) {
                $currentApi = Get-Process -Id $taskState.Api.Id -ErrorAction Stop
            } else { throw 'The previous local API is no longer owned by this environment.' }
            Write-JsonFile $statePath @{ Api = Get-ProcessRecord $currentApi; Frontend = Get-ProcessRecord $restoredFrontend }
        } catch { throw 'Refresh failed and service recovery did not complete. Inspect the local-test logs; database and uploads were preserved.' }
        throw $refreshFailure
    } finally {
        foreach ($key in $savedRefreshEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $savedRefreshEnvironment[$key], 'Process')
        }
    }
    exit 0
}

if ($Action -eq 'Check') {
    if (-not $taskConfig) { throw 'Start the local test environment before checking it.' }
    $checkEnvironment = Get-SandboxEnvironment $taskConfig
    $savedCheckEnvironment = @{}
    try {
        foreach ($key in $checkEnvironment.Keys) {
            $savedCheckEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $checkEnvironment[$key], 'Process')
        }
        & $pythonPath (Join-Path $backendPath 'scripts\check_local_sandbox.py')
        $checkExitCode = $LASTEXITCODE
    } finally {
        foreach ($key in $savedCheckEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $savedCheckEnvironment[$key], 'Process')
        }
    }
    exit $checkExitCode
}

if ($taskState -and (Test-OwnedProcess $taskState.Api) -and (Test-OwnedProcess $taskState.Frontend)) {
    Write-Output "Local test environment is already running: $browserUrl"
    if ($OpenBrowser) { Start-Process $browserUrl }
    exit 0
}
if ($taskState) {
    foreach ($record in @($taskState.Frontend, $taskState.Api)) {
        if (Test-OwnedProcess $record) { Stop-Process -Id $record.Id }
    }
}

Assert-FreePort 5700
Assert-FreePort 5800
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$vitePath = Join-Path $taskRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $vitePath)) { throw 'Run npm install in this project first.' }
& $pythonPath -c 'import fastapi, uvicorn, sqlalchemy, psycopg, alembic, argon2, cryptography, jdatetime'
if ($LASTEXITCODE -ne 0) { throw 'Install the backend dependencies first: python -m pip install -e "backend[dev]"' }

if (-not $taskConfig) {
    $pgCandidates = @($env:KHANEYAR_SANDBOX_PG_BIN)
    $pgCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($pgCommand) { $pgCandidates += Split-Path $pgCommand.Source }
    $pgInstallRoot = Join-Path $env:ProgramFiles 'PostgreSQL'
    if (Test-Path -LiteralPath $pgInstallRoot) {
        $pgCandidates += Get-ChildItem -LiteralPath $pgInstallRoot -Directory | ForEach-Object { Join-Path $_.FullName 'bin' }
    }
    $previousTestRoot = Join-Path $env:USERPROFILE '.codex\tmp'
    if (Test-Path -LiteralPath $previousTestRoot) {
        $pgCandidates += Get-ChildItem -LiteralPath $previousTestRoot -Directory -Filter 'khaneyar-*' |
            ForEach-Object { Join-Path $_.FullName 'pgsql\bin' }
    }
    $pgBin = $pgCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'pg_ctl.exe')) } | Select-Object -First 1
    if (-not $pgBin) { throw 'Set KHANEYAR_SANDBOX_PG_BIN to the PostgreSQL bin directory, then start again.' }
    New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
    $taskConfig = [pscustomobject]@{
        PgBin = [IO.Path]::GetFullPath($pgBin)
        BootstrapPassword = [Guid]::NewGuid().ToString('N')
        AppPassword = [Guid]::NewGuid().ToString('N')
        SigningSecret = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
        RateLimitSalt = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
    }
    Write-JsonFile $configPath $taskConfig
}

if (-not $taskConfig.DocumentEncryptionKey) {
    $documentKeyBytes = New-Object byte[] 32
    $documentKeyRandom = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $documentKeyRandom.GetBytes($documentKeyBytes) }
    finally { $documentKeyRandom.Dispose() }
    $taskConfig | Add-Member -NotePropertyName DocumentEncryptionKey -NotePropertyValue ([Convert]::ToBase64String($documentKeyBytes)) -Force
    Write-JsonFile $configPath $taskConfig
}

$psqlPath = Join-Path $taskConfig.PgBin 'psql.exe'
if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION'))) {
    if (Test-Path -LiteralPath $dataPath) { throw 'Incomplete local PostgreSQL setup; inspect .local-test/pgdata before retrying.' }
    Assert-FreePort 55439
    $passwordFile = Join-Path $taskDir 'bootstrap-password.txt'
    [IO.File]::WriteAllText($passwordFile, $taskConfig.BootstrapPassword, [Text.UTF8Encoding]::new($false))
    try {
        & (Join-Path $taskConfig.PgBin 'initdb.exe') -D $dataPath -U sandbox_bootstrap `
            --pwfile=$passwordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL initialization failed.' }
    } finally { Remove-Item -LiteralPath $passwordFile -ErrorAction SilentlyContinue }
}

$savedEnvironment = @{}
$environment = Get-SandboxEnvironment $taskConfig
$environment['PGPASSWORD'] = $taskConfig.BootstrapPassword
foreach ($key in $environment.Keys) {
    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
}

$apiProcess = $null
$frontendProcess = $null
$startedPostgres = $false
try {
    & (Join-Path $taskConfig.PgBin 'pg_ctl.exe') -D $dataPath status *> $null
    if ($LASTEXITCODE -ne 0) {
        Assert-FreePort 55439
        Invoke-PgControl 'start'
        $startedPostgres = $true
    }
    $roleExists = & $psqlPath -X -w -h 127.0.0.1 -p 55439 -U sandbox_bootstrap -d postgres -At `
        -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_roles WHERE rolname='khaneyar_sandbox'"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot connect to the isolated local PostgreSQL cluster.' }
    $bootstrapSql = Join-Path $taskDir 'bootstrap.sql'
    if ($roleExists -ne '1') {
        [IO.File]::WriteAllText($bootstrapSql, ("CREATE ROLE khaneyar_sandbox LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + $taskConfig.AppPassword + "';"))
        & $psqlPath -X -w -h 127.0.0.1 -p 55439 -U sandbox_bootstrap -d postgres -v ON_ERROR_STOP=1 -f $bootstrapSql
        if ($LASTEXITCODE -ne 0) { throw 'Cannot create the local sandbox database role.' }
        Remove-Item -LiteralPath $bootstrapSql
    }
    $databaseExists = & $psqlPath -X -w -h 127.0.0.1 -p 55439 -U sandbox_bootstrap -d postgres -At `
        -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname='khaneyar_local_sandbox'"
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the local sandbox database.' }
    if ($databaseExists -ne '1') {
        & $psqlPath -X -w -h 127.0.0.1 -p 55439 -U sandbox_bootstrap -d postgres -v ON_ERROR_STOP=1 `
            -c 'CREATE DATABASE khaneyar_local_sandbox OWNER khaneyar_sandbox'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot create the local sandbox database.' }
    }

    [Environment]::SetEnvironmentVariable('PGPASSWORD', $null, 'Process')

    Push-Location $backendPath
    try {
        & $pythonPath (Join-Path $backendPath 'scripts\seed_local_sandbox.py')
        if ($LASTEXITCODE -ne 0) { throw 'Local sandbox migration or seeding failed.' }
    } finally { Pop-Location }

    $apiProcess = Start-Process -FilePath $pythonPath -ArgumentList ('"' + (Join-Path $backendPath 'scripts\serve_local_sandbox.py') + '"') `
        -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskDir 'api.out.log') -RedirectStandardError (Join-Path $taskDir 'api.err.log')
    Wait-Http 'http://127.0.0.1:5800/api/v1/auth/config' $apiProcess
    Push-Location $taskRoot
    try {
        & $nodePath $vitePath build --mode local-sandbox --outDir $sitePath
        if ($LASTEXITCODE -ne 0) { throw 'Local sandbox frontend build failed.' }
    } finally { Pop-Location }
    $frontendProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $vitePath + '" preview --mode local-sandbox --outDir "' + $sitePath + '" --host 127.0.0.1 --port 5700 --strictPort') `
        -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $taskDir 'frontend.out.log') -RedirectStandardError (Join-Path $taskDir 'frontend.err.log')
    Wait-Http ($browserUrl + '/api/v1/auth/config') $frontendProcess
    Write-JsonFile $statePath @{ Api = Get-ProcessRecord $apiProcess; Frontend = Get-ProcessRecord $frontendProcess }
    Write-Output "Local test environment ready: $browserUrl"
    Write-Output 'Phones: owner 09000000001, member 1 09000000002, member 2 09000000003, admin 09000000004'
    Write-Output 'Password for all test accounts: Test12345!'
    Write-Output 'Data persists between restarts. Use stop-test.bat to stop the environment.'
    if ($OpenBrowser) { Start-Process $browserUrl }
} catch {
    foreach ($process in @($frontendProcess, $apiProcess)) {
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    }
    if ($startedPostgres) { Invoke-PgControl 'stop' }
    throw
} finally {
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
}
