param(
  [switch]$Fresh,
  [switch]$Upgrade
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$target = Join-Path $env:ProgramData 'Vandar'
$serviceName = 'Vandar'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' }
if ($Fresh -and $Upgrade) { throw 'Choose Fresh or Upgrade.' }
if ($Fresh) {
  if ((Get-ChildItem -LiteralPath (Join-Path $source 'data') -Force | Measure-Object).Count) { throw 'Fresh installer payload contains private data.' }
} elseif (-not $Upgrade) {
  if (-not (Test-Path -LiteralPath (Join-Path $source 'data\accounting.sqlite'))) { throw 'First run Vandar.exe and create the administrator account, then close it and install the service.' }
  if (-not (Test-Path -LiteralPath (Join-Path $source 'data\encryption.key'))) { throw 'The database encryption key is missing.' }
}
if (Get-Process -Name 'Vandar' -ErrorAction SilentlyContinue) { throw 'Close Vandar from the tray before installing the service.' }
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($Upgrade) {
  if (-not $existing -or -not (Test-Path -LiteralPath $target)) { throw 'No complete Vandar service installation was found.' }
} elseif ($existing -or (Test-Path -LiteralPath $target)) {
  throw "Vandar is already installed or its data folder exists: $target"
}
$browsers = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
)
$browser = $browsers | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $browser) { throw 'Microsoft Edge or Google Chrome is required for the fullscreen shortcut.' }

if ($Upgrade) {
  if ($existing.Status -ne 'Stopped') { Stop-Service -Name $serviceName; (Get-Service -Name $serviceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20)) }
  Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -ne 'data' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force }
} else {
  New-Item -ItemType Directory -Path $target | Out-Null
  & icacls.exe $target /inheritance:r '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' "*$($identity.User.Value):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not secure the installation folder.' }
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force }
}
& icacls.exe $target '/grant:r' '*S-1-5-19:(OI)(CI)M' "*$($identity.User.Value):(OI)(CI)F" /T | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not give the service access to the copied files.' }
if (-not $Upgrade) {
  $binary = Join-Path $target 'VandarService.exe'
  & sc.exe create $serviceName 'binPath=' "`"$binary`"" 'start=' 'auto' 'obj=' 'NT AUTHORITY\LocalService' 'DisplayName=' 'Vandar' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows could not register the service.' }
  & sc.exe description $serviceName 'Vandar local invoice backend' | Out-Null
}
Start-Service -Name $serviceName
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Vandar.lnk'))
$shortcut.TargetPath = Join-Path $target 'VandarWindow.exe'
$shortcut.Arguments = 'http://localhost:17432'
$shortcut.WorkingDirectory = $target
$shortcut.IconLocation = (Join-Path $target 'Vandar.ico')
$shortcut.Save()
Write-Host $(if ($Upgrade) { 'Vandar service updated; data preserved.' } else { 'Vandar service installed and started.' })
