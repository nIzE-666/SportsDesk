# Prepare a complete release directory before replacing any published local files.
function Publish-ReleaseArtifacts {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$Setup,
    [Parameter(Mandatory)][string]$Portable,
    [Parameter(Mandatory)][scriptblock]$Verify,
    [string]$DownloadUrl = '',
    [string]$Notes = ''
  )
  $ErrorActionPreference = 'Stop'
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
  $releaseRoot = (Get-Item -LiteralPath $Root).FullName.TrimEnd([IO.Path]::DirectorySeparatorChar)
  $releases = Join-Path $releaseRoot 'releases'
  $id = [guid]::NewGuid().ToString('N')
  $staging = Join-Path $releaseRoot ".release-stage-$id"
  $previous = Join-Path $releaseRoot ".release-previous-$id"
  # Every directory moved or recursively removed must be a direct child of Root.
  $assertPath = {
    param([string]$Path)
    $absolute = [IO.Path]::GetFullPath($Path)
    if (-not [IO.Path]::GetDirectoryName($absolute).Equals($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Release path is outside the workspace: $absolute"
    }
    if ((Test-Path -LiteralPath $absolute) -and
        ((Get-Item -LiteralPath $absolute -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Release directory must not be a link: $absolute"
    }
  }
  & $assertPath $releases
  & $assertPath $staging
  & $assertPath $previous
  $published = $false
  $savedPrevious = $false
  try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    if (Test-Path -LiteralPath $releases) {
      Get-ChildItem -LiteralPath $releases -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $staging -Recurse -Force
      }
    }
    $setupName = "SportsDesk_${Version}_x64-setup.exe"
    $signaturePath = "$Setup.sig"
    foreach ($file in @($Setup, $Portable, $signaturePath)) {
      if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Artifact missing: $file" }
    }
    $signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
    if (-not $signature) { throw 'Updater signature is empty' }
    Copy-Item -LiteralPath $Setup -Destination (Join-Path $staging $setupName) -Force
    Copy-Item -LiteralPath $signaturePath -Destination (Join-Path $staging "$setupName.sig") -Force
    Copy-Item -LiteralPath $Portable -Destination (Join-Path $staging "SportsDesk_${Version}_portable.exe") -Force
    Get-ChildItem -LiteralPath $staging -Filter '*.exe' | Sort-Object Name | ForEach-Object {
      "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
    } | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding utf8

    $utf8 = [Text.UTF8Encoding]::new($false)
    $info = [ordered]@{ version=$Version; notes=$Notes; pub_date=(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); installer=$setupName; signature=$signature; publicationConfigured=[bool]$DownloadUrl }
    [IO.File]::WriteAllText((Join-Path $staging "release-$Version.json"), ($info | ConvertTo-Json -Depth 5), $utf8)
    $manifestPath = Join-Path $staging "latest-$Version.json"
    if ($DownloadUrl) {
      $manifest = [ordered]@{ version=$Version; notes=$Notes; pub_date=$info.pub_date; platforms=[ordered]@{ 'windows-x86_64'=[ordered]@{ signature=$signature; url=$DownloadUrl } } }
      [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8)
    } elseif (Test-Path -LiteralPath $manifestPath) {
      # A rebuild without a publication address must not retain an old signature.
      Remove-Item -LiteralPath $manifestPath -Force
    }
    & $Verify $staging

    & $assertPath $releases
    & $assertPath $previous
    if (Test-Path -LiteralPath $releases) {
      Rename-Item -LiteralPath $releases -NewName (Split-Path -Leaf $previous)
      $savedPrevious = $true
    }
    try {
      & $assertPath $staging
      Rename-Item -LiteralPath $staging -NewName 'releases'
    } catch {
      $publishError = $_
      if ($savedPrevious) {
        try {
          & $assertPath $previous
          Rename-Item -LiteralPath $previous -NewName 'releases'
        } catch {
          throw "Release replacement failed and the previous release could not be restored. Recover it from '$previous'. Publish error: $publishError. Restore error: $_"
        }
      }
      throw $publishError
    }
    $published = $true
  } finally {
    # Cleanup cannot turn a successful publication into a failed source rollback.
    $cleanupPaths = @($staging)
    if ($published -and $savedPrevious) { $cleanupPaths += $previous }
    foreach ($cleanupPath in $cleanupPaths) {
      try {
        & $assertPath $cleanupPath
        if (Test-Path -LiteralPath $cleanupPath) { Remove-Item -LiteralPath $cleanupPath -Recurse -Force }
      } catch { Write-Warning "Release temporary directory retained at '$cleanupPath': $_" }
    }
  }
}
