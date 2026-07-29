# Pacote portátil (alternativa ao instalador .exe)

Gera um `.zip` autossuficiente (Node.js incluso, nada baixa nada da
internet durante a instalação) que **não é um executável compilado** —
existe especificamente porque o instalador `.exe` (Inno Setup, em
`installer/setup.iss`) foi classificado como falso positivo pelo Windows
Defender (`Trojan:Win32/Wacatac.B!ml`), um padrão comum para instaladores
sem assinatura digital que baixam arquivos e mexem em tarefa
agendada/firewall sozinhos. Testado (scan manual do Defender no `.zip` e
nos ~2000 arquivos extraídos): **zero detecções**.

## Gerando o pacote

Na sua máquina (não na do cliente):

```powershell
powershell -ExecutionPolicy Bypass -File installer\portatil\montar-pacote.ps1
```

Isso baixa o Node.js portátil oficial (com cache local em
`installer/portatil/cache/` - só baixa de novo se mudar a versão) e monta
o `.zip` final em `installer/portatil/output/PainelOfertas-vX.Y.Z.zip`
(usa a versão do `package.json` automaticamente).

## Distribuindo

Manda o `.zip` pro cliente por qualquer meio direto (RDP com área de
transferência/unidade compartilhada, pendrive, etc.) - **evite** depender
de sincronização de pasta (OneDrive e afins), que pode demorar a propagar
entre máquinas.

## Instruções para quem instala

Ficam dentro do próprio pacote, em `LEIA-ME.txt` (arquivo `modelo/LEIA-ME.txt`
aqui no repositório é o que vai dentro do zip): extrair a pasta, clicar
com o botão direito em `INSTALAR.bat` → "Executar como administrador",
aguardar, configurar a conexão com a API na tela que abre.

## Estrutura do pacote gerado

```
PainelOfertas-vX.Y.Z/
  INSTALAR.bat          - único arquivo que o usuário final precisa clicar
  DESINSTALAR.bat
  LEIA-ME.txt
  node/                 - Node.js portátil oficial (não baixa nada)
  app/                  - src/, public/, package.json, .env.example, data/
  scripts/              - instalar-servico.ps1, verificar-status, etc.
    (mesma lógica dos scripts de installer/scripts/, adaptada pra usar o
    Node de dentro do pacote em vez de instalar um no sistema)
```

## Atualizações

Depois de instalado uma vez, novas versões chegam pelo botão
"Atualizações" dentro do próprio painel (ver seção 7 do
[`README.md`](../../README.md) principal) - não precisa gerar nem
distribuir um pacote novo pra cada versão, só na instalação inicial.
