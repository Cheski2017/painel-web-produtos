<#
.SINOPSE
  Mostra se o Painel de Ofertas está rodando: estado da tarefa agendada e se
  o site realmente responde (não só se o processo existe). Como não é um
  Serviço do Windows "de verdade", não aparece em services.msc - esta é a
  forma de conferir.
#>

param(
  [string]$NomeTarefa = "PainelOfertasServidor",
  [int]$PortaPadrao = 3000
)

$InstallDir = Split-Path -Parent $PSScriptRoot

$porta = $PortaPadrao
$envPath = Join-Path $InstallDir ".env"
if (Test-Path $envPath) {
  $linhaPorta = Get-Content $envPath | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } | Select-Object -First 1
  if ($linhaPorta -match '^\s*PORT\s*=\s*(\d+)\s*$') { $porta = [int]$Matches[1] }
}

Write-Host ""
Write-Host "=== Painel de Ofertas - status ===" -ForegroundColor Cyan
Write-Host ""

$tarefa = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
if (-not $tarefa) {
  Write-Host "Tarefa agendada '$NomeTarefa' NÃO ENCONTRADA." -ForegroundColor Red
  Write-Host "Rode o instalador de novo, ou 'instalar-servico.ps1' como Administrador."
} else {
  $cor = if ($tarefa.State -eq "Running") { "Green" } else { "Yellow" }
  Write-Host "Tarefa agendada: $($tarefa.State)" -ForegroundColor $cor
}

try {
  $resposta = Invoke-WebRequest -Uri "http://localhost:$porta/api/config" -TimeoutSec 5 -UseBasicParsing
  if ($resposta.StatusCode -eq 200) {
    Write-Host "Site respondendo em http://localhost:$porta : SIM" -ForegroundColor Green
  } else {
    Write-Host "Site respondeu com status inesperado: $($resposta.StatusCode)" -ForegroundColor Yellow
  }
} catch {
  Write-Host "Site respondendo em http://localhost:$porta : NÃO" -ForegroundColor Red
  Write-Host "  ($($_.Exception.Message))" -ForegroundColor DarkGray
}

Write-Host ""
$ipsLocais = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    # só faixas de rede local de verdade (RFC 1918) - descarta link-local,
    # loopback e qualquer IP público que a máquina tenha (VPN, nuvem, etc.),
    # que não são alcançáveis pelos outros computadores da loja
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } |
  Select-Object -ExpandProperty IPAddress
foreach ($ip in $ipsLocais) {
  Write-Host "Endereço para outros computadores da rede: http://$ip`:$porta"
}
Write-Host ""
