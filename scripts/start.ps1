param([switch]$Background)
. (Join-Path $PSScriptRoot 'paths.ps1')
& (Join-Path $PSScriptRoot 'start-snowluma.ps1')
$DataFolder = Join-Path $ProjectRoot 'data'
New-Item -ItemType Directory -Force -Path $DataFolder | Out-Null
$ConfigFile = Join-Path $ProjectRoot 'config.json'
$ListenPort = 3210
if (Test-Path -LiteralPath $ConfigFile) { $ListenPort = (Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json).port }
$AlreadyRunning = $false
try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/health" -TimeoutSec 2; $AlreadyRunning = $Health.service -eq 'qq-companion' } catch { }
if (-not $AlreadyRunning) {
  # Codex CLI does not inherit Windows Internet Settings automatically. Keep
  # this proxy scoped to the launched service, without changing system settings.
  if (-not $env:HTTPS_PROXY -and -not $env:ALL_PROXY) {
    $ProxySettings = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if ($ProxySettings.ProxyEnable -eq 1 -and $ProxySettings.ProxyServer) {
      $ProxyAddress = [string]$ProxySettings.ProxyServer
      if ($ProxyAddress.Contains('=')) {
        $ProxyEntries = @{}
        foreach ($Part in $ProxyAddress.Split(';')) {
          $Pair = $Part.Split('=',2)
          if ($Pair.Length -eq 2) { $ProxyEntries[$Pair[0]] = $Pair[1] }
        }
        $ProxyAddress = $ProxyEntries['https']
        if (-not $ProxyAddress) { $ProxyAddress = $ProxyEntries['http'] }
      }
      if ($ProxyAddress) {
        if ($ProxyAddress -notmatch '^\w+://') { $ProxyAddress = 'http://' + $ProxyAddress }
        $env:HTTPS_PROXY = $ProxyAddress
        $env:HTTP_PROXY = $ProxyAddress
      }
    }
  }
  $env:NO_PROXY = (@($env:NO_PROXY,'localhost','127.0.0.1','::1') | Where-Object { $_ }) -join ','
  Start-Process -FilePath $ProjectNode -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + (Join-Path $ProjectRoot 'src/server.ts') + '"')) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $DataFolder 'server.stdout.log') -RedirectStandardError (Join-Path $DataFolder 'server.stderr.log') | Out-Null
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    Start-Sleep -Milliseconds 500
    try { $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/health" -TimeoutSec 1; if ($Health.service -eq 'qq-companion') { $Ready = $true; break } } catch { }
  }
  if (-not $Ready) { throw 'Service failed to start. Check data/server.stderr.log.' }
}
if (-not $Background) { & (Join-Path $PSScriptRoot 'open-console.ps1') }
