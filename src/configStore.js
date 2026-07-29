"use strict";

/**
 * Armazena a configuração de conexão com a API RP Services (endereço,
 * usuário e senha) em disco, para que possa ser editada pela tela de
 * configuração do painel em vez de exigir editar o arquivo `.env` na mão.
 *
 * Na primeira vez que o servidor sobe, se ainda não existir
 * `data/config.json`, os valores são semeados a partir do `.env` (para quem
 * já tinha o projeto configurado do jeito antigo continuar funcionando sem
 * precisar reconfigurar nada).
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

function valoresPadraoDoEnv() {
  return {
    rpBaseUrl: (process.env.RP_BASE_URL || "").replace(/\/+$/, ""),
    rpUsuario: process.env.RP_USUARIO || "",
    rpSenha: process.env.RP_SENHA || "",
  };
}

function ensureConfigFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(valoresPadraoDoEnv(), null, 2), "utf8");
  }
}

function getConfig() {
  ensureConfigFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return {
      rpBaseUrl: typeof parsed.rpBaseUrl === "string" ? parsed.rpBaseUrl : "",
      rpUsuario: typeof parsed.rpUsuario === "string" ? parsed.rpUsuario : "",
      rpSenha: typeof parsed.rpSenha === "string" ? parsed.rpSenha : "",
    };
  } catch {
    return valoresPadraoDoEnv();
  }
}

function saveConfig({ rpBaseUrl, rpUsuario, rpSenha }) {
  if (!rpBaseUrl || !String(rpBaseUrl).trim()) throw new Error("Endereço da API é obrigatório");
  if (!rpUsuario || !String(rpUsuario).trim()) throw new Error("Usuário é obrigatório");
  if (!rpSenha || !String(rpSenha).trim()) throw new Error("Senha é obrigatória");

  const config = {
    rpBaseUrl: String(rpBaseUrl).trim().replace(/\/+$/, ""),
    rpUsuario: String(rpUsuario).trim(),
    rpSenha: String(rpSenha),
  };

  ensureConfigFile();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  return config;
}

module.exports = { getConfig, saveConfig };
