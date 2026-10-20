. (Join-Path $PSScriptRoot 'paths.ps1')
$SnowRoot = Join-Path $ProjectRoot 'vendor/SnowLuma'
$Entry = Join-Path $SnowRoot 'index.mjs'
if (-not (Test-Path -LiteralPath $Entry)) { return }
$SnowPort = 5099
$RuntimeFile = Join-Path $SnowRoot 'config/runtime.json'
if (Test-Path -LiteralPath $RuntimeFile) {
  $RuntimeSettings = Get-Content -LiteralPath $RuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($RuntimeSettings.webuiPort) { $SnowPort = [int]$RuntimeSettings.webuiPort }
}
function Test-SnowReady {
  try {
    $Page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$SnowPort/" -TimeoutSec 2
    return $Page.Content -match 'SnowLuma'
  } catch { return $false }
}
if (Test-SnowReady) { return }
$Existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Entry) }
if (-not $Existing) {
  $LogRoot = Join-Path $ProjectRoot 'data'
  New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  Start-Process -FilePath $ProjectNode -ArgumentList ('"' + $Entry + '"') -WorkingDirectory $SnowRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot 'snowluma.stdout.log') -RedirectStandardError (Join-Path $LogRoot 'snowluma.stderr.log') | Out-Null
}
for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
  if (Test-SnowReady) { return }
  Start-Sleep -Milliseconds 500
}
Write-Warning 'SnowLuma is not ready. Check data/snowluma.stderr.log and start-snowluma.cmd.'
