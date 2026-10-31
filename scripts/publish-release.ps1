param(
  [string]$Repo = 'ithouse98/Vandar-Acc',
  [string]$Version,
  [ValidateSet('private','public')][string]$Visibility = 'private',
  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$previousGhToken = $env:GH_TOKEN
Push-Location $root
try {
  $packageVersion = 'v' + ((Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version)
  if (-not $Version) { $Version = $packageVersion }
  if ($Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repo must be OWNER/REPO.' }
  if ($Version -ne $packageVersion) { throw "Version must match package.json: $packageVersion" }
  foreach ($command in @('git','node','gh')) { Get-Command $command -ErrorAction Stop | Out-Null }

  $zip = Join-Path $root "dist\Vandar-Portable-$Version-win-x64.zip"
  $setup = Join-Path $root "dist\Vandar-Setup-$Version-win-x64.exe"
  $zipExists = Test-Path -LiteralPath $zip
  $setupExists = Test-Path -LiteralPath $setup
  if ($zipExists -ne $setupExists) { throw 'Only one release package exists. Inspect dist before continuing.' }
  if (-not $zipExists) {
    & node scripts/build-setup.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Setup build failed.' }
  }
  if (-not (Test-Path -LiteralPath $zip) -or -not (Test-Path -LiteralPath $setup)) { throw 'Release files are missing.' }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $entries = @($archive.Entries.FullName | ForEach-Object { $_ -replace '\\', '/' })
    if ($entries | Where-Object { $_ -match '/data/.+' -and $_ -notmatch '/data/$' }) { throw 'Release ZIP contains private data.' }
    foreach ($item in @('Vandar.exe','VandarService.exe','VandarWindow.exe','Vandar.ico','Install-Service.ps1','Uninstall-Service.ps1','recover-admin.js','NODE-LICENSE.txt','server.js','vandar-icon.svg')) {
      if (-not ($entries | Where-Object { $_ -like "*/$item" })) { throw "Release ZIP is missing $item." }
    }
  } finally { $archive.Dispose() }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\check-setup.ps1') $setup
  if ($LASTEXITCODE -ne 0) { throw 'Setup payload check failed.' }
  if ($BuildOnly) { Write-Host "Packages are ready: $setup and $zip"; return }

  $dirty = & git status --porcelain --untracked-files=normal
  if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit and review local changes before publishing.' }
  $tracked = & git ls-files
  if ($tracked | Where-Object { $_ -match '(^|/)(data|dist|private-backup)/|(^|/)\.env$|\.sqlite|\.key$' }) { throw 'Private data appears in tracked files; remove it before publishing.' }

  & gh api user --jq .login 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $credentialLines = (@('protocol=https','host=github.com','') -join [Environment]::NewLine) | git credential fill 2>$null
    $passwordLine = $credentialLines | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
    if (-not $passwordLine) { throw 'GitHub login is missing. Run gh auth login, then retry.' }
    $env:GH_TOKEN = $passwordLine.Substring(9)
    $credentialLines = $null
    $passwordLine = $null
    & gh api user --jq .login | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'GitHub credential cannot access the API. Run gh auth login.' }
  }

  $remote = & git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    & gh repo view $Repo --json name --jq .name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & git remote add origin "https://github.com/$Repo.git"
    } else {
      & gh repo create $Repo "--$Visibility" --source=. --remote=origin
      if ($LASTEXITCODE -ne 0) { throw 'Could not create the GitHub repository.' }
    }
  } elseif ($remote -notin @("https://github.com/$Repo.git", "https://github.com/$Repo", "git@github.com:$Repo.git", "git@github.com:$Repo")) {
    throw "origin points to a different repository: $remote"
  }
  Write-Host "Pushing source to $Repo/main..."
  & git push origin 'HEAD:refs/heads/main'
  if ($LASTEXITCODE -ne 0) { throw 'Git push failed. The release was not changed.' }

  $releaseJson = & gh release view $Version --repo $Repo --json isDraft,assets,tagName 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating draft release $Version..."
    & gh release create $Version --repo $Repo --target main --title "Vandar $Version" --notes-file (Join-Path $root 'docs\release-notes.md') --draft
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the draft release.' }
    $releaseJson = & gh release view $Version --repo $Repo --json isDraft,assets,tagName
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the new release.' }
  }
  $release = $releaseJson | ConvertFrom-Json
  foreach ($file in @($setup,$zip)) {
    $name = [IO.Path]::GetFileName($file)
    $size = (Get-Item -LiteralPath $file).Length
    $existing = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing) {
      if ($existing.size -ne $size) { throw "Release asset has an unexpected size: $name" }
      Write-Host "Already uploaded: $name"
      continue
    }
    Write-Host "Uploading $name ($([Math]::Round($size / 1MB, 1)) MB)..."
    & gh release upload $Version $file --repo $Repo
    if ($LASTEXITCODE -ne 0) { throw "Upload failed: $name. The draft release can be resumed by running this script again." }
    $releaseJson = & gh release view $Version --repo $Repo --json isDraft,assets,tagName
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify uploaded asset.' }
    $release = $releaseJson | ConvertFrom-Json
    $uploaded = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $uploaded -or $uploaded.size -ne $size) { throw "Uploaded asset could not be verified: $name" }
  }
  if ($release.isDraft) {
    & gh release edit $Version --repo $Repo --draft=false
    if ($LASTEXITCODE -ne 0) { throw 'Assets uploaded, but the release is still a draft.' }
  }
  Write-Host "Published: https://github.com/$Repo/releases/tag/$Version"
} finally {
  if ($null -eq $previousGhToken) { Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue }
  else { $env:GH_TOKEN = $previousGhToken }
  Pop-Location
}
