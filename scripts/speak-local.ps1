param([Parameter(Mandatory=$true)][string]$TextPath,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $chinese = $speaker.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
  if ($chinese) { $speaker.SelectVoice($chinese.VoiceInfo.Name) }
  $speaker.SetOutputToWaveFile($OutputPath)
  $speaker.Speak([System.IO.File]::ReadAllText($TextPath,[System.Text.Encoding]::UTF8))
} finally { $speaker.Dispose() }
