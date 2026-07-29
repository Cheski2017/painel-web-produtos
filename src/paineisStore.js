"use strict";

/**
 * Armazena os painéis criados pelo usuário (nome, departamento, unidade e a
 * lista de produtos escolhidos) em um arquivo JSON local, já que este
 * projeto não usa banco de dados nem dependências externas.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "paineis.json");

// Campos opcionais que o usuário pode escolher exibir ou não no painel.
// Nome do produto e preço são sempre exibidos (são o motivo de existir o painel).
const CAMPOS_DISPONIVEIS = ["imagem", "marca", "codigoInterno", "codigoBarras"];
const CAMPOS_PADRAO = [...CAMPOS_DISPONIVEIS];

function sanitizarCampos(campos) {
  if (!Array.isArray(campos)) return null;
  return campos.filter((c) => CAMPOS_DISPONIVEIS.includes(c));
}

// Aparência do painel (tamanho de fonte geral + cor dos itens que NÃO estão em
// oferta — o destaque amarelo/dourado das ofertas continua fixo).
const TAMANHOS_FONTE_VALIDOS = ["pequena", "media", "grande", "extra-grande"];
const ESTILO_PADRAO = { tamanhoFonte: "media", corFundo: null, corTexto: null };
const HEX_COR_REGEX = /^#[0-9a-fA-F]{6}$/;

function sanitizarEstilo(estilo) {
  if (!estilo || typeof estilo !== "object") return null;
  const corValida = (c) => (typeof c === "string" && HEX_COR_REGEX.test(c) ? c : null);
  return {
    tamanhoFonte: TAMANHOS_FONTE_VALIDOS.includes(estilo.tamanhoFonte) ? estilo.tamanhoFonte : ESTILO_PADRAO.tamanhoFonte,
    corFundo: corValida(estilo.corFundo),
    corTexto: corValida(estilo.corTexto),
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}

function readAll() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(paineis) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(paineis, null, 2), "utf8");
}

/** Lista resumida (sem a lista completa de itens) para a tela inicial. */
function listPaineis() {
  return readAll()
    .map(({ itensSelecionados, ...resto }) => ({
      ...resto,
      totalItens: Array.isArray(itensSelecionados) ? itensSelecionados.length : 0,
    }))
    .sort((a, b) => (b.atualizadoEm || "").localeCompare(a.atualizadoEm || ""));
}

/** Retorna o painel completo (incluindo itensSelecionados), usado na edição/exibição. */
function getPainel(id) {
  const painel = readAll().find((p) => p.id === id) || null;
  if (painel && !Array.isArray(painel.camposExibidos)) {
    // painéis criados antes deste recurso existir: assume todos os campos visíveis
    painel.camposExibidos = [...CAMPOS_PADRAO];
  }
  if (painel && !painel.estilo) {
    painel.estilo = { ...ESTILO_PADRAO };
  }
  return painel;
}

function createPainel({ nome, departamento, unidade, itensSelecionados, camposExibidos, estilo }) {
  if (!nome || !String(nome).trim()) throw new Error("Nome do painel é obrigatório");
  if (!departamento) throw new Error("Departamento é obrigatório");
  if (!unidade) throw new Error("Unidade (loja) é obrigatória");

  const paineis = readAll();
  const agora = new Date().toISOString();
  const painel = {
    id: crypto.randomUUID(),
    nome: String(nome).trim(),
    departamento: String(departamento),
    unidade: String(unidade),
    itensSelecionados: Array.isArray(itensSelecionados) ? itensSelecionados.map(String) : [],
    camposExibidos: sanitizarCampos(camposExibidos) ?? [...CAMPOS_PADRAO],
    estilo: sanitizarEstilo(estilo) ?? { ...ESTILO_PADRAO },
    criadoEm: agora,
    atualizadoEm: agora,
  };
  paineis.push(painel);
  writeAll(paineis);
  return painel;
}

function updatePainel(id, { nome, departamento, unidade, itensSelecionados, camposExibidos, estilo }) {
  const paineis = readAll();
  const idx = paineis.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Painel não encontrado");

  const atual = paineis[idx];
  const novoNome = nome !== undefined ? String(nome).trim() : atual.nome;
  if (!novoNome) throw new Error("Nome do painel é obrigatório");

  const atualizado = {
    ...atual,
    nome: novoNome,
    departamento: departamento !== undefined ? String(departamento) : atual.departamento,
    unidade: unidade !== undefined ? String(unidade) : atual.unidade,
    itensSelecionados: Array.isArray(itensSelecionados)
      ? itensSelecionados.map(String)
      : atual.itensSelecionados,
    camposExibidos: sanitizarCampos(camposExibidos) ?? atual.camposExibidos ?? [...CAMPOS_PADRAO],
    estilo: estilo !== undefined ? sanitizarEstilo(estilo) ?? { ...ESTILO_PADRAO } : atual.estilo ?? { ...ESTILO_PADRAO },
    atualizadoEm: new Date().toISOString(),
  };

  paineis[idx] = atualizado;
  writeAll(paineis);
  return atualizado;
}

/**
 * Atualiza só a aparência (fonte/cores) de um painel - usado pelo painel de
 * personalização que fica na própria tela de exibição (pública, sem login),
 * separado do `updatePainel` genérico (que exige estar logado) para não
 * misturar uma mudança cosmética com edição de conteúdo do painel.
 */
function updateEstilo(id, estilo) {
  const paineis = readAll();
  const idx = paineis.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Painel não encontrado");

  const atualizado = {
    ...paineis[idx],
    estilo: sanitizarEstilo(estilo) ?? { ...ESTILO_PADRAO },
    atualizadoEm: new Date().toISOString(),
  };

  paineis[idx] = atualizado;
  writeAll(paineis);
  return atualizado;
}

function deletePainel(id) {
  const paineis = readAll();
  const idx = paineis.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  paineis.splice(idx, 1);
  writeAll(paineis);
  return true;
}

module.exports = {
  listPaineis,
  getPainel,
  createPainel,
  updatePainel,
  updateEstilo,
  deletePainel,
  CAMPOS_DISPONIVEIS,
};
