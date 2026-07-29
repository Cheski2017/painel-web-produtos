"use strict";

const zlib = require("zlib");
const configStore = require("./configStore");

/**
 * Cliente para a API "RP Services" (RP Info Sistemas).
 * Documentação: https://servicosflex.rpinfo.com.br:7443/v1.0/documentacao
 *
 * Endpoints usados:
 *  - POST /v1.1/auth                                    -> autenticação (usuario/senha -> token)
 *  - GET  /v1.0/produtounidade/ofertas                   -> ofertas ativas por unidade/departamento
 *  - GET  /v3.2/produtounidade/listaprodutos/.../detalhado/departamento/{departamento}
 *                                                         -> catálogo completo de produtos do departamento
 *                                                            (Descricao, CodigoBarras, Preco, flag Oferta, etc.)
 *  - GET  /v1.1/departamentos                            -> lista de departamentos cadastrados
 *  - GET  /v1.6/unidades                                 -> lista de unidades (lojas), inclui CNPJ
 *  - GET  /v1.0/produtounidade/{codigoProduto}/unidade/{CNPJ}/imagens
 *                                                         -> imagem(ns) cadastrada(s) do produto (vem
 *                                                            comprimida em gzip + base64, decodificada
 *                                                            em getImagemProdutoBuffer)
 *
 * Observação sobre autenticação: a partir da versão 3.0.0.01 da API o uso de
 * sessão/cookies foi descontinuado - o fluxo correto é obter um token em
 * /v1.1/auth e enviá-lo no header "token" em todas as demais chamadas.
 *
 * Usa o `fetch` global do Node.js (disponível a partir do Node 18), então
 * este projeto não depende de nenhum pacote externo (não é preciso rodar
 * `npm install`).
 */

// Algumas instalações on-premise da RP Info usam certificado autoassinado /
// emitido por uma CA interna da empresa. Se a validação de TLS falhar e você
// confiar na rede/host (ex: VPN interna da empresa), defina
// RP_TLS_REJECT_UNAUTHORIZED=false no .env. Isso desativa a verificação de
// certificado TLS PARA TODO O PROCESSO Node - use com cautela, e apenas se
// souber exatamente a quem está se conectando. (Fica só no .env porque é uma
// configuração de baixo nível do processo Node, não faz sentido expor na
// telinha de configuração da conexão.)
if (process.env.RP_TLS_REJECT_UNAUTHORIZED === "false") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.warn(
    "[rpClient] AVISO: verificação de certificado TLS desativada (RP_TLS_REJECT_UNAUTHORIZED=false). " +
      "Use apenas se confiar plenamente na rede/host da API."
  );
}

// ---- Configuração de conexão (endereço/usuário/senha) --------------------
// Editável em tempo real pela tela de configuração (ver `configurar` abaixo)
// - não são mais constantes fixas lidas uma vez do .env no início do processo.
let config = carregarConfigDeArmazenamento();

function carregarConfigDeArmazenamento() {
  const salvo = configStore.getConfig();
  return {
    baseUrl: (salvo.rpBaseUrl || "").replace(/\/+$/, ""),
    usuario: salvo.rpUsuario || "",
    senha: salvo.rpSenha || "",
  };
}

function avisarSeIncompleto() {
  if (!config.baseUrl || !config.usuario || !config.senha) {
    console.warn(
      "[rpClient] Atenção: endereço da API, usuário e/ou senha ainda não configurados."
    );
  }
}
avisarSeIncompleto();

/**
 * Atualiza a configuração de conexão em tempo real (chamado pela tela de
 * configuração) e persiste em disco via configStore. Descarta o token e o
 * cache de CNPJ das unidades em memória, já que podem valer para uma
 * instalação/empresa diferente agora.
 */
function configurar({ baseUrl, usuario, senha }) {
  const salvo = configStore.saveConfig({ rpBaseUrl: baseUrl, rpUsuario: usuario, rpSenha: senha });
  config = {
    baseUrl: salvo.rpBaseUrl,
    usuario: salvo.rpUsuario,
    senha: salvo.rpSenha,
  };
  tokenCache = { token: null, expiresAt: 0 };
  unidadesCnpjCache = null;
  avisarSeIncompleto();
  return { baseUrl: config.baseUrl, usuario: config.usuario };
}

/** Configuração atual, sem a senha (para exibir/preencher a tela de configuração). */
function obterConfigAtual() {
  return { baseUrl: config.baseUrl, usuario: config.usuario };
}

// ---- Cache de token em memória -------------------------------------------
let tokenCache = { token: null, expiresAt: 0 };

// margem de segurança para renovar o token um pouco antes de expirar de fato
const SAFETY_MARGIN_MS = 60 * 1000;

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

/**
 * Faz uma tentativa de login com credenciais arbitrárias (sem mexer na
 * configuração ativa nem no cache de token) - usado para "testar conexão" na
 * tela de configuração antes de salvar de vez.
 */
async function testarConexao({ baseUrl, usuario, senha }) {
  const url = (baseUrl || "").replace(/\/+$/, "");
  const res = await fetch(`${url}/v1.1/auth`, {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: JSON.stringify({ usuario, senha }),
  });

  const data = await safeJson(res);

  if (!res.ok || !data?.response?.token) {
    const msg =
      data?.response?.messages?.[0]?.message ||
      data?.response?.status ||
      `HTTP ${res.status}`;
    throw new Error(`Falha na autenticação: ${msg}`);
  }

  return true;
}

async function login() {
  const res = await fetch(`${config.baseUrl}/v1.1/auth`, {
    method: "POST",
    headers: { "Content-type": "application/json" },
    body: JSON.stringify({ usuario: config.usuario, senha: config.senha }),
  });

  const data = await safeJson(res);

  if (!res.ok || !data?.response?.token) {
    const msg =
      data?.response?.messages?.[0]?.message ||
      data?.response?.status ||
      `HTTP ${res.status}`;
    throw new Error(`Falha na autenticação RP Services: ${msg}`);
  }

  const { token, expiresIn } = data.response; // expiresIn em minutos
  const ttlMs = (Number(expiresIn) || 60) * 60 * 1000;

  tokenCache = {
    token,
    expiresAt: Date.now() + ttlMs - SAFETY_MARGIN_MS,
  };

  return tokenCache.token;
}

async function getToken(forceRefresh = false) {
  if (!forceRefresh && tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  return login();
}

/**
 * Faz uma requisição autenticada, renovando o token automaticamente uma vez
 * caso a API responda com erro de autenticação/token expirado.
 */
async function authedRequest(method, path, { query, body, retry = true } = {}) {
  const token = await getToken();
  const url = new URL(`${config.baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      "Content-type": "application/json",
      token,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await safeJson(res);

  const status = data?.response?.status ?? data?.status;
  const looksLikeAuthError =
    res.status === 401 ||
    res.status === 403 ||
    (status &&
      String(status).toLowerCase() !== "ok" &&
      /token|autentic/i.test(JSON.stringify(data?.response?.messages || data?.messages || "")));

  if (looksLikeAuthError && retry) {
    await getToken(true); // força renovação
    return authedRequest(method, path, { query, body, retry: false });
  }

  if (!res.ok) {
    throw new Error(`Erro RP Services (${res.status}) em ${path}: ${JSON.stringify(data)}`);
  }

  return data;
}

/** Lista departamentos cadastrados (código + descrição). */
async function getDepartamentos() {
  const data = await authedRequest("GET", "/v1.1/departamentos");
  return data?.response?.content || [];
}

/** Lista unidades (lojas) cadastradas. */
async function getUnidades() {
  const data = await authedRequest("GET", "/v1.6/unidades");
  return data?.response?.content || [];
}

// cache simples em memória do mapeamento código-da-unidade -> CNPJ, já que o
// endpoint de catálogo de produtos exige o CNPJ da unidade no path (não o
// código curto usado no endpoint de ofertas).
let unidadesCnpjCache = null;
async function resolveUnidadeCnpj(codigoUnidade) {
  if (!unidadesCnpjCache) {
    const unidades = await getUnidades();
    unidadesCnpjCache = new Map(
      unidades.map((u) => [String(u.Codigo ?? u.codigo ?? ""), u.CNPJ ?? u.cnpj ?? null])
    );
  }
  const cnpj = unidadesCnpjCache.get(String(codigoUnidade));
  if (!cnpj) {
    throw new Error(
      `Não encontrei o CNPJ da unidade '${codigoUnidade}' (necessário para consultar o catálogo de produtos). Confira o código em /api/unidades.`
    );
  }
  return cnpj;
}

/**
 * Busca todas as páginas de ofertas de um departamento/unidade, seguindo o
 * cursor "lastId" até a página retornar menos itens que o "limit" pedido.
 */
async function getOfertas({ unidade, departamento, setor, limit = 200, maxPages = 50 }) {
  if (!unidade) throw new Error("Parâmetro 'unidade' é obrigatório para consultar ofertas");

  let lastId = 0;
  let all = [];
  let appVersion = null;

  for (let page = 0; page < maxPages; page++) {
    const data = await authedRequest("GET", "/v1.0/produtounidade/ofertas", {
      query: { unidade, departamento, setor, lastId, limit },
    });

    const content = data?.content || data?.response?.content || [];
    appVersion = data?.appVersion || appVersion;
    all = all.concat(content);

    if (content.length < limit) break;

    const last = content[content.length - 1];
    const nextLastId = last?.codigoProduto;
    if (nextLastId === undefined || nextLastId === lastId) break;
    lastId = nextLastId;
  }

  return { appVersion, content: all };
}

/**
 * Busca o catálogo completo de produtos de um departamento/unidade (todos os
 * produtos, estejam ou não em oferta no momento), seguindo a paginação por
 * "lastID" (código do último produto da página anterior) até a API parar de
 * retornar produtos novos.
 *
 * Retorna os produtos "crus" como vêm da API (campos em PascalCase: Codigo,
 * Descricao, CodigoBarras, Preco, Marca, Oferta, etc.) - a normalização para
 * o formato usado no painel é feita em server.js.
 */
async function getProdutosPorDepartamento({ unidade, departamento, maxPages = 100 }) {
  if (!unidade) throw new Error("Parâmetro 'unidade' é obrigatório para consultar produtos");
  if (!departamento) throw new Error("Parâmetro 'departamento' é obrigatório para consultar produtos");

  const cnpj = await resolveUnidadeCnpj(unidade);

  let lastID = 0;
  let all = [];

  for (let page = 0; page < maxPages; page++) {
    const path = `/v3.2/produtounidade/listaprodutos/${lastID}/unidade/${encodeURIComponent(
      cnpj
    )}/detalhado/departamento/${encodeURIComponent(departamento)}`;

    const data = await authedRequest("GET", path);
    const produtos = data?.response?.produtos || [];

    if (produtos.length === 0) break;
    all = all.concat(produtos);

    const last = produtos[produtos.length - 1];
    const nextLastID = last?.Codigo ?? last?.SKU;
    if (nextLastID === undefined || nextLastID === lastID) break;
    lastID = nextLastID;
  }

  return all;
}

/**
 * Busca as imagens cadastradas de um produto numa unidade.
 * GET /v1.0/produtounidade/{codigoProduto}/unidade/{CNPJ}/imagens
 *
 * Retorna a lista de imagens "cruas" como vêm da API: cada item tem
 * `tipo` (ex: "BMP") e `imagem` (bytes da imagem comprimidos em gzip e
 * codificados em base64) - ver `getImagemProdutoBuffer` para a versão já
 * descomprimida/pronta para servir ao navegador.
 */
async function getImagensProduto({ codigoProduto, unidade }) {
  if (!codigoProduto) throw new Error("Parâmetro 'codigoProduto' é obrigatório para consultar imagens");
  if (!unidade) throw new Error("Parâmetro 'unidade' é obrigatório para consultar imagens");

  const cnpj = await resolveUnidadeCnpj(unidade);
  const path = `/v1.0/produtounidade/${encodeURIComponent(codigoProduto)}/unidade/${encodeURIComponent(cnpj)}/imagens`;
  const data = await authedRequest("GET", path);
  return data?.response?.Produto?.imagens || [];
}

const MIME_POR_TIPO = {
  bmp: "image/bmp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Busca a primeira imagem cadastrada de um produto, mantendo a compressão
 * gzip original em que a API já entrega os bytes (`{ comprimido, mime }`),
 * ou `null` se o produto não tiver imagem cadastrada.
 *
 * Propositalmente NÃO descomprime aqui: o servidor reenvia esses bytes gzip
 * direto para o navegador com `Content-Encoding: gzip` (o navegador
 * descomprime nativamente) - assim evitamos descomprimir e comprimir de
 * novo à toa, sem perder nenhuma qualidade da imagem (é compressão sem
 * perdas), e a resposta HTTP fica bem menor (BMP comprime muito).
 */
async function getImagemProdutoBuffer({ codigoProduto, unidade }) {
  const imagens = await getImagensProduto({ codigoProduto, unidade });
  if (!imagens.length) return null;

  const primeira = imagens[0];
  if (!primeira?.imagem) return null;

  const comprimido = Buffer.from(primeira.imagem, "base64");
  const tipo = String(primeira.tipo || "bmp").toLowerCase();
  const mime = MIME_POR_TIPO[tipo] || "application/octet-stream";

  return { comprimido, mime };
}

module.exports = {
  login,
  getToken,
  getDepartamentos,
  getUnidades,
  getOfertas,
  getProdutosPorDepartamento,
  getImagensProduto,
  getImagemProdutoBuffer,
  configurar,
  obterConfigAtual,
  testarConexao,
};
