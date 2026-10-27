#requires -Version 7.0
# Builds signed local artifacts. Does not publish or create a repository.
# Optional -Repo owner/name or -DownloadUrl generates a deployable latest.json.
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Repo = '',
  [string]$DownloadUrl = '',
  [string]$Notes = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must be semver, e.g. 1.0.1' }
if ($Repo -and $Repo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repo must be owner/name' }
if ($Repo -and $DownloadUrl) { throw 'Use either Repo or DownloadUrl' }
if ($DownloadUrl) {
  $uri = [uri]$DownloadUrl
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Fragment) { throw 'DownloadUrl must be HTTPS' }
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
foreach ($name in @('package.json','src-tauri/tauri.conf.json')) {
  $path = Join-Path $root $name
  $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  $value.version = $Version
  [IO.File]::WriteAllText($path,($value | ConvertTo-Json -Depth 30) + "`n",$utf8)
}
$lockPath = Join-Path $root 'package-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json -AsHashtable
$lock.version = $Version; $lock.packages[''].version = $Version
[IO.File]::WriteAllText($lockPath,($lock | ConvertTo-Json -Depth 100) + "`n",$utf8)
$cargo = Join-Path $root 'src-tauri/Cargo.toml'
$text = Get-Content -LiteralPath $cargo -Raw
$text = [regex]::new('(?m)^version = "\d+\.\d+\.\d+"').Replace($text,('version = "' + $Version + '"'),1)
[IO.File]::WriteAllText($cargo,$text,$utf8)

# Versions are changed here; validate the exact sources before loading the
# private signing key into the build process environment.
Push-Location $root
try {
  npx prettier --write package.json
  if ($LASTEXITCODE -ne 0) { throw 'Package formatting failed' }
  npm run format:check
  if ($LASTEXITCODE -ne 0) { throw 'Source formatting failed' }
  cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  if ($LASTEXITCODE -ne 0) { throw 'Rust formatting failed' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
  npm test
  if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed' }
  npm run typecheck:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Browser test types failed' }
  npm run test:visual
  if ($LASTEXITCODE -ne 0) { throw 'Visual regression tests failed' }
  cargo test --manifest-path src-tauri/Cargo.toml --lib
  if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
  cargo clippy --manifest-path src-tauri/Cargo.toml --lib --no-deps -- -D warnings
  if ($LASTEXITCODE -ne 0) { throw 'Rust lint failed' }
} finally { Pop-Location }

$oldKey = $env:TAURI_SIGNING_PRIVATE_KEY
$oldPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
try {
  $keyPath = Join-Path $root 'src-tauri/keys/sportsdesk-updater.key'
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
  if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Updater signing key is missing' }
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -LiteralPath $keyPath -Raw
  Push-Location $root
  try {
    npm run tauri -- build
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed' }
  } finally { Pop-Location }
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $oldKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $oldPassword
}

$setupName = "SportsDesk_${Version}_x64-setup.exe"
$setup = Join-Path $root "src-tauri/target/release/bundle/nsis/$setupName"
$portable = Join-Path $root 'src-tauri/target/release/sportsdesk.exe'
$signaturePath = "$setup.sig"
foreach ($file in @($setup,$portable,$signaturePath)) { if (-not (Test-Path -LiteralPath $file)) { throw "Artifact missing: $file" } }
$signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
if (-not $signature) { throw 'Updater signature is empty' }
$releases = Join-Path $root 'releases'
New-Item -ItemType Directory -Force -Path $releases | Out-Null
Copy-Item -LiteralPath $setup -Destination (Join-Path $releases $setupName) -Force
Copy-Item -LiteralPath $signaturePath -Destination (Join-Path $releases "$setupName.sig") -Force
Copy-Item -LiteralPath $portable -Destination (Join-Path $releases "SportsDesk_${Version}_portable.exe") -Force
Get-ChildItem -LiteralPath $releases -Filter '*.exe' | Sort-Object Name | ForEach-Object {
  "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
} | Set-Content -LiteralPath (Join-Path $releases 'SHA256SUMS.txt') -Encoding utf8

if ($Repo) { $DownloadUrl = "https://github.com/$Repo/releases/download/v$Version/$setupName" }
$info = [ordered]@{ version=$Version; notes=$Notes; pub_date=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); installer=$setupName; signature=$signature; publicationConfigured=[bool]$DownloadUrl }
[IO.File]::WriteAllText((Join-Path $releases "release-$Version.json"),($info | ConvertTo-Json -Depth 5),$utf8)
if ($DownloadUrl) {
  $manifest = [ordered]@{ version=$Version; notes=$Notes; pub_date=$info.pub_date; platforms=[ordered]@{ 'windows-x86_64'=[ordered]@{signature=$signature;url=$DownloadUrl} } }
  [IO.File]::WriteAllText((Join-Path $releases "latest-$Version.json"),($manifest | ConvertTo-Json -Depth 5),$utf8)
  Write-Host "Update manifest ready: releases/latest-$Version.json"
} else {
  Write-Host 'No publication address configured. Signed local artifacts are ready; no remote manifest generated.'
}
Write-Host "Ready: releases/$setupName and SportsDesk_${Version}_portable.exe"
