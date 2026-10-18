param([ValidateSet('start','stop','status')][string]$Action='start')
$ErrorActionPreference='Stop'
$ProjectRoot=Split-Path $PSScriptRoot -Parent
$EmulatorRoot=$env:COCO_EMULATOR_HOME
if(-not $EmulatorRoot){$EmulatorRoot=Join-Path (Split-Path $ProjectRoot -Parent) 'android-emulator'}
$Console=Join-Path $EmulatorRoot 'ldconsole.exe'
if (-not (Test-Path -LiteralPath $Console)) { throw 'Emulator console not found. Set COCO_EMULATOR_HOME to its installation directory.' }
switch($Action){
 'start' { & $Console launch --index 0 }
 'stop' {
  $TokenPath=Join-Path $ProjectRoot 'data\console-token'
  if(Test-Path -LiteralPath $TokenPath){
   $Headers=@{Authorization='Bearer '+(Get-Content -LiteralPath $TokenPath -Raw).Trim()}
   try{Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/tasks/stop' -Method Post -Headers $Headers -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null}catch{Write-Output 'Companion service unavailable; closing emulator only.'}
  }
  & $Console quit --index 0
 }
 'status' { & $Console list2 }
}
