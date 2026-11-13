# IRIS//VIZ - installation / mise a jour en une ligne (PowerShell) :
#   irm https://raw.githubusercontent.com/Kruikruik/irispoop/main/install.ps1 | iex
# Installe dans C:\dev\irispoop, active le demarrage automatique et ouvre http://localhost:4173

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$irisDir = 'C:\dev\irispoop'
Write-Host ''
Write-Host '== IRIS//VIZ : installation ==' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js est introuvable. Installe la version LTS depuis https://nodejs.org puis relance la commande.' -ForegroundColor Red
} else {
  # arrete le site s'il tourne deja (port 4173 = site, 5173 = mode dev)
  foreach ($irisPort in 4173, 5173) {
    Get-NetTCPConnection -LocalPort $irisPort -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  $irisUpdater = Join-Path $env:TEMP 'iris-update.mjs'
  Invoke-WebRequest 'https://raw.githubusercontent.com/Kruikruik/irispoop/main/scripts/update.mjs' -OutFile $irisUpdater -UseBasicParsing
  node $irisUpdater --dir $irisDir --install
}
