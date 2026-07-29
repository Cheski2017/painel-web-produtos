<#
.SINOPSE
  Desfaz o que `instalar-servico.ps1` fez: para e remove a tarefa agendada e
  a regra de firewall. Rodado automaticamente pelo desinstalador. Não mexe
  nos arquivos do painel (isso é responsabilidade do desinstalador do Inno
  Setup) nem no Node.js (pode estar sendo usado por outra coisa na máquina).
#>

param(
  [string]$NomeTarefa = "PainelOfertasServidor"
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Parando e removendo a tarefa agendada '$NomeTarefa'..."
Stop-ScheduledTask -TaskName $NomeTarefa
Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false

Write-Host "Removendo regra de firewall..."
Get-NetFirewallRule -DisplayName "Painel de Ofertas*" | Remove-NetFirewallRule

Write-Host "Concluído."
