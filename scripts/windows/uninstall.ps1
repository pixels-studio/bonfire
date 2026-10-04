# Removes the copy of Bonfire that install.ps1 made. Your projects and conversations in
# %APPDATA%\Bonfire are left alone.
$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'Programs\Bonfire'
Get-Process Bonfire -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Bonfire.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Bonfire' -Recurse -Force -ErrorAction SilentlyContinue
# This script lives in the folder it removes, so the folder goes after it exits.
$cleanup = 'ping 127.0.0.1 -n 3 >nul & rmdir /s /q "' + $target + '"'
Start-Process cmd.exe -WindowStyle Hidden -ArgumentList @('/c', $cleanup)
Write-Host 'Bonfire was uninstalled.'
