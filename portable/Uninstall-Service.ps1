$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator.' }
$service = Get-Service -Name 'Vandar' -ErrorAction SilentlyContinue
if ($service) {
  if ($service.Status -ne 'Stopped') { Stop-Service -Name 'Vandar' }
  & sc.exe delete Vandar | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Windows could not remove the service.' }
}
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Vandar.lnk'
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
Write-Host 'Service removed. Data remains in ProgramData\Vandar\data; back it up before deleting that folder.'
