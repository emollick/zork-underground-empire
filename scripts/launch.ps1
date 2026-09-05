$ErrorActionPreference = 'Stop'
$zorkRoot = Split-Path -Parent $PSScriptRoot
$zorkNode = Join-Path $zorkRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $zorkNode)) {
    $zorkNode = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $zorkNode) { throw 'The game runtime is missing. Extract the complete Zork folder and try again.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $zorkRoot 'dist\index.html'))) { throw 'The game files are missing. Extract the complete Zork folder before launching.' }
$zorkPort = 5195
$zorkRunning = $false
try {
    $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$zorkPort/health" -TimeoutSec 1
    $zorkRunning = $reply.game -eq 'zork'
} catch { }
if (-not $zorkRunning) {
    $listener = Get-NetTCPConnection -LocalPort $zorkPort -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $zorkPort is being used by another application. Close that application and launch Zork again. The game uses a fixed address to keep your saved expedition together." }
}
if (-not $zorkRunning) {
    $zorkServer = Join-Path $PSScriptRoot 'serve.mjs'
    $arguments = '"' + $zorkServer + '" --port ' + $zorkPort
    Start-Process -FilePath $zorkNode -ArgumentList $arguments -WorkingDirectory $zorkRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $reply = Invoke-RestMethod -Uri "http://127.0.0.1:$zorkPort/health" -TimeoutSec 1
            if ($reply.game -eq 'zork') { $zorkRunning = $true; break }
        } catch { Start-Sleep -Milliseconds 150 }
    }
}
if (-not $zorkRunning) { throw 'The local game could not start. Try launching again or open README.md for help.' }
$zorkUrl = "http://127.0.0.1:$zorkPort/"
$zorkBrowser = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($zorkBrowser) {
    Start-Process -FilePath $zorkBrowser -ArgumentList @("--app=$zorkUrl", '--window-size=1600,1000') -WindowStyle Normal
} else { Start-Process $zorkUrl }
