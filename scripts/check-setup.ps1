param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $Path).Path)
$company = [Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path -LiteralPath $Path).Path).CompanyName
if ($company -ne 'Behrouz Kazemi - IPS-Co') { throw 'Setup publisher metadata is missing.' }
$names = $assembly.GetManifestResourceNames()
if ('Vandar.Payload' -notin $names -or 'Vandar.Brand' -notin $names) { throw 'Setup is missing embedded resources.' }
$stream = $assembly.GetManifestResourceStream('Vandar.Payload')
$archive = New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Read)
try {
  $entries = @($archive.Entries.FullName | ForEach-Object { $_ -replace '\\', '/' })
  if ($entries | Where-Object { $_ -match '/data/.+' -and $_ -notmatch '/data/$' }) { throw 'Setup contains private data.' }
  foreach ($item in @('Vandar.exe','VandarService.exe','VandarWindow.exe','Vandar.ico','server.js','vandar-icon.svg','Install-Service.ps1')) {
    if (-not ($entries | Where-Object { $_ -like "*/$item" })) { throw "Setup is missing $item." }
  }
  if ($entries.Count -lt 100) { throw 'Setup payload is unexpectedly small.' }
} finally {
  $archive.Dispose()
  $stream.Dispose()
}
Write-Host 'Setup payload checks passed'
