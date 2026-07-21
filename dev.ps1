# Lanceur PowerShell — ajoute Node.js au PATH de la session puis démarre l'app
$ErrorActionPreference = 'Stop'
$nodeDir = 'C:\Program Files\nodejs'
if (-not (Test-Path (Join-Path $nodeDir 'npm.cmd'))) {
  Write-Error "Node.js introuvable dans $nodeDir. Installez Node.js 20+ depuis https://nodejs.org"
  exit 1
}
$env:Path = "$nodeDir;$env:Path"
Set-Location $PSScriptRoot
& (Join-Path $nodeDir 'npm.cmd') run dev @args
