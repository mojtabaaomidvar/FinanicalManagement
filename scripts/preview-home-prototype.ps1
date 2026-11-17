param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$prototypeRoot = Join-Path $taskRoot 'prototypes\home-groups'
$prototypeTarget = Join-Path $taskRoot '.local-test\site\prototypes\home-groups'
# Keep the preview outside the 127.0.0.1 app service worker's origin.
$prototypeUrl = 'http://localhost:5700/prototypes/home-groups/index.html'

if (-not (Test-Path -LiteralPath (Join-Path $prototypeRoot 'index.html'))) {
    throw 'The home prototype has not been generated.'
}
try {
    $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5700' -TimeoutSec 5
} catch {
    throw 'Start the local preview with start-test.bat or npm run sandbox, then run npm run prototype:home.'
}

$null = New-Item -ItemType Directory -Path $prototypeTarget -Force
$null = New-Item -ItemType Directory -Path (Join-Path $prototypeTarget 'assets') -Force
Copy-Item -LiteralPath (Join-Path $prototypeRoot 'index.html') -Destination (Join-Path $prototypeTarget 'index.html') -Force
Copy-Item -LiteralPath (Join-Path $prototypeRoot 'assets\Vazirmatn.woff2') -Destination (Join-Path $prototypeTarget 'assets\Vazirmatn.woff2') -Force
Copy-Item -LiteralPath (Join-Path $prototypeRoot 'assets\OFL.txt') -Destination (Join-Path $prototypeTarget 'assets\OFL.txt') -Force

$response = Invoke-WebRequest -UseBasicParsing -Uri $prototypeUrl -TimeoutSec 5
if ($response.StatusCode -ne 200) { throw 'Could not serve the home prototype.' }
Write-Output $prototypeUrl
if (-not $NoOpen) {
    # The user requested an interactive preview in their browser.
    Start-Process -FilePath $prototypeUrl
}
