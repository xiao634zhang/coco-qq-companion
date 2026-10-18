$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$env:PIP_CACHE_DIR = Join-Path $projectRoot '.runtime\cache\pip'
$env:TEMP = Join-Path $projectRoot '.runtime\tmp'
$env:TMP = $env:TEMP
$env:HF_HOME = Join-Path $projectRoot '.runtime\huggingface'
New-Item -ItemType Directory -Force -Path $env:PIP_CACHE_DIR,$env:TEMP,$env:HF_HOME | Out-Null
$mediaPython = Join-Path $projectRoot '.runtime\media-python\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $mediaPython)) { & python -m venv (Join-Path $projectRoot '.runtime\media-python'); if ($LASTEXITCODE -ne 0) { throw 'Python venv failed' } }
& $mediaPython -m pip install 'faster-whisper==1.2.1' 'av==16.1.0' 'edge-tts==7.2.7' 'imageio-ffmpeg==0.6.0' 'kokoro-onnx==0.6.1' 'misaki[zh]==0.9.4' 'soundfile==0.13.1'
if ($LASTEXITCODE -ne 0) { throw 'Media package installation failed' }
& $mediaPython -m pip freeze | Set-Content -LiteralPath (Join-Path $projectRoot 'docs\media-versions.txt') -Encoding utf8
$ffmpegResult = & $mediaPython (Join-Path $PSScriptRoot 'media-worker.py') ffmpeg
$ffmpegResult | Set-Content -LiteralPath (Join-Path $projectRoot 'data\media-env.json') -Encoding utf8
