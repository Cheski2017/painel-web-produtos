<#
.SINOPSE
  Deixa o Painel de Ofertas rodando sozinho, sem precisar de janela de CMD
  aberta: registra uma Tarefa Agendada do Windows que inicia o servidor no
  boot (mesmo sem ninguém logado) e reinicia sozinha se cair, e libera a
  porta no Firewall do Windows para que outros computadores da rede
  consigam acessar o painel.

  Diferente da versão do instalador .exe, este script NÃO baixa nem instala
  nada da internet - o Node.js já vem pronto dentro da pasta "node\" ao
  lado deste pacote. Isso existe de propósito: instaladores que baixam
  coisas da internet sozinhos costumam disparar falso-positivo de
  antivírus (Windows Defender classificando como "Trojan:Win32/Wacatac.B!ml"
  é um caso comum para esse tipo de comportamento).

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
  Write-Host "Clique com o botão direito em INSTALAR.bat e escolha 'Executar como administrador'." -ForegroundColor Red
  exit 1
}

# raiz do pacote = uma pasta acima de "scripts\"
$InstallDir = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $InstallDir "app"
$NodeExe = Join-Path $InstallDir "node\node.exe"

Write-Host "Pasta do pacote: $InstallDir"

# ---------------------------------------------------------------------------
# 1. Confere se o Node.js portátil está mesmo aí (sem baixar nada)
# ---------------------------------------------------------------------------
Escrever-Titulo "Verificando Node.js incluso no pacote"

if (-not (Test-Path $NodeExe)) {
  Write-Host "Não encontrei '$NodeExe'." -ForegroundColor Red
  Write-Host "Parece que a pasta 'node\' não veio junto, ou o pacote está incompleto." -ForegroundColor Red
  Write-Host "Baixe o pacote de novo e extraia tudo antes de rodar este instalador." -ForegroundColor Red
  exit 1
}
Write-Host "Node.js encontrado: $NodeExe" -ForegroundColor Green
& $NodeExe --version

# ---------------------------------------------------------------------------
# 2. Garante que a pasta de dados existe (onde ficam os painéis salvos)
# ---------------------------------------------------------------------------
$dataDir = Join-Path $AppDir "data"
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# ---------------------------------------------------------------------------
# 3. Garante que existe um .env (copia do .env.example na primeira vez)
# ---------------------------------------------------------------------------
$envPath = Join-Path $AppDir ".env"
$envExemploPath = Join-Path $AppDir ".env.example"
if (-not (Test-Path $envPath) -and (Test-Path $envExemploPath)) {
  Copy-Item $envExemploPath $envPath
  Write-Host "Criei o .env a partir do .env.example."
}

# ---------------------------------------------------------------------------
# 4. Descobre a porta configurada (lê do .env, se existir)
# ---------------------------------------------------------------------------
$porta = $PortaPadrao
if (Test-Path $envPath) {
  $linhaPorta = Get-Content $envPath | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)\s*$' } | Select-Object -First 1
  if ($linhaPorta -match '^\s*PORT\s*=\s*(\d+)\s*$') {
    $porta = [int]$Matches[1]
  }
}
Write-Host "Porta configurada: $porta"

# ---------------------------------------------------------------------------
# 5. Tarefa agendada: inicia o servidor no boot, mesmo sem ninguém logado,
#    e reinicia sozinha se o processo cair.
# ---------------------------------------------------------------------------
Escrever-Titulo "Configurando início automático"

Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue

$acao = New-ScheduledTaskAction -Execute $NodeExe -Argument "src\server.js" -WorkingDirectory $AppDir
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
# 6. Libera a porta no Firewall do Windows (para outros computadores da rede
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
# 7. Inicia agora (não precisa esperar reiniciar o computador)
# ---------------------------------------------------------------------------
Escrever-Titulo "Iniciando o painel"

Start-ScheduledTask -TaskName $NomeTarefa
Start-Sleep -Seconds 2

$tarefa = Get-ScheduledTask -TaskName $NomeTarefa
Write-Host "Estado da tarefa: $($tarefa.State)"

# ---------------------------------------------------------------------------
# 8. Mostra o endereço para acessar - desta máquina e de outras na rede
# ---------------------------------------------------------------------------
Escrever-Titulo "Pronto"

$ipsLocais = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
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
