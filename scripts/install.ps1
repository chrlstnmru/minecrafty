# Installs or upgrades the Minecrafty panel on Windows 10/11 or Windows Server, as a service.
#
#   irm https://raw.githubusercontent.com/chrlstnmru/minecrafty/main/scripts/install.ps1 | iex
#
# Run it from an elevated PowerShell. Run it again to upgrade in place: it fetches the newest
# release and restarts the service only when the program changed.
#
# Parameters (when saved as a file):
#   -Uninstall   remove the service and the program, keeping the data
#   -Purge       with -Uninstall, remove the data too (worlds, backups, accounts)
#   -Port        the port the panel listens on (default 3000; used on first install)
#   -Version     a tag such as v0.1.0 (default: the latest release)
#   -Repo        GitHub "owner/name" to download from
#
# Java is not installed here: the panel downloads the Temurin JRE each server needs.
#
# Note: Windows stops every process of a service with it, so the game servers stop whenever the
# service stops, which includes an upgrade. Stop the servers from the panel first.
[CmdletBinding()]
param(
  [switch]$Uninstall,
  [switch]$Purge,
  [int]$Port = 3000,
  [string]$Version = 'latest',
  [string]$Repo = 'chrlstnmru/minecrafty'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'Minecrafty'
$InstallDir = Join-Path $env:ProgramFiles 'Minecrafty'
$DataDir = Join-Path $env:ProgramData 'Minecrafty'
$Binary = Join-Path $InstallDir 'minecrafty.exe'
$Wrapper = Join-Path $InstallDir 'minecrafty-service.exe'
$WrapperConfig = Join-Path $InstallDir 'minecrafty-service.xml'
# WinSW runs a program as a Windows service; pinned so the install does not change under you
$WinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'

function Say($message) { Write-Host "==> $message" -ForegroundColor Cyan }

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an elevated PowerShell (Run as administrator).'
}

function Stop-PanelService {
  if (Test-Path $Wrapper) { & $Wrapper stop 2>$null | Out-Null }
}

if ($Uninstall) {
  if (Test-Path $Wrapper) {
    & $Wrapper stop 2>$null | Out-Null
    & $Wrapper uninstall | Out-Null
  }
  Remove-NetFirewallRule -DisplayName 'Minecrafty panel' -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  if ($Purge) {
    Remove-Item -Recurse -Force $DataDir -ErrorAction SilentlyContinue
    Say 'Removed Minecrafty and its data.'
  } else {
    Say "Removed Minecrafty. Your data is still in $DataDir (use -Purge to delete it)."
  }
  return
}

if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw "Unsupported processor: $($env:PROCESSOR_ARCHITECTURE). Only 64-bit Intel/AMD is built for Windows."
}

$asset = 'minecrafty-windows-x64.exe'
$base = if ($Version -eq 'latest') { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$Version" }

$temp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  Say "Downloading $asset ($Version)"
  $download = Join-Path $temp $asset
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $download
  $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS").Content
  $line = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($asset) + '\s*$' } | Select-Object -First 1)
  if (-not $line) { throw "$asset is not in the release's checksums." }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 $download).Hash.ToLower()
  if ($expected -ne $actual) { throw 'The download does not match its checksum; not installing it.' }

  New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null

  $changed = $true
  if (Test-Path $Binary) {
    $changed = (Get-FileHash -Algorithm SHA256 $Binary).Hash.ToLower() -ne $actual
  }
  if ($changed) {
    Say 'Installing the program'
    Stop-PanelService
    Copy-Item -Force $download $Binary
  } else {
    Say 'Already up to date'
  }

  if (-not (Test-Path $Wrapper)) {
    Say 'Getting the service wrapper (WinSW)'
    Invoke-WebRequest -Uri $WinSwUrl -OutFile $Wrapper
  }

  # a port chosen on a later run is kept: the existing file's value wins unless -Port was given
  if ((Test-Path $WrapperConfig) -and -not $PSBoundParameters.ContainsKey('Port')) {
    $existing = Select-String -Path $WrapperConfig -Pattern 'name="PORT" value="(\d+)"'
    if ($existing) { $Port = [int]$existing.Matches[0].Groups[1].Value }
  }

  @"
<service>
  <id>$ServiceName</id>
  <name>Minecrafty server panel</name>
  <description>Manages Minecraft servers.</description>
  <executable>$Binary</executable>
  <workingdirectory>$DataDir</workingdirectory>
  <env name="PORT" value="$Port" />
  <env name="HOST" value="0.0.0.0" />
  <env name="MINECRAFTY_DATA" value="$DataDir" />
  <onfailure action="restart" delay="3 sec" />
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@ | Set-Content -Encoding UTF8 $WrapperConfig

  if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) {
    & $Wrapper install | Out-Null
  }
  if (-not (Get-NetFirewallRule -DisplayName 'Minecrafty panel' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Minecrafty panel' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
  }

  Say 'Starting the panel'
  & $Wrapper restart | Out-Null
  if ((Get-Service $ServiceName).Status -ne 'Running') { & $Wrapper start | Out-Null }

  $up = $false
  foreach ($i in 1..30) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/login" -TimeoutSec 2 | Out-Null
      $up = $true
      break
    } catch {
      if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -lt 500) { $up = $true; break }
      Start-Sleep -Seconds 1
    }
  }
  if (-not $up) { throw "The panel did not start. See the logs in $InstallDir." }

  $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | Select-Object -First 1).IPAddress
  if (-not $ip) { $ip = 'localhost' }
  Say 'Minecrafty is running'
  Write-Host "    First run: open  http://${ip}:$Port/setup  to create the owner account."
  Write-Host "    Already set up: open  http://${ip}:$Port"
  Write-Host "    Data: $DataDir"
} finally {
  Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
}
