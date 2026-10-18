$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot '.runtime'
$NodeVersion = 'v24.22.0'
$ArchiveName = "node-$NodeVersion-win-x64.zip"
$ExpectedHash = 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$NodePath = Join-Path $RuntimeDir "node-$NodeVersion-win-x64/node.exe"
if (Test-Path -LiteralPath $NodePath) { & $NodePath --version; exit 0 }
$ArchivePath = Join-Path $RuntimeDir $ArchiveName
if (-not (Test-Path -LiteralPath $ArchivePath)) {
  & curl.exe --fail --location --max-time 180 "https://nodejs.org/dist/$NodeVersion/$ArchiveName" -o $ArchivePath
  if ($LASTEXITCODE -ne 0) { throw 'Official Node.js download failed.' }
}
if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLower() -ne $ExpectedHash) { throw 'Node.js checksum mismatch.' }
Expand-Archive -LiteralPath $ArchivePath -DestinationPath $RuntimeDir -Force
& $NodePath --version
