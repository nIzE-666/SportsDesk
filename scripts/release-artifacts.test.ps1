#requires -Version 7.0
param(
  [Parameter(Mandatory)]
  [ValidateSet('verification-failure', 'same-version', 'publish-failure', 'first-release', 'missing-artifact', 'restore-failure', 'destination-conflict', 'local-only')]
  [string]$Scenario
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-artifacts.ps1')
function Assert-ReleaseTest($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}
function Get-ReleaseSnapshot([string]$Path) {
  return (@(Get-ChildItem -LiteralPath $Path -Recurse -File -Force | Sort-Object FullName | ForEach-Object {
    [ordered]@{ name=[IO.Path]::GetRelativePath($Path, $_.FullName); hash=(Get-FileHash -LiteralPath $_.FullName).Hash }
  }) | ConvertTo-Json -Compress)
}
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$taskRoot = Join-Path $tempParent ('sportsdesk-release-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot | Out-Null
try {
  $build = Join-Path $taskRoot 'build'
  $releases = Join-Path $taskRoot 'releases'
  New-Item -ItemType Directory -Path $build | Out-Null
  New-Item -ItemType Directory -Path $releases | Out-Null
  $setupName = 'SportsDesk_1.6.0_x64-setup.exe'
  $portableName = 'SportsDesk_1.6.0_portable.exe'
  $setup = Join-Path $build $setupName
  $portable = Join-Path $build 'sportsdesk.exe'
  [IO.File]::WriteAllText($setup, 'new-installer')
  [IO.File]::WriteAllText("$setup.sig", 'new-signature')
  [IO.File]::WriteAllText($portable, 'new-portable')
  [IO.File]::WriteAllText((Join-Path $releases $setupName), 'old-installer')
  [IO.File]::WriteAllText((Join-Path $releases "$setupName.sig"), 'old-signature')
  [IO.File]::WriteAllText((Join-Path $releases $portableName), 'old-portable')
  [IO.File]::WriteAllText((Join-Path $releases 'SportsDesk_1.5.0_portable.exe'), 'older-version')
  [IO.File]::WriteAllText((Join-Path $releases 'latest-1.6.0.json'), 'old-manifest')
  [IO.File]::WriteAllText((Join-Path $releases 'release-1.6.0.json'), 'old-info')
  [IO.File]::WriteAllText((Join-Path $releases 'SHA256SUMS.txt'), 'old-sums')
  $before = Get-ReleaseSnapshot $releases
  $script:verified = $false
  $verify = {
    param($directory)
    Assert-ReleaseTest ($directory -ne $releases) 'Verifier must receive staging directory'
    Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $directory $setupName)) -eq 'new-installer') 'New installer is not staged'
    Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $directory "$setupName.sig")) -eq 'new-signature') 'New signature is not staged'
    $info = Get-Content -LiteralPath (Join-Path $directory 'release-1.6.0.json') -Raw | ConvertFrom-Json
    Assert-ReleaseTest ($info.signature -eq 'new-signature') 'Release info does not match staged signature'
    $sums = Get-Content -LiteralPath (Join-Path $directory 'SHA256SUMS.txt') -Raw
    foreach ($name in @($setupName, $portableName)) {
      $hash = (Get-FileHash -LiteralPath (Join-Path $directory $name) -Algorithm SHA256).Hash.ToLower()
      Assert-ReleaseTest ($sums.Contains("$hash  $name")) 'Staged checksums do not match'
    }
    if (Test-Path -LiteralPath $releases) {
      Assert-ReleaseTest ((Get-ReleaseSnapshot $releases) -eq $before) 'Old release changed before verification'
    }
    $script:verified = $true
  }
  $arguments = @{ Root=$taskRoot; Version='1.6.0'; Setup=$setup; Portable=$portable; Verify=$verify; DownloadUrl='https://example.com/setup.exe' }
  $testVerify = $verify
  switch ($Scenario) {
    'verification-failure' {
      $arguments.Verify = { param($directory); & $testVerify $directory; throw 'simulated signature failure' }
    }
    'missing-artifact' { Remove-Item -LiteralPath "$setup.sig" }
    'first-release' {
      # This fixture directory is an explicitly checked direct child of our temp root.
      Assert-ReleaseTest ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($releases)) -eq $taskRoot) 'Unsafe fixture path'
      Remove-Item -LiteralPath $releases -Recurse -Force
    }
    'local-only' { $arguments.DownloadUrl = '' }
  }
  if ($Scenario -in @('publish-failure', 'restore-failure', 'destination-conflict')) {
    function Rename-Item {
      param([string]$LiteralPath, [string]$NewName)
      if ((Split-Path -Leaf $LiteralPath) -like '.release-stage-*') {
        if ($Scenario -eq 'destination-conflict') {
          New-Item -ItemType Directory -Path (Join-Path $taskRoot 'releases') | Out-Null
          [IO.File]::WriteAllText((Join-Path $taskRoot 'releases/conflict.txt'), 'concurrent-file')
        } else { throw 'simulated replacement failure' }
      }
      if ($Scenario -eq 'restore-failure' -and (Split-Path -Leaf $LiteralPath) -like '.release-previous-*') { throw 'simulated restore failure' }
      Microsoft.PowerShell.Management\Rename-Item -LiteralPath $LiteralPath -NewName $NewName
    }
  }
  $failure = $null
  try { Publish-ReleaseArtifacts @arguments } catch { $failure = $_ }
  if ($Scenario -in @('verification-failure', 'missing-artifact', 'publish-failure')) {
    Assert-ReleaseTest ($null -ne $failure) 'Expected publication to fail'
    Assert-ReleaseTest ((Get-ReleaseSnapshot $releases) -eq $before) 'Failure changed the original release'
  } elseif ($Scenario -in @('restore-failure', 'destination-conflict')) {
    Assert-ReleaseTest ($null -ne $failure -and "$failure".Contains('Recover it from')) 'Failure must report recovery location'
    $retained = @(Get-ChildItem -LiteralPath $taskRoot -Directory -Filter '.release-previous-*')
    Assert-ReleaseTest ($retained.Count -eq 1) 'Previous release must remain recoverable'
    Assert-ReleaseTest ((Get-ReleaseSnapshot $retained[0].FullName) -eq $before) 'Retained release changed'
    if ($Scenario -eq 'destination-conflict') {
      Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $releases 'conflict.txt')) -eq 'concurrent-file') 'Concurrent destination was overwritten'
    }
  } else {
    if ($failure) { throw $failure }
    Assert-ReleaseTest $script:verified 'Publication skipped verification'
    Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $releases $setupName)) -eq 'new-installer') 'Installer was not promoted'
    Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $releases $portableName)) -eq 'new-portable') 'Portable was not promoted'
    if ($Scenario -ne 'first-release') {
      Assert-ReleaseTest ([IO.File]::ReadAllText((Join-Path $releases 'SportsDesk_1.5.0_portable.exe')) -eq 'older-version') 'Older release was lost'
    }
    if ($Scenario -eq 'local-only') {
      Assert-ReleaseTest (-not (Test-Path -LiteralPath (Join-Path $releases 'latest-1.6.0.json'))) 'Old manifest survived a local-only rebuild'
    } else {
      $manifest = Get-Content -LiteralPath (Join-Path $releases 'latest-1.6.0.json') -Raw | ConvertFrom-Json
      Assert-ReleaseTest ($manifest.platforms.'windows-x86_64'.signature -eq 'new-signature') 'Manifest signature does not match'
    }
  }
  Assert-ReleaseTest (@(Get-ChildItem -LiteralPath $taskRoot -Directory -Filter '.release-stage-*').Count -eq 0) 'Staging directory was not cleaned'
  if ($Scenario -notin @('restore-failure', 'destination-conflict')) {
    Assert-ReleaseTest (@(Get-ChildItem -LiteralPath $taskRoot -Directory -Filter '.release-previous-*').Count -eq 0) 'Rollback directory was not cleaned'
  }
  Write-Output "PASS $Scenario"
} finally {
  # Resolve and check before every recursive cleanup of a computed path.
  Assert-ReleaseTest ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($taskRoot)) -eq $tempParent) 'Unsafe temporary directory'
  if (Test-Path -LiteralPath $taskRoot) { Remove-Item -LiteralPath $taskRoot -Recurse -Force }
}
