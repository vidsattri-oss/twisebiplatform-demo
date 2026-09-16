[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$env:NG_CLI_ANALYTICS = 'false'

$repoRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $repoRoot '.local-run'
$logRoot = Join-Path $stateRoot 'logs'
$pidFile = Join-Path $stateRoot 'pids.json'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Ensure-Dependencies([string]$Name, [string]$Directory) {
  $nodeModules = Join-Path $Directory 'node_modules'
  $manifest = Get-Content -LiteralPath (Join-Path $Directory 'package.json') -Raw | ConvertFrom-Json
  $hasDependencies = @('dependencies', 'devDependencies') | Where-Object {
    $property = $manifest.PSObject.Properties[$_]
    $null -ne $property -and $property.Value.PSObject.Properties.Count -gt 0
  }
  if (-not $hasDependencies) { return }
  if (Test-Path -LiteralPath $nodeModules) { return }
  if (-not $Install) {
    throw "$Name dependencies are missing. Re-run with -Install, or run npm install in $Directory."
  }

  Write-Host "Installing $Name dependencies..." -ForegroundColor Cyan
  Push-Location $Directory
  try {
    & $npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed for $Name." }
  } finally {
    Pop-Location
  }
}

function Test-Endpoint([string]$Url, [hashtable]$Headers = @{}) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Wait-Endpoint([string]$Name, [string]$Url, [hashtable]$Headers = @{}, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Endpoint $Url $Headers) {
      Write-Host "$Name is ready: $Url" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "$Name did not become ready at $Url. Check logs in $logRoot."
}

function Start-ServiceProcess([string]$Name, [string]$Directory) {
  $stdout = Join-Path $logRoot "$Name.out.log"
  $stderr = Join-Path $logRoot "$Name.err.log"
  $process = Start-Process `
    -FilePath $npm `
    -ArgumentList @('start') `
    -WorkingDirectory $Directory `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "$Name started (PID $($process.Id)); logs: $stdout" -ForegroundColor DarkCyan
  return [pscustomobject]@{ name = $Name; pid = $process.Id; stdout = $stdout; stderr = $stderr }
}

function Test-HostHarness {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4200' -TimeoutSec 2
    return $response.StatusCode -eq 200 -and ($response.Content -match 'tw-root|@tasnim/bi|Al Tasnim')
  } catch {
    return $false
  }
}

function Wait-HostHarness([int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-HostHarness) {
      Write-Host 'host-harness is ready: http://localhost:4200' -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "host-harness did not become ready at http://localhost:4200. Check logs in $logRoot."
}

$preferencesDirectory = Join-Path $repoRoot 'preferences-server'
$biDirectory = Join-Path $repoRoot 'query-builder-prototype'
$hostDirectory = Join-Path $repoRoot 'twise-bi'

Ensure-Dependencies 'preferences-server' $preferencesDirectory
Ensure-Dependencies 'query-builder-prototype' $biDirectory
Ensure-Dependencies 'twise-bi' $hostDirectory

$started = @()

if (Test-Endpoint 'http://localhost:4175/health') {
  Write-Host 'preferences-server is already running.' -ForegroundColor Yellow
} else {
  $started += Start-ServiceProcess 'preferences-server' $preferencesDirectory
}
Wait-Endpoint 'preferences-server' 'http://localhost:4175/health'

if (Test-Endpoint 'http://localhost:4173/api/health') {
  Write-Host 'query-builder-prototype is already running.' -ForegroundColor Yellow
} else {
  $started += Start-ServiceProcess 'query-builder-prototype' $biDirectory
}
Wait-Endpoint 'query-builder-prototype' 'http://localhost:4173/api/health'

if (Test-HostHarness) {
  Write-Host 'host-harness is already running.' -ForegroundColor Yellow
} else {
  $started += Start-ServiceProcess 'host-harness' $hostDirectory
}
Wait-HostHarness

if ($started.Count -gt 0) {
  $started | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8
}

$mainUrl = 'http://localhost:4200'
Write-Host "BI services are running. Main URL: $mainUrl" -ForegroundColor Green
Write-Host "Logs: $logRoot" -ForegroundColor DarkGray

if (-not $NoBrowser) {
  Start-Process $mainUrl
}
