# Painel WEB de Produtos

Painel web que consulta a API **RP Services** (RP Info Sistemas) e exibe as
ofertas vigentes de qualquer departamento (Açougue, Padaria, Hortifruti,
etc.) de uma loja (unidade). O usuário monta os painéis pela própria tela do
sistema: escolhe o departamento e a loja, dá um nome ao painel e escolhe
quais produtos do catálogo devem aparecer nele — os demais ficam de fora. É
possível criar quantos painéis quiser (um por setor, por loja, por ocasião
etc.) e alternar entre eles.

O usuário e senha ficam guardados apenas no servidor, nunca no navegador — o
front-end só conversa com o próprio servidor deste projeto, que por sua vez
busca os dados na API da RP Info. Esse mesmo usuário/senha também é o login
da tela de criação/edição de painéis (veja a seção 3).

Este projeto **não tem dependências externas** (não usa Express, dotenv, etc.
— só recursos nativos do Node.js 18+), então não é necessário rodar
`npm install`. Isso simplifica a instalação em qualquer computador/servidor
que já tenha Node.js.

## 1. Pré-requisitos

- Node.js 18 ou superior instalado (`node --version`).
- Usuário e senha de acesso ao web service da RP Info (o "código de usuário"
  que precisa ser solicitado à empresa que fornece o ERP, caso ainda não
  tenha).
- O endereço (host + porta) real da API da sua empresa — normalmente algo como
  `https://SEU-HOST:PORTA`, fornecido pelo seu time de TI ou pela RP Info.
  **Não é necessariamente o mesmo endereço da documentação.**

## 2. Configuração

1. Copie o arquivo de exemplo:

   ```bash
   cp .env.example .env
   ```

2. Edite o `.env` e preencha pelo menos:

   ```
   RP_BASE_URL=https://SEU-ENDERECO-DA-API:PORTA
   RP_USUARIO=seu_usuario
   RP_SENHA=sua_senha
   ```

3. (Opcional) Rode `npm run discover` para conferir se a autenticação está
   funcionando e ver de antemão a lista de departamentos e unidades
   cadastrados — não é mais obrigatório preencher código de departamento no
   `.env`, pois agora o departamento é escolhido na própria tela ao criar um
   painel (veja a seção 4).

   ```bash
   npm run discover
   ```

   Se quiser, ainda é possível definir em `RP_UNIDADES` (separado por
   vírgula) quais lojas aparecem por padrão nos seletores do painel.

4. (Opcional) Ajuste `PORT`, `REFRESH_INTERVAL_MINUTES` (frequência de
   atualização automática do painel no navegador) e `CACHE_TTL_SECONDS`
   (por quanto tempo o servidor guarda em cache as respostas da API antes de
   consultar de novo).

### Certificado TLS autoassinado

Se ao rodar `npm run discover` você receber um erro relacionado a
certificado (`certificate`, `SSL`, `self signed`), e você tiver certeza de
que está se conectando ao servidor correto (por exemplo, um servidor da sua
própria empresa acessível só pela rede interna/VPN), você pode definir no
`.env`:

```
RP_TLS_REJECT_UNAUTHORIZED=false
```

Isso desativa a validação do certificado. Use com cautela — só se você
confiar completamente na rede e no host.

## 3. Login

A área de criar/editar painéis (`#/` e `#/editor/...`) exige login — a tela
de exibição de um painel (`#/painel/:id`, o que fica ligado na TV) continua
pública, já que uma TV não tem como digitar senha toda vez que liga.

O login usa o **mesmo usuário e senha configurados para a API** (o
`RP_USUARIO`/`RP_SENHA` do `.env`, ou o que você configurar pela tela). Na
própria tela de login existe um ícone de engrenagem (⚙️) que abre a
configuração da conexão (endereço da API, usuário, senha) — é possível usar
esse ícone em vez de editar o `.env` na mão, inclusive para trocar de
usuário/senha depois. Uma vez salva, essa configuração fica em
`data/config.json` e passa a valer para as próximas vezes (tem prioridade
sobre o `.env`).

A sessão de login fica valendo até você clicar em "Sair" (não expira
sozinha) — pensada para um navegador que fica sempre aberto no computador da
loja.

⚠️ A tela de configuração da conexão (endereço/usuário/senha da API) fica
acessível sem estar logado de propósito — é assim que dá pra configurar o
login pela primeira vez. Isso significa que qualquer um que alcançar o
servidor consegue reconfigurar essa conexão; mesma exposição que o projeto
já tinha antes (não havia nenhum tipo de login). Não exponha este servidor
numa rede que não seja de confiança.

## 4. Rodando o painel

```bash
npm start
```

Acesse `http://localhost:3000` (ou a porta configurada em `PORT`) no
navegador.

Para desenvolvimento, com reinício automático ao salvar arquivos:

```bash
npm run dev
```

## 5. Como funciona

### Montando um painel

A tela inicial (`#/`) lista os painéis já criados. Em **"+ Novo painel"** você:

1. Dá um nome ao painel (pode ser feito em qualquer ordem — antes ou depois
   de escolher o departamento).
2. Escolhe a loja (unidade) e o departamento (Açougue, Padaria, Hortifruti,
   etc. — vem direto da lista retornada por `/api/departamentos`).
3. Ao escolher loja + departamento, o sistema carrega o catálogo completo
   desse departamento e mostra uma lista com checkbox por produto (todos
   marcados por padrão). Você pode buscar por nome/marca e desmarcar os
   itens que não quer no painel, ou usar "Selecionar todos"/"Limpar seleção".
4. Ao salvar, o painel fica gravado em `data/paineis.json` e você é levado
   direto para a tela de exibição dele.

Um painel pode ser reaberto a qualquer momento em **"Editar"** (a seleção de
itens é recarregada do jeito que foi salva) ou removido em **"Excluir"**.

### Exibição

A tela de exibição de um painel (`#/painel/:id`) mostra **apenas os produtos
selecionados** na montagem do painel — não o catálogo inteiro do
departamento. Os produtos que estiverem em promoção no momento aparecem
**destacados em outra cor** (borda e fundo amarelo/dourado), com o preço
antigo riscado e o percentual de desconto, e aparecem primeiro na lista.

Isso é feito cruzando dois endpoints da API RP Services a cada consulta:

1. **Catálogo de produtos** —
   `/v3.2/produtounidade/listaprodutos/{lastID}/unidade/{CNPJ}/detalhado/departamento/{departamento}`
   — traz todos os produtos do departamento, com descrição, código de
   barras e preço atual (independente de estarem ou não em oferta).
2. **Ofertas ativas** — `/v1.0/produtounidade/ofertas` — traz só os produtos
   em promoção no momento, com preço anterior e preço atual.

O servidor busca os dois, casa os produtos pelo código e monta a lista final
já marcando `emOferta: true/false` em cada item, depois filtra para só os
itens escolhidos naquele painel. Como o endpoint de catálogo exige o
**CNPJ** da unidade (não o código curto de loja usado no endpoint de
ofertas), o servidor resolve isso automaticamente consultando `/v1.6/unidades`
e casando pelo código de loja selecionado — você não precisa configurar o
CNPJ manualmente.

### Arquivos principais

- `src/rpClient.js` — autentica na API (`/v1.1/auth`), guarda o token em
  memória e renova automaticamente antes de expirar; expõe funções para
  buscar departamentos, unidades, o catálogo de produtos, as ofertas ativas
  e as imagens de produto (todos com paginação/cache quando aplicável). A
  configuração de conexão (endereço/usuário/senha) é mutável em tempo real
  via `configurar()`, não mais fixa desde a inicialização do processo.
- `src/configStore.js` — persiste a configuração de conexão com a API
  (endereço, usuário, senha) em `data/config.json`, semeada a partir do
  `.env` na primeira vez que o servidor sobe.
- `src/paineisStore.js` — persiste os painéis criados (nome, departamento,
  unidade, itens selecionados, campos exibidos e aparência) em
  `data/paineis.json`.
- `src/server.js` — servidor HTTP que serve o painel (`public/`), cruza
  catálogo + ofertas ativas, controla a sessão de login, e expõe os
  endpoints internos:
  - `POST /api/login`, `POST /api/logout`, `GET /api/sessao` — autenticação
    (usuário/senha comparados com o que está configurado; sessão em cookie
    HttpOnly, sem expiração automática).
  - `GET/PUT /api/conexao`, `POST /api/conexao/testar` — configuração da
    conexão com a API (públicas, acessíveis a partir da tela de login).
  - `GET /api/config` — configuração pública (intervalo de atualização).
  - `GET /api/unidades`, `GET /api/departamentos` — protegidas (exigem login).
  - `GET /api/produtos?departamento=X&unidade=Y` — catálogo completo do
    departamento/loja (usado na tela de montagem do painel), protegida.
  - `GET/POST /api/paineis`, `GET/PUT/DELETE /api/paineis/:id` — CRUD de
    painéis, protegidas.
  - `PUT /api/paineis/:id/estilo` — só a aparência (fonte/cores); pública de
    propósito, pois fica acessível a partir da própria tela de exibição.
  - `GET /api/paineis/:id/produtos` — catálogo do painel já filtrado para os
    itens escolhidos, com ofertas destacadas e ordenadas primeiro; pública
    (é o que a TV consome).
  - `GET /api/produtos/:codigo/imagem?unidade=Y` — imagem do produto
    (descomprimida sob demanda, com cache); pública.
  - `GET /api/atualizacao`, `POST /api/atualizacao/aplicar` — consulta e
    aplica atualizações via GitHub Releases (ver seção 7); protegidas.
- `src/updater.js` — verifica a última release publicada no GitHub e, se
  houver uma versão mais nova, baixa e aplica (sem dependências: descompacta
  o `.tar.gz` da release na mão, com `zlib` + leitura manual do formato TAR).
- `src/discover.js` — script de linha de comando para explorar os
  departamentos/unidades cadastrados (ver seção 2).
- `public/` — front-end estático (HTML/CSS/JS puro, sem framework), com
  telas roteadas por hash: login (`#/`, quando deslogado), lista de painéis
  (`#/`), editor (`#/editor/novo` ou `#/editor/:id`) e exibição
  (`#/painel/:id`, pública).

## 6. Publicando em um servidor

Como o projeto não tem dependências, basta copiar a pasta para o servidor
(ou VM) e rodar `node src/server.js` com um gerenciador de processos como
`pm2` ou um serviço systemd, por trás de um proxy reverso (nginx, por
exemplo) se quiser expor por HTTPS/domínio próprio.

### Instalador para clientes Windows

Para distribuir para lojas/clientes que têm essa API instalada, tem um
instalador Windows pronto em [`installer/`](installer/LEIA-ME.md) — gera um
único `.exe` que copia os arquivos, instala o Node.js sozinho se faltar,
deixa o painel rodando sem precisar de CMD aberto (inicia no boot, reinicia
se cair) e libera a porta no Firewall. Só a máquina "servidor" da loja
precisa desse instalador; as outras só abrem o navegador e entram com
usuário/senha. Veja [`installer/LEIA-ME.md`](installer/LEIA-ME.md) para o
passo a passo completo.

⚠️ Esse instalador `.exe` (sem assinatura digital) pode ser classificado
como falso positivo pelo Windows Defender (`Trojan:Win32/Wacatac.B!ml`) por
causa do comportamento de baixar o Node.js e mexer em tarefa
agendada/firewall sozinho — comum para instaladores desse tipo sem
certificado de assinatura de código. Se isso acontecer, use a alternativa
abaixo.

### Alternativa: pacote portátil (sem instalador .exe)

Se o instalador acima for barrado por antivírus, tem uma alternativa em
[`installer/portatil/`](installer/portatil/LEIA-ME.md): um `.zip` com o
Node.js já incluso (não baixa nada da internet) e um `.bat` simples em vez
de um executável compilado — testado sem nenhuma detecção de antivírus.
Fica bem maior (~35MB) por carregar o Node.js dentro, mas é a opção mais
confiável até termos um certificado de assinatura de código.

## 7. Atualizações

O painel se atualiza sozinho a partir de [releases publicadas no GitHub]
(https://github.com/Cheski2017/painel-web-produtos/releases). Quem está
logado vê um botão **"Atualizações"** no topo — ele consulta a última
release, e se houver uma versão mais nova, mostra as notas e um botão
**"Atualizar agora"**. Ao clicar, o servidor baixa o código-fonte da
release, substitui `src/`, `public/` e `package.json` (nunca `.env` nem
`data/` — a configuração da API e os painéis salvos não são afetados) e
reinicia sozinho (sobe um processo novo e derruba o antigo).

### Publicando uma nova versão

1. Suba as mudanças normalmente (`git add`, `git commit`, `git push`).
2. Atualize `"version"` no `package.json` (ex: `1.0.1` → `1.0.2`).
3. Crie uma tag e uma release correspondentes:

   ```bash
   git tag -a v1.0.2 -m "Descrição da versão"
   git push origin v1.0.2
   gh release create v1.0.2 --title "v1.0.2" --notes "O que mudou nessa versão"
   ```

   (sem o `gh` instalado, dá pra criar a release direto pela interface do
   GitHub, em "Releases" → "Draft a new release")

A partir daí, qualquer instalação desatualizada vai ver o botão
"Atualizações" acender sozinho na próxima vez que alguém abrir o painel de
configuração e clicar para conferir.

### Detalhe técnico

Como o projeto não usa dependências, a extração do `.tar.gz` da release é
feita "na mão": `zlib` (nativo do Node) descomprime o gzip, e o formato TAR
por baixo é simples o suficiente (blocos de 512 bytes) para ler sem
biblioteca nenhuma — ver `lerEntradasTar` em `src/updater.js`. Testado de
ponta a ponta (baixar, extrair, reiniciar sozinho, e confirmar que
`data/config.json`/`data/paineis.json` não são tocados).

## 8. Limitações conhecidas / próximos passos

- A paginação (tanto do catálogo quanto das ofertas) assume que o cursor de
  próxima página corresponde ao código do último produto da página
  anterior — funcionou nos testes com um servidor simulado, mas vale
  confirmar esse comportamento assim que você tiver acesso real à API (o
  `npm run discover` já valida a conectividade e autenticação).
- O campo `caminhoImagem` só existe no endpoint de ofertas ativas (não no
  catálogo completo), então produtos fora de oferta aparecem sem imagem no
  painel — se isso for um problema, dá para trocar por outro endpoint de
  consulta de produto que retorne imagem para todos os itens.
- Produtos inativos/cancelados (`Ativo = false` no catálogo) são filtrados
  automaticamente e não aparecem no painel.
- Se sua empresa tiver muitos produtos por departamento, a primeira consulta
  de cada painel/loja pode demorar um pouco mais (busca o catálogo inteiro
  paginado) — por isso o resultado fica em cache por `CACHE_TTL_SECONDS`
  (padrão 5 minutos) antes de consultar a API de novo.
- Os painéis (nome, departamento, loja e itens escolhidos) ficam em
  `data/paineis.json`, um arquivo simples no servidor — não há login nem
  controle de quem pode criar/editar/excluir painéis; qualquer pessoa com
  acesso à tela consegue.
- A lista de itens de um painel é uma seleção fixa de códigos de produto. Se
  a loja cadastrar um produto novo no departamento depois que o painel foi
  criado, ele não aparece automaticamente — é preciso abrir o painel em
  "Editar" para incluí-lo.
- Depois de aplicar uma atualização, o servidor reinicia sozinho subindo um
  processo novo antes de derrubar o antigo — funciona certinho tanto rodando
  na mão quanto pela Tarefa Agendada do instalador Windows (testado). Uma
  consequência: como quem reinicia é o próprio processo (não a Tarefa
  Agendada), o "Verificar status" pode mostrar a tarefa como "não rodando"
  logo depois de uma atualização mesmo com o site no ar — nesse caso confie
  no resultado de "site respondendo", que é checado à parte.
- A sessão de login fica em memória; reiniciar o servidor (inclusive depois
  de aplicar uma atualização) desloga todo mundo. É rápido entrar de novo.
