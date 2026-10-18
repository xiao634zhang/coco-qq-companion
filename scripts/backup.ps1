. (Join-Path $PSScriptRoot 'paths.ps1')
$ListenPort = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).port
$ConsoleToken = (Get-Content -LiteralPath (Join-Path $ProjectRoot 'data/console-token') -Raw).Trim()
Invoke-RestMethod -Uri "http://127.0.0.1:$ListenPort/api/backup" -Method Post -Headers @{Authorization="Bearer $ConsoleToken"} -ContentType 'application/json' -Body '{}' | Format-List
