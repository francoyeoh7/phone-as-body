param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [string]$Culture = "zh-CN"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Speech

$recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new(
  [System.Globalization.CultureInfo]::GetCultureInfo($Culture)
)
try {
  $recognizer.LoadGrammar([System.Speech.Recognition.DictationGrammar]::new())
  $recognizer.SetInputToWaveFile((Resolve-Path -LiteralPath $InputPath))
  $result = $recognizer.Recognize()
  if ($null -eq $result) {
    @{ text = ""; confidence = 0 } | ConvertTo-Json -Compress
  } else {
    @{ text = $result.Text; confidence = [double]$result.Confidence } | ConvertTo-Json -Compress
  }
} finally {
  $recognizer.Dispose()
}
