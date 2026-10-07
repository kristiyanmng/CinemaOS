$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "CinemaOS Agent Setup" -ForegroundColor Cyan
Write-Host "--------------------"

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $agentDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js 20+ is required." -ForegroundColor Yellow
  Write-Host "Install Node.js LTS from https://nodejs.org/ and run this setup again."
  Read-Host "Press Enter to exit"
  exit 1
}

$nodeVersion = node -v
Write-Host "Node.js detected: $nodeVersion" -ForegroundColor Green

npm install

$programData = $env:ProgramData
$dataDir = Join-Path $programData "CinemaOSAgent"
$configPath = Join-Path $dataDir "config.json"

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not (Test-Path $configPath)) {
  $config = @{
    apiBase = "https://cinemaos.kristianmarkov5.workers.dev"
    name = "Cinema Palace Agent"
    enrollmentKey = ""
    agentId = ""
    agentToken = ""
  } | ConvertTo-Json
  Set-Content -Path $configPath -Value $config -Encoding UTF8
}

Write-Host ""
Write-Host "Configuration file:" -ForegroundColor Cyan
Write-Host $configPath
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "1. Open the config file above with Notepad."
Write-Host "2. Put your Cloudflare AGENT_ENROLLMENT_KEY value in enrollmentKey."
Write-Host "3. Save it."
Write-Host "4. Run Start-Agent.bat."
Write-Host ""
Write-Host "After successful enrollment the key is removed and replaced by an Agent token." -ForegroundColor Green
Read-Host "Press Enter to finish"
