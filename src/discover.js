"use strict";

/**
 * Script auxiliar: loga na API RP Services e lista departamentos e unidades
 * cadastrados, para você identificar os códigos de "Açougue" e "Padaria" e
 * das lojas (unidades) que devem ir no .env.
 *
 * Uso:
 *   npm run discover
 */

const { loadEnv } = require("./env");
loadEnv();
const rp = require("./rpClient");

function printTable(rows, columns) {
  if (!rows.length) {
    console.log("  (nenhum registro retornado)");
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? "").length))
  );
  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  |  ");

  console.log(line(columns.map((c) => c.label)));
  console.log(widths.map((w) => "-".repeat(w)).join("--+--"));
  for (const row of rows) {
    console.log(line(columns.map((c) => row[c.key] ?? "")));
  }
}

(async () => {
  try {
    console.log("Autenticando na API RP Services...");
    await rp.getToken();
    console.log("OK - token obtido com sucesso.\n");

    console.log("=== Departamentos cadastrados ===");
    console.log("(procure pelas linhas de Açougue / Padaria e anote o 'codigo')\n");
    const departamentos = await rp.getDepartamentos();
    printTable(departamentos, [
      { key: "codigo", label: "codigo" },
      { key: "descricao", label: "descricao" },
    ]);

    console.log("\n=== Unidades (lojas) cadastradas ===\n");
    const unidades = await rp.getUnidades();
    // os nomes dos campos podem variar entre versões (Codigo/codigo, Nome/nome)
    const normalizadas = unidades.map((u) => ({
      codigo: u.Codigo ?? u.codigo ?? u.codigoUnidade ?? "",
      nome: u.Nome ?? u.nome ?? u.nomeFantasia ?? u.razaoSocial ?? "",
    }));
    printTable(normalizadas, [
      { key: "codigo", label: "codigo" },
      { key: "nome", label: "nome" },
    ]);

    console.log("\nPróximo passo: edite o arquivo .env e preencha:");
    console.log("  RP_DEPTO_ACOUGUE=<codigo(s) do departamento de açougue>");
    console.log("  RP_DEPTO_PADARIA=<codigo(s) do departamento de padaria>");
    console.log("  RP_UNIDADES=<codigo(s) de unidade, opcional>");
    console.log("(múltiplos códigos podem ser separados por vírgula)");
  } catch (err) {
    console.error("\nErro ao consultar a API:", err.message);
    console.error(
      "Verifique RP_BASE_URL, RP_USUARIO e RP_SENHA no .env, e se o host/porta estão acessíveis a partir de onde este script está rodando."
    );
    process.exitCode = 1;
  }
})();
