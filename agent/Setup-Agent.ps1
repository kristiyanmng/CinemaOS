$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "CinemaOS Agent Setup" -ForegroundColor Cyan
Write-Host "--------------------"

$agentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $agentDir

$programData = $env:ProgramData
if ([string]::IsNullOrWhiteSpace($programData)) {
  $programData = "C:\ProgramData"
}

$dataDir = Join-Path $programData "CinemaOSAgent"
$configPath = Join-Path $dataDir "config.json"
$queuePath = Join-Path $dataDir "queue.json"

Write-Host "Creating CinemaOS Agent data folder..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

if (-not (Test-Path $configPath)) {
  $config = @'
{
  "apiBase": "https://cinemaos.kristianmarkov5.workers.dev",
  "name": "Cinema Palace Agent",
  "enrollmentKey": "",
  "agentId": "",
  "agentToken": ""
}
'@
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)
  Write-Host "Created config.json" -ForegroundColor Green
} else {
  Write-Host "config.json already exists - keeping existing file." -ForegroundColor Yellow
}

if (-not (Test-Path $queuePath)) {
  if (-not $utf8NoBom) { $utf8NoBom = New-Object System.Text.UTF8Encoding($false) }
  [System.IO.File]::WriteAllText($queuePath, "[]", $utf8NoBom)
  Write-Host "Created queue.json" -ForegroundColor Green
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "Node.js 20+ is not installed yet." -ForegroundColor Yellow
  Write-Host "The config files were still created successfully."
  Write-Host "Install Node.js LTS, then run Setup-Agent.bat again."
} else {
  $nodeVersion = node -v
  Write-Host "Node.js detected: $nodeVersion" -ForegroundColor Green
  try {
    npm install
  } catch {
    Write-Host "npm install returned an error, but Agent configuration was created." -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "DONE" -ForegroundColor Green
Write-Host "Configuration file:" -ForegroundColor Cyan
Write-Host $configPath
Write-Host ""
Write-Host "Open this file and set enrollmentKey to your Cloudflare secret value."
Write-Host "Then run Start-Agent.bat."
Write-Host ""

Start-Process explorer.exe $dataDir
Read-Host "Press Enter to finish"
