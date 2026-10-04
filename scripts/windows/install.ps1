# Installs Bonfire for the current user: copies it to %LOCALAPPDATA%\Programs\Bonfire, adds a Start menu
# shortcut, and lists it under Settings > Apps > Installed apps. Run it through "Install Bonfire.cmd".
$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $env:LOCALAPPDATA 'Programs\Bonfire'
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Bonfire.lnk'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bonfire'

if (-not (Test-Path (Join-Path $source 'Bonfire.exe'))) {
  throw 'Bonfire.exe is not next to this script. Unzip the whole folder first.'
}

# A running copy keeps its files locked.
Get-Process Bonfire -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $source '*') $target -Recurse -Force

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $target 'Bonfire.exe'
$link.WorkingDirectory = $target
$link.Description = 'Bonfire'
$link.Save()

$version = (Get-Content (Join-Path $target 'resources\app\package.json') -Raw | ConvertFrom-Json).version
New-Item -Path $key -Force | Out-Null
$entries = @{
  DisplayName     = 'Bonfire'
  DisplayVersion  = $version
  Publisher       = 'Bonfire'
  InstallLocation = $target
  DisplayIcon     = Join-Path $target 'Bonfire.exe'
  UninstallString = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $target 'uninstall.ps1') + '"'
}
foreach ($name in $entries.Keys) { Set-ItemProperty -Path $key -Name $name -Value $entries[$name] }
Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord

Write-Host "Installed Bonfire to $target"
Write-Host 'Find it in the Start menu, or under Settings > Apps > Installed apps.'
