# IRIS//VIZ - mise a jour en un clic
# Telecharge la derniere version du depot GitHub, reinstalle, reconstruit et relance le site.
# Depot prive : mettre un jeton GitHub (lecture seule) dans C:\dev\github-token.txt
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$proj = Split-Path -Parent $PSScriptRoot
$repo = 'Kruikruik/irispoop'
$tokenFile = Join-Path (Split-Path -Parent $proj) 'github-token.txt'
$headers = @{ 'User-Agent' = 'iris-updater' }
if (Test-Path $tokenFile) { $headers['Authorization'] = 'token ' + (Get-Content $tokenFile -Raw).Trim() }

Write-Host ''
Write-Host '== IRIS//VIZ : mise a jour ==' -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP ('iris-update-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  Write-Host '[1/5] Telechargement de la derniere version...'
  $zip = Join-Path $tmp 'src.zip'
  try {
    Invoke-WebRequest "https://api.github.com/repos/$repo/zipball/main" -Headers $headers -OutFile $zip -UseBasicParsing
  } catch {
    Write-Host "Echec du telechargement. Depot prive ? Mets un jeton GitHub dans $tokenFile" -ForegroundColor Red
    throw
  }

  Write-Host '[2/5] Extraction...'
  Expand-Archive $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem $tmp -Directory | Select-Object -First 1

  Write-Host '[3/5] Arret du site et copie des fichiers...'
  Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  robocopy $src.FullName $proj /E /XD node_modules dist .git /XF Mettre-a-jour-IRIS.bat /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'La copie des fichiers a echoue' }

  Set-Location $proj
  Write-Host '[4/5] npm install + build (1-2 min)...'
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'npm install a echoue' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build a echoue' }

  Write-Host '[5/5] Redemarrage du site...'
  Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $proj 'scripts\demarrer-iris.vbs') + '"')
  Write-Host ''
  Write-Host 'Termine ! Ouvre http://localhost:4173' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host ('ERREUR : ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Fais une capture de cette fenetre et envoie-la a Claude.'
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
