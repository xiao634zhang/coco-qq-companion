param([ValidateSet('xhs','zhihu')][string]$Platform)
$ErrorActionPreference='Stop'
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
$env:NO_COLOR='1'
$ProjectRoot=Split-Path $PSScriptRoot -Parent
$LocalPaths=Join-Path $ProjectRoot 'data/local-paths.json'
$Python=$env:COCO_SOCIAL_PYTHON
if(-not $Python -and (Test-Path -LiteralPath $LocalPaths)){$Python=(Get-Content -LiteralPath $LocalPaths -Raw -Encoding UTF8 | ConvertFrom-Json).socialPython}
if(-not $Python){$Python=(Get-Command python.exe -ErrorAction Stop).Source}
if(-not(Test-Path -LiteralPath $Python)){throw 'Platform Python runtime not found'}
& $Python -u (Join-Path $PSScriptRoot 'social-browser-login.py') $Platform
Write-Host 'Login command finished. You can close this window.'
