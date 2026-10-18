param([switch]$Background)
. (Join-Path $PSScriptRoot 'paths.ps1')
$DataFolder = Join-Path $ProjectRoot 'data'
New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
$ConfigFile = Join-Path $ProjectRoot 'config.json'
$ListenPort = 3210
if (Test-Path -LiteralPath $ConfigFile) { $ListenPort = (Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json).port }
$AlreadyRunning = $false
try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/health" -TimeoutSec 2; $AlreadyRunning = $Health.service -eq 'qq-companion' } catch { }
if (-not $AlreadyRunning) {
  Start-Process -FilePath $ProjectNode -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + (Join-Path $ProjectRoot 'src/server.ts') + '"')) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataFolder 'server.stdout.log') -RedirectStandardError (Join-Path $DataFolder 'server.stderr.log') | Out-Null
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    Start-Sleep -Milliseconds 500
    try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/health" -TimeoutSec 1; if ($Health.service -eq 'qq-companion') { $Ready = $true; break } } catch { }
  }
  if (-not $Ready) { throw 'Service failed to start. Check data/server.stderr.log.' }
}
if (-not $Background) { & (Join-Path $PSScriptRoot 'open-console.ps1') }
