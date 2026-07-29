"use strict";

/**
 * Atualização automática via GitHub Releases.
 *
 * Não usa nenhuma dependência externa (nem para baixar, nem para
 * descompactar): a API do GitHub entrega o código-fonte de cada release
 * como um .tar.gz, que é só gzip (Node já sabe descomprimir com `zlib`) por
 * cima de um TAR (formato simples de blocos de 512 bytes, dá pra ler na
 * mão sem biblioteca nenhuma) - ver `lerEntradasTar` abaixo.
 *
 * Só atualiza `src/`, `public/` e `package.json` - nunca mexe em `.env` nem
 * em `data/` (é lá que ficam a configuração da API e os painéis salvos).
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO_OWNER = "Cheski2017";
const REPO_NAME = "painel-web-produtos";

const APP_ROOT = path.join(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(APP_ROOT, "package.json");

function obterVersaoAtual() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  return pkg.version;
}

/** Compara duas versões "X.Y.Z": positivo se a > b, negativo se a < b, 0 se iguais. */
function compararVersoes(a, b) {
  const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diferenca = (pa[i] || 0) - (pb[i] || 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

async function buscarUltimaRelease() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    { headers: { "User-Agent": "painel-web-produtos-updater", Accept: "application/vnd.github+json" } }
  );

  if (res.status === 404) {
    throw new Error("Nenhuma versão publicada encontrada no GitHub ainda");
  }
  if (res.status === 403) {
    throw new Error("Limite de consultas ao GitHub atingido - tente de novo em alguns minutos");
  }
  if (!res.ok) {
    throw new Error(`Não consegui consultar o GitHub (HTTP ${res.status})`);
  }
  return res.json();
}

/** Consulta a última release publicada e compara com a versão instalada. */
async function verificarAtualizacao() {
  const versaoAtual = obterVersaoAtual();
  const release = await buscarUltimaRelease();
  const versaoDisponivel = String(release.tag_name || "").replace(/^v/, "");

  return {
    versaoAtual,
    versaoDisponivel,
    temAtualizacao: compararVersoes(versaoDisponivel, versaoAtual) > 0,
    notas: release.body || "",
    publicadoEm: release.published_at || null,
    tarballUrl: release.tarball_url,
  };
}

// ---- leitura de TAR (sem dependências) -------------------------------------

/**
 * Lê as entradas de um buffer TAR já descomprimido. TAR é uma sequência de
 * blocos de 512 bytes: um cabeçalho (nome, tamanho, tipo) seguido do
 * conteúdo do arquivo (também preenchido até múltiplo de 512), repetindo até
 * dois blocos vazios (fim do arquivo).
 */
function lerEntradasTar(bufferTar) {
  const entradas = [];
  let offset = 0;

  while (offset + 512 <= bufferTar.length) {
    const header = bufferTar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // bloco vazio = fim do arquivo

    const nome = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const tamanhoOctal = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const tamanho = parseInt(tamanhoOctal, 8) || 0;
    const typeflag = String.fromCharCode(header[156] || 0);

    // "g"/"x" são cabeçalhos de extensão PAX (metadados), não arquivos reais
    if (nome && typeflag !== "g" && typeflag !== "x") {
      const conteudo = bufferTar.subarray(offset + 512, offset + 512 + tamanho);
      entradas.push({ nome, tipo: typeflag, conteudo });
    }

    offset += 512 + Math.ceil(tamanho / 512) * 512;
  }

  return entradas;
}

// só estes arquivos/pastas são atualizados - nunca .env, data/, etc.
const PASTAS_ATUALIZAVEIS = ["src/", "public/"];
const ARQUIVOS_ATUALIZAVEIS = ["package.json"];

function ehAtualizavel(caminhoRelativo) {
  return (
    ARQUIVOS_ATUALIZAVEIS.includes(caminhoRelativo) ||
    PASTAS_ATUALIZAVEIS.some((pasta) => caminhoRelativo.startsWith(pasta))
  );
}

/**
 * Descompacta o .tar.gz de uma release do GitHub e grava por cima de
 * `src/`, `public/` e `package.json`. O GitHub sempre embrulha tudo numa
 * pasta raiz única (`dono-repo-sha/`) - o prefixo é descoberto a partir do
 * nome da primeira entrada, não fica hardcoded.
 */
function extrairAtualizacao(bufferTarGz, destino) {
  const bufferTar = zlib.gunzipSync(bufferTarGz);
  const entradas = lerEntradasTar(bufferTar);
  if (!entradas.length) throw new Error("Pacote de atualização vazio ou corrompido");

  const primeiraComPasta = entradas.find((e) => e.nome.includes("/"));
  if (!primeiraComPasta) throw new Error("Não reconheci o formato do pacote de atualização");
  const prefixo = primeiraComPasta.nome.slice(0, primeiraComPasta.nome.indexOf("/") + 1);

  let arquivosGravados = 0;
  for (const entrada of entradas) {
    if (!entrada.nome.startsWith(prefixo)) continue;
    const caminhoRelativo = entrada.nome.slice(prefixo.length);
    if (!caminhoRelativo || !ehAtualizavel(caminhoRelativo)) continue;

    const caminhoDestino = path.join(destino, caminhoRelativo);
    if (entrada.tipo === "5") {
      fs.mkdirSync(caminhoDestino, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(caminhoDestino), { recursive: true });
      fs.writeFileSync(caminhoDestino, entrada.conteudo);
      arquivosGravados++;
    }
  }

  if (arquivosGravados === 0) {
    throw new Error("Nenhum arquivo reconhecido dentro do pacote de atualização");
  }
  return arquivosGravados;
}

/** Baixa o .tar.gz da release e aplica por cima da instalação atual. */
async function baixarEAplicarAtualizacao(tarballUrl) {
  const res = await fetch(tarballUrl, {
    headers: { "User-Agent": "painel-web-produtos-updater" },
  });
  if (!res.ok) {
    throw new Error(`Falha ao baixar a atualização (HTTP ${res.status})`);
  }
  const bufferTarGz = Buffer.from(await res.arrayBuffer());
  const arquivosGravados = extrairAtualizacao(bufferTarGz, APP_ROOT);
  return { arquivosGravados };
}

module.exports = {
  obterVersaoAtual,
  compararVersoes,
  verificarAtualizacao,
  baixarEAplicarAtualizacao,
  extrairAtualizacao, // exposto à parte para dar pra testar contra uma pasta temporária
};
