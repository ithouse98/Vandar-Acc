param(
  [string]$Repo,
  [string]$Version,
  [ValidateSet('private','public')][string]$Visibility = 'private',
  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
  if (-not $BuildOnly) {
    if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repo must be OWNER/REPO.' }
    if ($Version -notmatch '^v\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$') { throw 'Version must look like v1.0.0.' }
    Get-Command gh -ErrorAction Stop | Out-Null
    & gh auth status
    if ($LASTEXITCODE -ne 0) { throw 'Sign in with gh auth login first.' }
    $dirty = & git status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and review local changes before publishing.' }
    $tracked = & git ls-files
    if ($tracked | Where-Object { $_ -match '(^|/)(data|dist|private-backup)/|(^|/)\.env$|\.sqlite|\.key$' }) { throw 'Private data appears in tracked files; remove it before publishing.' }
  }

  $lines = & node scripts/build-portable.mjs --release
  if ($LASTEXITCODE -ne 0) { throw 'Portable build failed.' }
  $zipLine = $lines | Where-Object { $_ -like 'ZIP: *' } | Select-Object -Last 1
  if (-not $zipLine) { throw 'Build did not report a ZIP path.' }
  $zip = $zipLine.Substring(5)
  $folder = $zip.Substring(0, $zip.Length - 4)
  if (-not (Test-Path -LiteralPath $zip)) { throw 'Release ZIP is missing.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $entries = $archive.Entries.FullName | ForEach-Object { $_ -replace '\\', '/' }
    if ($entries | Where-Object { $_ -match '/data/.+' -and $_ -notmatch '/data/$' }) { throw 'Release ZIP contains private data.' }
    foreach ($item in @('Vandar.exe','VandarService.exe','Install-Service.ps1','Uninstall-Service.ps1','recover-admin.js','NODE-LICENSE.txt','server.js')) {
      if (-not ($entries | Where-Object { $_ -like "*/$item" })) { throw "Release ZIP is missing $item." }
    }
  } finally { $archive.Dispose() }
  & node scripts/check-portable.mjs $folder --release
  if ($LASTEXITCODE -ne 0) { throw 'Release package check failed.' }
  if ($BuildOnly) { Write-Host "Clean release package: $zip"; return }

  $asset = Join-Path (Join-Path $root 'dist') "Vandar-Portable-$Version-win-x64.zip"
  if (Test-Path -LiteralPath $asset) { throw "Release asset already exists: $asset" }
  Move-Item -LiteralPath $zip -Destination $asset
  $remote = & git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    & gh repo view $Repo --json name --jq .name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & git remote add origin "https://github.com/$Repo.git"
    } else {
      & gh repo create $Repo "--$Visibility" --source=. --remote=origin
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure the GitHub repository.' }
  } elseif ($remote -notin @("https://github.com/$Repo.git", "https://github.com/$Repo", "git@github.com:$Repo.git", "git@github.com:$Repo")) {
    throw "origin points to a different repository: $remote"
  }
  & git push --set-upstream origin HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Git push failed; no release was created.' }
  $revision = (& git rev-parse HEAD).Trim()
  & gh release create $Version $asset --repo $Repo --target $revision --title "Vandar $Version" --notes-file (Join-Path $root 'docs\release-notes.md')
  if ($LASTEXITCODE -ne 0) { throw 'Release creation or upload failed; inspect GitHub before retrying.' }
  Write-Host "Published: https://github.com/$Repo/releases/tag/$Version"
} finally { Pop-Location }
