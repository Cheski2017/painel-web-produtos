"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");

const { loadEnv } = require("./env");
loadEnv();

const rp = require("./rpClient");
const paineisStore = require("./paineisStore");
const configStore = require("./configStore");
const updater = require("./updater");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const UNIDADES_PADRAO = (process.env.RP_UNIDADES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const REFRESH_MINUTES = Number(process.env.REFRESH_INTERVAL_MINUTES) || 5;
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_SECONDS) || 300) * 1000;

// ---- cache simples em memória --------------------------------------------
const cache = new Map(); // key -> { at, data }

function getCached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  return null;
}
function setCached(key, data) {
  cache.set(key, { at: Date.now(), data });
}

// Imagens de produto mudam raramente e cada uma custa uma chamada própria à
// API da RP Info, então usamos um cache separado com TTL bem mais longo que
// o do catálogo/ofertas.
const IMAGEM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const imagemCache = new Map();

function getImagemCached(key) {
  const hit = imagemCache.get(key);
  if (hit && Date.now() - hit.at < IMAGEM_CACHE_TTL_MS) return hit.data;
  return null;
}
function setImagemCached(key, data) {
  imagemCache.set(key, { at: Date.now(), data });
}

// ---- sessão de login ----------------------------------------------------
// Protege só a área de criar/editar painéis e a configuração da conexão com
// a API - a tela de exibição do painel (o que fica ligado na TV) continua
// pública, já que uma TV não tem como digitar senha toda vez que liga.
// Sessão fica em memória (sem "lembrar de mim" persistido em disco): dura
// até o usuário sair manualmente ou o servidor reiniciar.
const SESSION_COOKIE = "painelSessao";
const sessoes = new Map(); // token -> { criadoEm }

function criarSessao() {
  const token = crypto.randomBytes(32).toString("hex");
  sessoes.set(token, { criadoEm: Date.now() });
  return token;
}

function destruirSessao(token) {
  if (token) sessoes.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const parte of header.split(";")) {
    const idx = parte.indexOf("=");
    if (idx === -1) continue;
    const chave = parte.slice(0, idx).trim();
    const valor = parte.slice(idx + 1).trim();
    if (chave) cookies[chave] = decodeURIComponent(valor);
  }
  return cookies;
}

function tokenDaRequisicao(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

function estaAutenticado(req) {
  const token = tokenDaRequisicao(req);
  return !!(token && sessoes.has(token));
}

/** Se não houver sessão válida, já responde 401 e devolve `false`. */
function exigirAutenticacao(req, res) {
  if (estaAutenticado(req)) return true;
  sendJson(res, 401, { error: "Não autenticado" });
  return false;
}

// ---- helpers http -----------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB, suficiente para a lista de itens selecionados

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error("Corpo da requisição excede o tamanho máximo permitido"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("JSON inválido no corpo da requisição"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));

  // proteção básica contra path traversal
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Não encontrado");
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

// ---- rotas da API -----------------------------------------------------------

async function handleConfig(req, res) {
  sendJson(res, 200, {
    refreshIntervalMinutes: REFRESH_MINUTES,
    unidadesPadrao: UNIDADES_PADRAO,
    versao: updater.obterVersaoAtual(),
  });
}

// ---- login / configuração da conexão com a API -----------------------------
// Ficam de propósito sem exigir sessão: a configuração da conexão é acessada
// direto da tela de login (é como se define o usuário/senha usados pra
// logar), e login obviamente precisa ser público. Isso significa que
// qualquer um que alcançar o servidor consegue reconfigurar a conexão -
// mesma exposição que já existia antes (o app inteiro era 100% aberto);
// o login agora pelo menos protege a criação/edição de painéis.

async function handleLogin(req, res) {
  try {
    const body = await readJsonBody(req);
    const config = configStore.getConfig();

    if (!config.rpUsuario || !config.rpSenha) {
      return sendJson(res, 409, {
        error: "A conexão com a API ainda não foi configurada. Use o ícone de configuração nesta tela.",
      });
    }

    const usuario = String(body.usuario ?? "");
    const senha = String(body.senha ?? "");
    if (usuario !== config.rpUsuario || senha !== config.rpSenha) {
      return sendJson(res, 401, { error: "Usuário ou senha incorretos" });
    }

    const token = criarSessao();
    const umAno = 60 * 60 * 24 * 365;
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${umAno}`
    );
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleLogout(req, res) {
  destruirSessao(tokenDaRequisicao(req));
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  sendJson(res, 200, { ok: true });
}

async function handleSessao(req, res) {
  sendJson(res, 200, { autenticado: estaAutenticado(req) });
}

/** GET /api/conexao — configuração atual da API (sem a senha). */
async function handleObterConexao(req, res) {
  sendJson(res, 200, rp.obterConfigAtual());
}

/** PUT /api/conexao — salva endereço/usuário/senha da API. */
async function handleSalvarConexao(req, res) {
  try {
    const body = await readJsonBody(req);
    const resultado = rp.configurar({ baseUrl: body.baseUrl, usuario: body.usuario, senha: body.senha });
    // a conexão mudou - descarta qualquer coisa em cache da configuração anterior
    cache.clear();
    imagemCache.clear();
    sendJson(res, 200, resultado);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

/** POST /api/conexao/testar — tenta logar na API com as credenciais informadas, sem salvar. */
async function handleTestarConexao(req, res) {
  try {
    const body = await readJsonBody(req);
    await rp.testarConexao({ baseUrl: body.baseUrl, usuario: body.usuario, senha: body.senha });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

// ---- atualização (via GitHub Releases) --------------------------------------
// Protegidas por login (só quem administra o painel deve poder disparar isso).

/** GET /api/atualizacao — consulta a última versão publicada no GitHub. */
async function handleVerificarAtualizacao(req, res) {
  try {
    const info = await updater.verificarAtualizacao();
    sendJson(res, 200, info);
  } catch (err) {
    sendJson(res, 502, { error: err.message });
  }
}

/**
 * POST /api/atualizacao/aplicar — baixa e aplica a última versão, depois
 * reinicia o processo sozinho (sobe um processo novo e derruba este).
 */
async function handleAplicarAtualizacao(req, res) {
  try {
    const info = await updater.verificarAtualizacao();
    if (!info.temAtualizacao) {
      return sendJson(res, 200, { ok: true, jaAtualizado: true, versaoAtual: info.versaoAtual });
    }

    const resultado = await updater.baixarEAplicarAtualizacao(info.tarballUrl);
    sendJson(res, 200, {
      ok: true,
      versaoInstalada: info.versaoDisponivel,
      arquivosAtualizados: resultado.arquivosGravados,
    });

    // dá tempo da resposta acima chegar no navegador antes de reiniciar
    setTimeout(() => {
      console.log(`[server] Atualização para v${info.versaoDisponivel} aplicada - reiniciando...`);
      server.close(() => {
        const processoNovo = spawn(process.execPath, [__filename], {
          cwd: __dirname,
          detached: true,
          stdio: "ignore",
        });
        processoNovo.unref();
        process.exit(0);
      });
    }, 500);
  } catch (err) {
    console.error("Falha ao aplicar atualização:", err);
    sendJson(res, 502, { error: err.message });
  }
}

async function handleDepartamentos(req, res) {
  try {
    const cacheKey = "departamentos";
    const cached = getCached(cacheKey);
    if (cached) return sendJson(res, 200, cached);

    const departamentos = await rp.getDepartamentos();
    setCached(cacheKey, departamentos);
    sendJson(res, 200, departamentos);
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
}

async function handleUnidades(req, res) {
  try {
    const cacheKey = "unidades";
    const cached = getCached(cacheKey);
    if (cached) return sendJson(res, 200, cached);

    const unidades = await rp.getUnidades();
    setCached(cacheKey, unidades);
    sendJson(res, 200, unidades);
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
}

/**
 * Combina o catálogo completo de produtos de um departamento/unidade com as
 * ofertas ativas do mesmo departamento/unidade, marcando cada item com
 * `emOferta: true/false`, preço anterior e percentual de desconto.
 */
async function buscarProdutosComOfertas({ unidade, departamento }) {
  const [produtos, ofertas] = await Promise.all([
    rp.getProdutosPorDepartamento({ unidade, departamento }),
    rp.getOfertas({ unidade, departamento }).catch((err) => {
      // se o endpoint de ofertas falhar por algum motivo, ainda mostramos o
      // catálogo completo (sem destaque de promoção) em vez de quebrar tudo
      console.error("Falha ao buscar ofertas ativas, seguindo só com o catálogo:", err.message);
      return { content: [] };
    }),
  ]);

  const ofertasPorCodigo = new Map(
    (ofertas.content || []).map((o) => [String(o.codigoProduto), o])
  );

  return produtos.map((p) => {
    const codigo = p.Codigo ?? p.SKU;
    const oferta = ofertasPorCodigo.get(String(codigo));

    const precoAtualCatalogo = Number(p.Preco ?? p.PrecoPDV) || 0;
    const flagOferta = String(p.Oferta ?? "").toUpperCase() === "S";

    let emOferta = false;
    let precoAnterior = null;
    let precoAtual = precoAtualCatalogo;
    let desconto = 0;

    if (oferta) {
      // fonte mais confiável: o próprio endpoint de ofertas ativas
      precoAnterior = Number(oferta.precoAnterior) || null;
      precoAtual = Number(oferta.precoAtual) || precoAtualCatalogo;
      emOferta = true;
    } else if (flagOferta && p.PrecoLista && Number(p.PrecoLista) > precoAtualCatalogo) {
      // fallback: catálogo sinaliza "Oferta = S" mas o produto não veio na
      // lista de ofertas ativas (pouco provável, mas cobre esse caso)
      precoAnterior = Number(p.PrecoLista);
      emOferta = true;
    } else if (flagOferta) {
      // sinalizado como oferta, mas sem preço anterior para comparar
      emOferta = true;
    }

    if (emOferta && precoAnterior && precoAnterior > precoAtual) {
      desconto = Math.round(((precoAnterior - precoAtual) / precoAnterior) * 100);
    }

    return {
      codigoProduto: codigo,
      nomeProduto: p.Descricao || "Produto sem nome",
      marca: p.Marca || "",
      codigoBarras: p.CodigoBarras || "",
      precoAtual,
      precoAnterior,
      emOferta,
      desconto,
      caminhoImagem: oferta?.caminhoImagem || null,
      ativo: String(p.Ativo ?? "true").toLowerCase() !== "false",
    };
  });
}

function ordenarProdutos(content) {
  return content
    .filter((item) => item.ativo)
    .filter(
      (item, idx, arr) => arr.findIndex((i) => i.codigoProduto === item.codigoProduto) === idx
    )
    // ofertas primeiro, depois o resto em ordem alfabética
    .sort((a, b) => {
      if (a.emOferta !== b.emOferta) return a.emOferta ? -1 : 1;
      return a.nomeProduto.localeCompare(b.nomeProduto, "pt-BR");
    });
}

/** GET /api/produtos?departamento=X&unidade=Y — catálogo completo, usado na tela de edição de painéis. */
async function handleProdutos(req, res, query) {
  const departamento = query.get("departamento");
  const unidade = query.get("unidade");

  if (!departamento) return sendJson(res, 400, { error: "Parâmetro 'departamento' é obrigatório" });
  if (!unidade) return sendJson(res, 400, { error: "Parâmetro 'unidade' é obrigatório" });

  const cacheKey = `produtos:${departamento}:${unidade}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, cached);

  try {
    const produtos = await buscarProdutosComOfertas({ unidade, departamento });
    // a tela de montagem do painel só faz sentido para produtos com preço
    // cadastrado (itens com preço zerado normalmente são cadastros
    // incompletos/insumos internos, não produtos de venda ao público)
    const content = ordenarProdutos(produtos.filter((p) => Number(p.precoAtual) > 0));
    setCached(cacheKey, content);
    sendJson(res, 200, content);
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
}

/**
 * Busca a imagem de um produto (com cache); nunca lança erro - em caso de
 * falha ou produto sem imagem, cacheia e devolve `{ semImagem: true }`, para
 * não ficar tentando de novo a cada card renderizado.
 */
async function buscarImagemComCache(codigo, unidade) {
  const cacheKey = `imagem:${unidade}:${codigo}`;
  const cacheado = getImagemCached(cacheKey);
  if (cacheado) return cacheado;

  let resultado;
  try {
    const imagem = await rp.getImagemProdutoBuffer({ codigoProduto: codigo, unidade });
    resultado = imagem || { semImagem: true };
  } catch (err) {
    console.error(`Falha ao buscar imagem do produto ${codigo}:`, err.message);
    resultado = { semImagem: true };
  }
  setImagemCached(cacheKey, resultado);
  return resultado;
}

const PREFETCH_IMAGENS_CONCORRENCIA = 4;

/**
 * Dispara em segundo plano (sem bloquear a resposta atual) a busca das
 * imagens de uma lista de produtos, para que já estejam no cache quando o
 * navegador pedir cada uma individualmente (a tela de exibição pede uma
 * imagem por produto visível).
 */
function prefetchImagensEmSegundoPlano(itens, unidade) {
  let indice = 0;
  async function proximo() {
    const i = indice++;
    if (i >= itens.length) return;
    await buscarImagemComCache(itens[i].codigoProduto, unidade);
    return proximo();
  }
  const trabalhadores = Array.from({ length: PREFETCH_IMAGENS_CONCORRENCIA }, proximo);
  Promise.all(trabalhadores).catch((err) => console.error("Falha no pré-carregamento de imagens:", err.message));
}

/** GET /api/produtos/:codigo/imagem?unidade=Y — imagem cadastrada do produto (ou 404 se não houver). */
async function handleImagemProduto(req, res, codigo, query) {
  const unidade = query.get("unidade");
  if (!unidade) return sendJson(res, 400, { error: "Parâmetro 'unidade' é obrigatório" });

  const resultado = await buscarImagemComCache(codigo, unidade);
  if (resultado.semImagem) {
    return sendJson(res, 404, { error: "Produto sem imagem cadastrada" });
  }

  // a API já entrega a imagem comprimida em gzip - se o navegador aceita
  // gzip (praticamente sempre), reenviamos os mesmos bytes comprimidos sem
  // descomprimir/comprimir de novo à toa (mais rápido, sem perder qualidade:
  // é compressão sem perdas, o navegador descomprime nativamente).
  const aceitaGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");

  if (aceitaGzip) {
    res.writeHead(200, {
      "Content-Type": resultado.mime,
      "Content-Encoding": "gzip",
      "Content-Length": resultado.comprimido.length,
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(resultado.comprimido);
  }

  const bytes = zlib.gunzipSync(resultado.comprimido);
  res.writeHead(200, {
    "Content-Type": resultado.mime,
    "Content-Length": bytes.length,
    "Cache-Control": "public, max-age=86400",
  });
  res.end(bytes);
}

// ---- rotas de painéis (CRUD) ------------------------------------------------

async function handleListarPaineis(req, res) {
  try {
    sendJson(res, 200, paineisStore.listPaineis());
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
}

async function handleObterPainel(req, res, id) {
  const painel = paineisStore.getPainel(id);
  if (!painel) return sendJson(res, 404, { error: "Painel não encontrado" });
  sendJson(res, 200, painel);
}

async function handleCriarPainel(req, res) {
  try {
    const body = await readJsonBody(req);
    const painel = paineisStore.createPainel(body);
    sendJson(res, 201, painel);
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleAtualizarPainel(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const painel = paineisStore.updatePainel(id, body);
    sendJson(res, 200, painel);
  } catch (err) {
    const status = /não encontrado/i.test(err.message) ? 404 : 400;
    sendJson(res, status, { error: err.message });
  }
}

/**
 * PUT /api/paineis/:id/estilo — só a aparência (fonte/cores). Fica pública
 * (sem exigir login) de propósito: quem está vendo o painel na TV pode
 * ajustar a aparência sem precisar logar, só não pode mexer no conteúdo.
 */
async function handleAtualizarEstiloPainel(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const painel = paineisStore.updateEstilo(id, body.estilo);
    sendJson(res, 200, { estilo: painel.estilo });
  } catch (err) {
    const status = /não encontrado/i.test(err.message) ? 404 : 400;
    sendJson(res, status, { error: err.message });
  }
}

/**
 * PUT /api/paineis/:id/layout — cards x lista, colunas, linhas por tela,
 * intervalo de troca de tela. Pública pelo mesmo motivo do estilo: os
 * controles ficam na própria tela de exibição, e precisam ficar salvos por
 * painel (não no localStorage do navegador) para valer em qualquer
 * TV/dispositivo que abrir esse painel, não só em quem configurou.
 */
async function handleAtualizarLayoutPainel(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const painel = paineisStore.updateLayout(id, body.layout);
    sendJson(res, 200, { layout: painel.layout });
  } catch (err) {
    const status = /não encontrado/i.test(err.message) ? 404 : 400;
    sendJson(res, status, { error: err.message });
  }
}

async function handleExcluirPainel(req, res, id) {
  const ok = paineisStore.deletePainel(id);
  if (!ok) return sendJson(res, 404, { error: "Painel não encontrado" });
  sendJson(res, 200, { ok: true });
}

/** GET /api/paineis/:id/produtos — catálogo já filtrado para os itens escolhidos no painel. */
async function handlePainelProdutos(req, res, id) {
  const painel = paineisStore.getPainel(id);
  if (!painel) return sendJson(res, 404, { error: "Painel não encontrado" });

  const cacheKey = `painel-produtos:${id}:${painel.atualizadoEm}`;
  const cached = getCached(cacheKey);
  if (cached) return sendJson(res, 200, cached);

  try {
    const produtos = await buscarProdutosComOfertas({
      unidade: painel.unidade,
      departamento: painel.departamento,
    });

    const selecionados = new Set(painel.itensSelecionados || []);
    const content = ordenarProdutos(
      produtos.filter((p) => selecionados.has(String(p.codigoProduto)))
    );

    const payload = {
      painel: {
        id: painel.id,
        nome: painel.nome,
        departamento: painel.departamento,
        unidade: painel.unidade,
        camposExibidos: painel.camposExibidos,
        estilo: painel.estilo,
        layout: painel.layout,
      },
      total: content.length,
      totalEmOferta: content.filter((i) => i.emOferta).length,
      content,
    };
    setCached(cacheKey, payload);
    sendJson(res, 200, payload);

    // dispara em segundo plano, depois de já ter respondido: quando o
    // navegador for pedindo a imagem de cada card, boa parte já vai estar
    // pronta no cache em vez de esperar a API da RP Info de novo
    if ((painel.camposExibidos || []).includes("imagem")) {
      prefetchImagensEmSegundoPlano(content, painel.unidade);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    // ---- públicas: login, configuração da conexão, exibição do painel na TV ----
    if (pathname === "/api/login" && req.method === "POST") return handleLogin(req, res);
    if (pathname === "/api/logout" && req.method === "POST") return handleLogout(req, res);
    if (pathname === "/api/sessao") return handleSessao(req, res);

    if (pathname === "/api/conexao") {
      if (req.method === "GET") return handleObterConexao(req, res);
      if (req.method === "PUT") return handleSalvarConexao(req, res);
      return sendJson(res, 405, { error: "Método não permitido" });
    }
    if (pathname === "/api/conexao/testar" && req.method === "POST") return handleTestarConexao(req, res);

    if (pathname === "/api/config") return handleConfig(req, res);

    const painelProdutosMatch = pathname.match(/^\/api\/paineis\/([^/]+)\/produtos$/);
    if (painelProdutosMatch) return handlePainelProdutos(req, res, painelProdutosMatch[1]);

    const painelEstiloMatch = pathname.match(/^\/api\/paineis\/([^/]+)\/estilo$/);
    if (painelEstiloMatch && req.method === "PUT") return handleAtualizarEstiloPainel(req, res, painelEstiloMatch[1]);

    const painelLayoutMatch = pathname.match(/^\/api\/paineis\/([^/]+)\/layout$/);
    if (painelLayoutMatch && req.method === "PUT") return handleAtualizarLayoutPainel(req, res, painelLayoutMatch[1]);

    const imagemProdutoMatch = pathname.match(/^\/api\/produtos\/([^/]+)\/imagem$/);
    if (imagemProdutoMatch) return handleImagemProduto(req, res, imagemProdutoMatch[1], url.searchParams);

    // ---- protegidas: exigem login (área de criar/editar painéis) ----
    if (pathname === "/api/departamentos") {
      if (!exigirAutenticacao(req, res)) return;
      return handleDepartamentos(req, res);
    }
    if (pathname === "/api/unidades") {
      if (!exigirAutenticacao(req, res)) return;
      return handleUnidades(req, res);
    }
    if (pathname === "/api/produtos") {
      if (!exigirAutenticacao(req, res)) return;
      return handleProdutos(req, res, url.searchParams);
    }
    if (pathname === "/api/atualizacao") {
      if (!exigirAutenticacao(req, res)) return;
      return handleVerificarAtualizacao(req, res);
    }
    if (pathname === "/api/atualizacao/aplicar" && req.method === "POST") {
      if (!exigirAutenticacao(req, res)) return;
      return handleAplicarAtualizacao(req, res);
    }

    const painelIdMatch = pathname.match(/^\/api\/paineis\/([^/]+)$/);
    if (painelIdMatch) {
      if (!exigirAutenticacao(req, res)) return;
      const id = painelIdMatch[1];
      if (req.method === "GET") return handleObterPainel(req, res, id);
      if (req.method === "PUT") return handleAtualizarPainel(req, res, id);
      if (req.method === "DELETE") return handleExcluirPainel(req, res, id);
      return sendJson(res, 405, { error: "Método não permitido" });
    }

    if (pathname === "/api/paineis") {
      if (!exigirAutenticacao(req, res)) return;
      if (req.method === "GET") return handleListarPaineis(req, res);
      if (req.method === "POST") return handleCriarPainel(req, res);
      return sendJson(res, 405, { error: "Método não permitido" });
    }

    if (pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "Rota não encontrada" });
    }

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error("Erro inesperado:", err);
    sendJson(res, 500, { error: "Erro interno" });
  }
});

server.listen(PORT, () => {
  console.log(`Painel de ofertas rodando em http://localhost:${PORT}`);
});
