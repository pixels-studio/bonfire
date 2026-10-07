# Dictation for the composer on Windows, on the system's own speech recognizer (System.Speech,
# part of Windows PowerShell 5.1). Runs offline and needs no extra install beyond a speech
# language, which Windows ships with. macOS uses main.swift instead; both speak the same protocol.
#
# Writes one JSON object per line to stdout:
#   {"type":"ready"}                  listening
#   {"type":"result","text":"..."}    everything heard so far, revised as recognition firms up
#   {"type":"level","level":0.4}      microphone loudness, 0 to 1
#   {"type":"error","error":"..."}    not-allowed, audio-capture, unavailable
#   {"type":"end"}                    done; the process exits right after
# Stops on a "stop" line or when stdin closes. Usage: windows.ps1 [language, e.g. en-US]
param([string]$Language = '')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Emit([hashtable]$Message) {
  [Console]::Out.WriteLine(($Message | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Finish([string]$Reason = '') {
  if ($Reason) { Emit @{ type = 'error'; error = $Reason } }
  Emit @{ type = 'end' }
  exit $(if ($Reason) { 1 } else { 0 })
}

# Windows' "Let desktop apps access your microphone" switch, which has no per-app prompt for
# desktop apps like this one. When it is off, the microphone yields silence rather than an error.
function MicrophoneDenied {
  $store = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
  foreach ($path in @($store, "$store\NonPackaged")) {
    $value = (Get-ItemProperty -Path $path -Name Value -ErrorAction SilentlyContinue).Value
    if ($value -eq 'Deny') { return $true }
  }
  return $false
}

try { Add-Type -AssemblyName System.Speech } catch { Finish 'unavailable' }
if (MicrophoneDenied) { Finish 'not-allowed' }

$installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
if (-not $installed -or $installed.Count -eq 0) { Finish 'unavailable' }
# The requested language, else its base language (en for en-GB), else the system's default.
$culture = $null
if ($Language) {
  try { $culture = [Globalization.CultureInfo]::GetCultureInfo($Language) } catch {}
}
$info = $null
if ($culture) {
  $info = $installed | Where-Object { $_.Culture.Name -eq $culture.Name } | Select-Object -First 1
  if (-not $info) {
    $info = $installed |
      Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $culture.TwoLetterISOLanguageName } |
      Select-Object -First 1
  }
}
if (-not $info) {
  $info = $installed | Where-Object { $_.Culture.Name -eq [Globalization.CultureInfo]::CurrentUICulture.Name } | Select-Object -First 1
}
if (-not $info) { $info = $installed | Select-Object -First 1 }

try {
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $info
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
} catch {
  [Console]::Error.WriteLine("Dictation setup failed: $($_.Exception.Message)")
  Finish 'audio-capture'
}

# Events queue up and are handled in the loop below, since this script has one thread.
foreach ($name in 'SpeechHypothesized', 'SpeechRecognized', 'AudioLevelUpdated', 'RecognizeCompleted') {
  Register-ObjectEvent -InputObject $engine -EventName $name -SourceIdentifier $name | Out-Null
}

try {
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
} catch {
  [Console]::Error.WriteLine("Dictation could not listen: $($_.Exception.Message)")
  Finish 'audio-capture'
}
Emit @{ type = 'ready' }

$committed = ''
$current = ''
$stopRequested = $false
$stopDeadline = $null
$stdin = [Console]::In.ReadLineAsync()

function Text { (@($committed, $current) | Where-Object { $_ }) -join ' ' }

while ($true) {
  $level = $null
  $changed = $false
  $done = $false
  foreach ($event in @(Get-Event -ErrorAction SilentlyContinue)) {
    switch ($event.SourceIdentifier) {
      'AudioLevelUpdated' { $level = [Math]::Min(1.0, $event.SourceEventArgs.AudioLevel / 60.0) }
      'SpeechHypothesized' { $current = $event.SourceEventArgs.Result.Text; $changed = $true }
      'SpeechRecognized' {
        # A phrase is settled; what comes next is added after it.
        $text = $event.SourceEventArgs.Result.Text
        if ($text) { $committed = (@($committed, $text) | Where-Object { $_ }) -join ' ' }
        $current = ''
        $changed = $true
      }
      'RecognizeCompleted' { $done = $true }
    }
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
  if ($changed) { Emit @{ type = 'result'; text = (Text) } }
  if ($null -ne $level -and -not $stopRequested) { Emit @{ type = 'level'; level = $level } }

  # "stop", or stdin closing because the app went away, ends the session.
  if (-not $stopRequested -and $stdin.IsCompleted) {
    $line = $stdin.Result
    if ($null -eq $line -or $line.Trim() -eq 'stop') {
      $stopRequested = $true
      Emit @{ type = 'level'; level = 0 }
      try { $engine.RecognizeAsyncStop() } catch {}
      # The last words usually firm up quickly; don't wait on them forever.
      $stopDeadline = [DateTime]::UtcNow.AddMilliseconds(1500)
    } else {
      $stdin = [Console]::In.ReadLineAsync()
    }
  }
  if ($done -or ($stopDeadline -and [DateTime]::UtcNow -gt $stopDeadline)) { break }
  Start-Sleep -Milliseconds 40
}

try { $engine.Dispose() } catch {}
Finish
