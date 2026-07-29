<#
.SINOPSE
  Deixa o Painel de Ofertas rodando sozinho, sem precisar de janela de CMD
  aberta: confere/instala o Node.js se faltar, registra uma Tarefa Agendada
  do Windows que inicia o servidor no boot (mesmo sem ninguém logado) e
  reinicia sozinha se cair, e libera a porta no Firewall do Windows para que
  outros computadores da rede consigam acessar o painel.

  É seguro rodar este script mais de uma vez (por exemplo, depois de trocar
  a porta no .env): ele recria a tarefa e a regra de firewall do zero.

.OBSERVAÇÃO
  Isto NÃO cria um "Serviço do Windows" de verdade (não aparece em
  services.msc) - usa o Agendador de Tarefas do Windows, que é nativo (não
  precisa instalar nenhuma ferramenta de terceiros) e cumpre o mesmo papel:
  inicia sozinho no boot e reinicia se cair. Para conferir se está rodando,
  use o `verificar-status.ps1` (ou o atalho "Verificar Status" no Menu
  Iniciar) - ele confere o processo E se o site realmente responde.
#>

param(
  [string]$NomeTarefa = "PainelOfertasServidor",
  [int]$PortaPadrao = 3000
)

$ErrorActionPreference = "Stop"

function Escrever-Titulo($texto) {
  Write-Host ""
  Write-Host "== $texto ==" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# 0. Precisa ser administrador (tarefa agendada como SYSTEM + firewall exigem)
# ---------------------------------------------------------------------------
$usuarioAtual = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($usuarioAtual)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Este script precisa ser executado como Administrador." -ForegroundColor Red
  exit 1
}

$InstallDir = Split-Path -Parent $PSScriptRoot
Write-Host "Pasta de instalação: $InstallDir"

# ---------------------------------------------------------------------------
# 1. Node.js - confere se já está instalado, senão baixa e instala sozinho
# ---------------------------------------------------------------------------
Escrever-Titulo "Verificando Node.js"

function Atualizar-PathDaSessao {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}

$nodeComando = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeComando) {
  Write-Host "Node.js não encontrado. Baixando e instalando automaticamente..."

  $versaoLts = $null
  try {
    $indice = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 20
    $versaoLts = ($indice | Where-Object { $_.lts -ne $false } | Select-Object -First 1).version
  } catch {
    Write-Host "Não consegui consultar a lista de versões do Node.js (sem internet?): $($_.Exception.Message)" -ForegroundColor Yellow
  }
  if (-not $versaoLts) {
    $versaoLts = "v20.18.1" # versão LTS de reserva, caso a consulta acima falhe
    Write-Host "Usando versão de reserva $versaoLts."
  }

  $nodeMsiUrl = "https://nodejs.org/dist/$versaoLts/node-$versaoLts-x64.msi"
  $nodeMsiPath = Join-Path $env:TEMP "node-installer.msi"

  Write-Host "Baixando $nodeMsiUrl ..."
  Invoke-WebRequest -Uri $nodeMsiUrl -OutFile $nodeMsiPath

  Write-Host "Instalando Node.js (silencioso, pode levar um minuto)..."
  $processo = Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsiPath`" /quiet /norestart" -Wait -PassThru
  Remove-Item $nodeMsiPath -Force -ErrorAction SilentlyContinue

  if ($processo.ExitCode -ne 0) {
    Write-Host "A instalação do Node.js terminou com código $($processo.ExitCode)." -ForegroundColor Red
    Write-Host "Instale o Node.js manualmente em https://nodejs.org e rode este script de novo." -ForegroundColor Red
    exit 1
  }

  Atualizar-PathDaSessao
  $nodeComando = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeComando) {
    Write-Host "Node.js foi instalado, mas não foi encontrado no PATH desta sessão." -ForegroundColor Yellow
    Write-Host "Normalmente resolve reiniciando o computador. Rode este script de novo depois." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "Node.js instalado com sucesso: $($nodeComando.Source)" -ForegroundColor Green
} else {
  Write-Host "Node.js já instalado: $($nodeComando.Source)" -ForegroundColor Green
}

$nodeExe = $nodeComando.Source

# ---------------------------------------------------------------------------
# 2. Garante que a pasta de dados existe (onde ficam os painéis salvos)
# ---------------------------------------------------------------------------
$dataDir = Join-Path $InstallDir "data"
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# 3. Descobre a porta configurada (lê do .env, se existir)
# ---------------------------------------------------------------------------
$porta = $PortaPadrao
$envPath = Join-Path $InstallDir ".env"
if (Test-Path $envPath) {
  $linhaPorta = Get-Content $envPath | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } | Select-Object -First 1
  if ($linhaPorta -match '^\s*PORT\s*=\s*(\d+)\s*$') {
    $porta = [int]$Matches[1]
  }
}
Write-Host "Porta configurada: $porta"

# ---------------------------------------------------------------------------
# 4. Tarefa agendada: inicia o servidor no boot, mesmo sem ninguém logado,
#    e reinicia sozinha se o processo cair.
# ---------------------------------------------------------------------------
Escrever-Titulo "Configurando início automático"

Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue

$acao = New-ScheduledTaskAction -Execute $nodeExe -Argument "src\server.js" -WorkingDirectory $InstallDir
$gatilho = New-ScheduledTaskTrigger -AtStartup
$principalTarefa = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$configuracoes = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho `
  -Principal $principalTarefa -Settings $configuracoes -Force | Out-Null

Write-Host "Tarefa agendada '$NomeTarefa' criada." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Libera a porta no Firewall do Windows (para outros computadores da rede
#    conseguirem acessar - a própria máquina acessa por localhost sem isso)
# ---------------------------------------------------------------------------
Escrever-Titulo "Configurando Firewall"

$nomeRegraFirewall = "Painel de Ofertas (porta $porta)"
Get-NetFirewallRule -DisplayName "Painel de Ofertas*" -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName $nomeRegraFirewall -Direction Inbound -Protocol TCP `
  -LocalPort $porta -Action Allow -Profile Any | Out-Null

Write-Host "Regra de firewall '$nomeRegraFirewall' criada." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 6. Inicia agora (não precisa esperar reiniciar o computador)
# ---------------------------------------------------------------------------
Escrever-Titulo "Iniciando o painel"

Start-ScheduledTask -TaskName $NomeTarefa
Start-Sleep -Seconds 2

$tarefa = Get-ScheduledTask -TaskName $NomeTarefa
$infoTarefa = $tarefa | Get-ScheduledTaskInfo
Write-Host "Estado da tarefa: $($tarefa.State)"

# ---------------------------------------------------------------------------
# 7. Mostra o endereço para acessar - desta máquina e de outras na rede
# ---------------------------------------------------------------------------
Escrever-Titulo "Pronto"

$ipsLocais = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    # só faixas de rede local de verdade (RFC 1918) - descarta link-local,
    # loopback e qualquer IP público que a máquina tenha (VPN, nuvem, etc.),
    # que não são alcançáveis pelos outros computadores da loja
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
  } |
  Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "Nesta máquina:        http://localhost:$porta" -ForegroundColor Green
foreach ($ip in $ipsLocais) {
  Write-Host "De outros computadores da rede: http://$ip`:$porta" -ForegroundColor Green
}
Write-Host ""
Write-Host "Na primeira vez, abra esse endereço e clique no ícone de" -ForegroundColor Yellow
Write-Host "engrenagem (⚙️) na tela de login para configurar o endereço da" -ForegroundColor Yellow
Write-Host "API, usuário e senha. Nas outras máquinas da rede, é só entrar" -ForegroundColor Yellow
Write-Host "com esse mesmo usuário e senha." -ForegroundColor Yellow
