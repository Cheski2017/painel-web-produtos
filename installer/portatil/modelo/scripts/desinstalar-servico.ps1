<#
.SINOPSE
  Desfaz o que `instalar-servico.ps1` fez: para e remove a tarefa agendada e
  a regra de firewall. Não mexe nos arquivos do pacote nem em `app\data\`
  (painéis salvos e configuração da API) - para remover tudo, apague a
  pasta manualmente depois de rodar isto.
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
