<#
.SINOPSE
  Monta o pacote portátil do Painel de Ofertas: junta o modelo (scripts,
  INSTALAR.bat, LEIA-ME), o código da aplicação (src/, public/, etc.) e o
  Node.js portátil (baixado direto do site oficial, com cache local pra não
  baixar de novo toda hora) numa única pasta, e zipa tudo.

  Rode isto na SUA máquina (não na do cliente) toda vez que quiser gerar um
  pacote novo pra distribuir:

    powershell -ExecutionPolicy Bypass -File installer\portatil\montar-pacote.ps1

  O .zip final aparece em installer\portatil\output\.
#>

param(
  [string]$VersaoNode = "v24.18.1",
  [string]$VersaoPacote = $null # se não informado, usa a versão do package.json
)

$ErrorActionPreference = "Stop"

$PortatilDir = $PSScriptRoot
$RaizProjeto = Split-Path -Parent (Split-Path -Parent $PortatilDir)
$ModeloDir = Join-Path $PortatilDir "modelo"
$SaidaDir = Join-Path $PortatilDir "output"
$CacheDir = Join-Path $PortatilDir "cache"
$TempDir = Join-Path $env:TEMP ("painel-pacote-" + [guid]::NewGuid().ToString("N"))

if (-not $VersaoPacote) {
  $pkg = Get-Content (Join-Path $RaizProjeto "package.json") -Raw | ConvertFrom-Json
  $VersaoPacote = $pkg.version
}

$NomePacote = "PainelOfertas-v$VersaoPacote"
$PastaFinal = Join-Path $TempDir $NomePacote

Write-Host "== Montando pacote $NomePacote ==" -ForegroundColor Cyan

New-Item -ItemType Directory -Path $PastaFinal -Force | Out-Null

# 1. modelo (INSTALAR.bat, DESINSTALAR.bat, LEIA-ME.txt, scripts\)
Write-Host "Copiando modelo..."
Copy-Item (Join-Path $ModeloDir "*") -Destination $PastaFinal -Recurse -Force

# 2. aplicação (src/, public/, package.json, .env.example)
Write-Host "Copiando aplicação..."
$AppDestino = Join-Path $PastaFinal "app"
New-Item -ItemType Directory -Path $AppDestino -Force | Out-Null
Copy-Item (Join-Path $RaizProjeto "src") (Join-Path $AppDestino "src") -Recurse -Force
Copy-Item (Join-Path $RaizProjeto "public") (Join-Path $AppDestino "public") -Recurse -Force
Copy-Item (Join-Path $RaizProjeto "package.json") $AppDestino -Force
Copy-Item (Join-Path $RaizProjeto ".env.example") $AppDestino -Force
New-Item -ItemType Directory -Path (Join-Path $AppDestino "data") -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $AppDestino "data\.gitkeep") -Force | Out-Null

# 3. Node.js portátil (com cache local)
$NodeZipCache = Join-Path $CacheDir "node-$VersaoNode-win-x64.zip"
if (-not (Test-Path $NodeZipCache)) {
  New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
  $url = "https://nodejs.org/dist/$VersaoNode/node-$VersaoNode-win-x64.zip"
  Write-Host "Baixando Node.js portátil de $url ..."
  Invoke-WebRequest -Uri $url -OutFile $NodeZipCache
} else {
  Write-Host "Usando Node.js portátil em cache: $NodeZipCache"
}

Write-Host "Extraindo Node.js..."
$NodeExtractTemp = Join-Path $TempDir "node-extract"
Expand-Archive -Path $NodeZipCache -DestinationPath $NodeExtractTemp -Force
$NodePastaExtraida = Get-ChildItem $NodeExtractTemp -Directory | Select-Object -First 1
Move-Item $NodePastaExtraida.FullName (Join-Path $PastaFinal "node")

# 4. zipa tudo
if (-not (Test-Path $SaidaDir)) { New-Item -ItemType Directory -Path $SaidaDir -Force | Out-Null }
$ZipFinal = Join-Path $SaidaDir "$NomePacote.zip"
if (Test-Path $ZipFinal) { Remove-Item $ZipFinal -Force }
Write-Host "Compactando..."
Compress-Archive -Path $PastaFinal -DestinationPath $ZipFinal

Remove-Item $TempDir -Recurse -Force

Write-Host ""
Write-Host "Pronto: $ZipFinal" -ForegroundColor Green
Write-Host "Tamanho: $([math]::Round((Get-Item $ZipFinal).Length / 1MB, 1)) MB"
