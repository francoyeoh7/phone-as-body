$ErrorActionPreference = "Stop"
$outputRoot = Join-Path $PSScriptRoot "..\public\assets\npcs\voices"
New-Item -ItemType Directory -Force $outputRoot | Out-Null
function U([string]$hex) {
  $compact = $hex -replace "\s", ""
  $chars = for ($index = 0; $index -lt $compact.Length; $index += 4) { [char]([Convert]::ToInt32($compact.Substring($index, 4), 16)) }
  -join $chars
}
$clips = @{
  "mara-notice" = U "6211 542c 89c1 4e86 3002 4f60 662f 5728 53eb 6211 5417 ff1f"
  "mara-clarify" = U "4f60 627e 6211 ff0c662f 60f3 95ee 4f4f 5e97 7684 4e8b ff0c8fd8 662f 6751 91cc 7684 4e8b ff1f"
  "mara-dismiss" = U "597d ff0c6709 9700 8981 518d 53eb 6211 3002"
  "mara-conversation" = U "4f4f 5e97 548c 6751 91cc 7684 4f20 95fb 6211 5927 591a 77e5 9053 3002 4f60 60f3 4ece 54ea 4ef6 4e8b 95ee 8d77 ff1f"
  "bram-notice" = U "542c 5230 4e86 3002 8bf4 5427 3001 4ec0 4e48 4e8b ff1f"
  "bram-clarify" = U "8981 4fee 4e1c 897f ff0c8fd8 662f 95ee 75d5 8ff9 ff1f"
  "bram-dismiss" = U "884c ff0c6211 63a5 7740 5e72 6d3b 3002"
  "bram-conversation" = U "91d1 5c5e 4e0d 4f1a 6492 8c0f 3002 628a 75d5 8ff9 8bf4 6e05 695a 3002"
  "elowen-notice" = U "6211 5728 3002 4f60 54ea 91cc 4e0d 8212 670d ff1f"
  "elowen-clarify" = U "8349 836f ff0c4f24 52bf ff0c8fd8 662f 6797 5b50 91cc 7684 8def ff1f"
  "elowen-dismiss" = U "660e 767d 3002 9700 8981 65f6 518d 6765 627e 6211 3002"
  "elowen-conversation" = U "628a 75c7 72b6 6216 690d 7269 8bf4 6e05 695a ff0c6211 4e0d 4f1a 731c 6d4b 3002"
}
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice("Microsoft Huihui Desktop")
$synth.Rate = -1
foreach ($entry in $clips.GetEnumerator()) {
  $path = Join-Path $outputRoot "$($entry.Key).wav"
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($entry.Value)
}
$synth.Dispose()
Write-Output "Generated $($clips.Count) NPC voice clips in $outputRoot"
