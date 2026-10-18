$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$NodeFolder = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot '.runtime') -Directory -Filter 'node-v24*-win-x64' | Sort-Object Name -Descending | Select-Object -First 1
if (-not $NodeFolder) { throw 'Node.js 24 runtime missing. Run setup-runtime.ps1 first.' }
$ProjectNode = Join-Path $NodeFolder.FullName 'node.exe'
