"use strict";

/**
 * Carregador minimalista de arquivo .env (evita depender do pacote "dotenv"
 * via npm, já que este projeto não tem dependências externas).
 *
 * Lê o arquivo .env na raiz do projeto e define em process.env apenas as
 * variáveis que ainda não estiverem definidas (respeitando variáveis de
 * ambiente já exportadas pelo sistema/shell).
 */

const fs = require("fs");
const path = require("path");

function loadEnv(envPath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(envPath)) return;

  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    // remove aspas envolventes, se houver
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
