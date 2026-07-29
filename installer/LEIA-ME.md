# Instalador do Painel de Ofertas (Windows)

Gera um `PainelOfertasSetup.exe` que instala o painel numa máquina Windows
(a que vai funcionar como "servidor") e deixa ele rodando sozinho, sem
precisar abrir CMD/PowerShell no dia a dia. As outras máquinas da loja não
precisam instalar nada — acessam pelo navegador.

## 1. Gerando o instalador (só uma vez, na sua máquina)

1. Baixe e instale o **Inno Setup** (gratuito): https://jrsoftware.org/isdl.php
   — qualquer versão 6.x serve.
2. Abra `installer/setup.iss` no Inno Setup e clique em **Compile**
   (ou, pela linha de comando: `ISCC.exe installer\setup.iss`).
3. O instalador final aparece em `installer/output/PainelOfertasSetup.exe`.

Esse `.exe` é o que você manda para o cliente — é autossuficiente, não
precisa levar mais nada junto (nem pasta do projeto, nem Node.js).

## 2. O que o instalador faz na máquina do cliente

Precisa rodar como **Administrador** (o próprio instalador já pede elevação).

1. Copia os arquivos do painel para `C:\Program Files\PainelOfertas`.
2. Confere se tem Node.js instalado; se não tiver, baixa e instala sozinho
   (precisa de internet nesse passo).
3. Registra uma **Tarefa Agendada do Windows** chamada
   `PainelOfertasServidor` que inicia o servidor no boot do computador
   (mesmo sem ninguém logado) e reinicia sozinha se cair.
   - Isso **não é um Serviço do Windows "de verdade"** (não aparece em
     `services.msc`) — é o Agendador de Tarefas, que é nativo do Windows e
     não exige instalar nenhuma ferramenta de terceiros. Ver seção 4 para
     como conferir se está rodando.
4. Libera a porta configurada (padrão 3000) no Firewall do Windows, para que
   os outros computadores da rede consigam acessar.
5. No fim, abre o navegador na tela de login.

## 3. Primeira configuração (a fazer uma vez, na máquina servidor)

Na tela de login que abre no final da instalação, clique no ícone de
engrenagem (⚙️) e preencha:

- **Endereço da API** — o endereço da API RP Services desse cliente.
- **Usuário** e **Senha** — as credenciais de acesso ao web service da RP
  Info desse cliente.

Use **Testar conexão** antes de salvar. Depois de salvar, entre na tela de
login com esse mesmo usuário e senha — é o mesmo login usado no dia a dia.

## 4. No dia a dia

Atalhos ficam no Menu Iniciar, dentro de "Painel de Ofertas":

- **Abrir Painel de Ofertas** — abre no navegador.
- **Verificar status** — mostra se está rodando (tarefa agendada + se o
  site realmente responde) e os endereços para acessar de outros
  computadores da rede.
- **Iniciar** / **Parar** / **Reiniciar** — controle manual, se precisar.

Outras máquinas da loja: basta abrir o navegador em
`http://IP-DA-MAQUINA-SERVIDOR:3000` (o "Verificar status" mostra esse
endereço) e entrar com o mesmo usuário/senha configurado no passo 3. Não
precisa instalar nada nelas.

## 5. Atualizando para uma versão nova do painel

Na maioria das vezes **não precisa gerar instalador novo nem mexer na
máquina do cliente**: o próprio painel se atualiza sozinho, direto do
GitHub — quem está logado vê um botão "Atualizações" no topo, que baixa e
aplica a versão mais nova e reinicia sozinho (não mexe em `.env`/`data\`).
Veja a seção 7 do [`README.md`](../README.md) principal para o processo de
publicar uma nova versão.

Só vale gerar um instalador novo (seção 1) e rodar de novo na máquina
servidor se precisar mudar algo do **próprio instalador** (ex: nova regra
de firewall, novo atalho) - nesse caso ele reconhece a instalação existente
e não mexe no `.env`/`data\`.

## 6. Desinstalando

Painel de Controle → Programas → "Painel de Ofertas" → Desinstalar. Isso
para e remove a tarefa agendada e a regra de firewall, e remove os arquivos
do programa. Os painéis salvos e a configuração da API (pasta `data\` e o
`.env`) **não são apagados automaticamente** — apague a pasta de instalação
manualmente depois se quiser limpar tudo.

## 7. Limitações conhecidas

- Precisa rodar como Administrador (Tarefa Agendada como SYSTEM + regra de
  Firewall exigem).
- Baixar o Node.js automaticamente exige internet na máquina no momento da
  instalação. Se a máquina não tiver internet, instale o Node.js manualmente
  antes (https://nodejs.org, versão LTS) e rode o instalador de novo.
- Se a máquina tiver mais de um adaptador de rede (Wi-Fi + cabo, VPN, etc.),
  o "Verificar status" lista todos os IPs de rede local encontrados — teste
  qual funciona a partir de outro computador da loja.
