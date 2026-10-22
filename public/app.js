(() => {
  "use strict";

  // Campos opcionais que o usuário pode escolher exibir ou não no painel.
  // Nome do produto e preço são sempre exibidos (é o motivo do painel existir).
  const CAMPOS_DISPONIVEIS = [
    { chave: "imagem", label: "Imagem do produto" },
    { chave: "marca", label: "Marca" },
    { chave: "codigoInterno", label: "Código interno" },
    { chave: "codigoBarras", label: "Código de barras" },
  ];

  const LINHAS_PADRAO = 6;
  const INTERVALO_TELA_PADRAO_SEGUNDOS = 20;

  // Layout de exibição (cards x lista, colunas, linhas por tela, intervalo de
  // troca de tela) - salvo por painel no servidor (não no localStorage do
  // navegador), porque a tela que exibe o painel (a TV) costuma ser um
  // dispositivo diferente de quem configurou.
  const LAYOUT_PADRAO = { modo: "cards", colunas: 2, linhas: LINHAS_PADRAO, intervaloTela: INTERVALO_TELA_PADRAO_SEGUNDOS };

  // Aparência do painel: tamanho de fonte geral + cor dos itens que NÃO
  // estão em oferta (o destaque de oferta continua fixo em amarelo/dourado).
  const ESCALA_FONTE = { pequena: 0.85, media: 1, grande: 1.2, "extra-grande": 1.45 };
  const ESTILO_PADRAO = { tamanhoFonte: "media", corFundo: null, corTexto: null };

  const state = {
    departamentos: [],
    unidades: [],
    editor: {
      id: null,
      unidade: "",
      departamento: "",
      produtos: [],
      selecionados: new Set(),
      camposSelecionados: new Set(CAMPOS_DISPONIVEIS.map((c) => c.chave)),
    },
    displayRefreshTimer: null,
    displayItens: [],
    displayPage: 0,
    displayPaginacaoTimer: null,
    resizeTimer: null,
    displayPainelId: null,
    displayUnidade: "",
    displayCampos: new Set(CAMPOS_DISPONIVEIS.map((c) => c.chave)),
    displayEstilo: { ...ESTILO_PADRAO },
    displayPrefs: { ...LAYOUT_PADRAO },
    autenticado: false,
  };

  const views = {
    login: document.getElementById("view-login"),
    lista: document.getElementById("view-lista"),
    editor: document.getElementById("view-editor"),
    display: document.getElementById("view-display"),
  };

  function showView(name) {
    for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function formatMoney(v) {
    const n = Number(v) || 0;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
    return data;
  }

  async function ensureDepartamentosUnidades() {
    const tarefas = [];
    if (!state.departamentos.length) {
      tarefas.push(fetchJson("/api/departamentos").then((d) => (state.departamentos = d)));
    }
    if (!state.unidades.length) {
      tarefas.push(fetchJson("/api/unidades").then((u) => (state.unidades = u)));
    }
    await Promise.all(tarefas);
  }

  function codigoDe(obj, ...chaves) {
    for (const c of chaves) if (obj[c] !== undefined && obj[c] !== null && obj[c] !== "") return obj[c];
    return "";
  }

  function nomeDepartamento(codigo) {
    const d = state.departamentos.find((x) => String(codigoDe(x, "codigo", "Codigo")) === String(codigo));
    return d ? codigoDe(d, "descricao", "Descricao") || codigo : codigo;
  }

  function nomeUnidade(codigo) {
    const u = state.unidades.find((x) => String(codigoDe(x, "Codigo", "codigo")) === String(codigo));
    return u ? codigoDe(u, "Nome", "nome", "nomeFantasia", "razaoSocial") || codigo : codigo;
  }

  function populateSelect(selectEl, items, getValue, getLabel, placeholder) {
    selectEl.innerHTML = "";
    if (placeholder) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = placeholder;
      selectEl.appendChild(opt);
    }
    for (const item of items) {
      const value = getValue(item);
      if (value === undefined || value === null || value === "") continue;
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = `${value} — ${getLabel(item) || ""}`;
      selectEl.appendChild(opt);
    }
  }

  // ==================== TEMA CLARO/ESCURO ====================

  const THEME_STORAGE_KEY = "painelOfertas:tema";

  function temaEfetivoAtual() {
    const salvo = localStorage.getItem(THEME_STORAGE_KEY);
    if (salvo === "light" || salvo === "dark") return salvo;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function aplicarTema(tema) {
    document.documentElement.setAttribute("data-theme", tema);
    const btn = document.getElementById("themeToggleBtn");
    btn.textContent = tema === "dark" ? "☀️" : "🌙";
    btn.title = tema === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro";
  }

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const novoTema = temaEfetivoAtual() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_STORAGE_KEY, novoTema);
    aplicarTema(novoTema);
  });

  aplicarTema(temaEfetivoAtual());

  // ==================== LAYOUT DE EXIBIÇÃO (cards/lista) ====================

  let salvarLayoutTimer = null;
  function salvarLayoutAtual() {
    if (!state.displayPainelId) return;
    clearTimeout(salvarLayoutTimer);
    salvarLayoutTimer = setTimeout(async () => {
      try {
        await fetchJson(`/api/paineis/${state.displayPainelId}/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: state.displayPrefs }),
        });
      } catch (err) {
        console.error("Falha ao salvar layout do painel:", err.message);
      }
    }, 400);
  }

  function aplicarControlesExibicao() {
    const modo = state.displayPrefs.modo;
    document.getElementById("modoCardsBtn").classList.toggle("is-active", modo === "cards");
    document.getElementById("modoListaBtn").classList.toggle("is-active", modo === "lista");
    document.getElementById("modoDestaqueBtn").classList.toggle("is-active", modo === "destaque");
    document.getElementById("colunasField").hidden = modo !== "lista";
    // no modo destaque cada tela tem um único produto, então "linhas" não se aplica
    document.getElementById("linhasField").hidden = modo === "destaque";
    views.display.classList.toggle("modo-destaque", modo === "destaque");
    document.getElementById("colunasSelect").value = String(state.displayPrefs.colunas);
    document.getElementById("linhasInput").value = String(state.displayPrefs.linhas);
    document.getElementById("intervaloTelaInput").value = String(state.displayPrefs.intervaloTela);
  }

  for (const btn of document.querySelectorAll(".view-toggle__btn[data-modo]")) {
    btn.addEventListener("click", () => {
      state.displayPrefs.modo = btn.dataset.modo;
      state.displayPage = 0;
      salvarLayoutAtual();
      aplicarControlesExibicao();
      atualizarPaginaAtual();
    });
  }

  document.getElementById("colunasSelect").addEventListener("change", (e) => {
    state.displayPrefs.colunas = Number(e.target.value) || 1;
    state.displayPage = 0;
    salvarLayoutAtual();
    atualizarPaginaAtual();
  });

  document.getElementById("linhasInput").addEventListener("change", (e) => {
    const valor = Math.min(20, Math.max(1, Number(e.target.value) || LINHAS_PADRAO));
    state.displayPrefs.linhas = valor;
    e.target.value = String(valor);
    state.displayPage = 0;
    salvarLayoutAtual();
    atualizarPaginaAtual();
  });

  document.getElementById("intervaloTelaInput").addEventListener("change", (e) => {
    const valor = Math.min(600, Math.max(5, Number(e.target.value) || INTERVALO_TELA_PADRAO_SEGUNDOS));
    state.displayPrefs.intervaloTela = valor;
    e.target.value = String(valor);
    salvarLayoutAtual();
    iniciarRotacaoTelas();
  });

  window.addEventListener("resize", () => {
    if (views.display.hidden) return;
    clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(() => atualizarPaginaAtual(), 200);
  });

  // ==================== TELA CHEIA ====================

  const viewDisplayEl = document.getElementById("view-display");

  function atualizarIconeFullscreen() {
    const emTelaCheia = document.fullscreenElement === viewDisplayEl;
    const btn = document.getElementById("fullscreenBtn");
    btn.textContent = emTelaCheia ? "🗗" : "⛶";
    btn.title = emTelaCheia ? "Sair da tela cheia" : "Exibir em tela cheia";
    viewDisplayEl.classList.toggle("is-fullscreen", emTelaCheia);
    if (!views.display.hidden) atualizarPaginaAtual();
  }

  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewDisplayEl.requestFullscreen().catch((err) => {
        alert("Não foi possível entrar em tela cheia: " + err.message);
      });
    }
  });

  document.addEventListener("fullscreenchange", atualizarIconeFullscreen);

  // ==================== APARÊNCIA PERSONALIZADA (fonte/cor) ====================

  function corPadraoTema(variavelCss) {
    return getComputedStyle(document.documentElement).getPropertyValue(variavelCss).trim() || "#ffffff";
  }

  function aplicarEstiloPersonalizado() {
    const grid = document.getElementById("grid");
    const escala = ESCALA_FONTE[state.displayEstilo.tamanhoFonte] || 1;
    grid.style.setProperty("--card-escala-fonte", escala);

    if (state.displayEstilo.corFundo) grid.style.setProperty("--card-fundo-custom", state.displayEstilo.corFundo);
    else grid.style.removeProperty("--card-fundo-custom");

    if (state.displayEstilo.corTexto) grid.style.setProperty("--card-texto-custom", state.displayEstilo.corTexto);
    else grid.style.removeProperty("--card-texto-custom");
  }

  function atualizarControlesEstilo() {
    document.getElementById("estiloTamanhoFonte").value = state.displayEstilo.tamanhoFonte;
    document.getElementById("estiloCorFundo").value = state.displayEstilo.corFundo || corPadraoTema("--surface-1");
    document.getElementById("estiloCorTexto").value = state.displayEstilo.corTexto || corPadraoTema("--text-primary");
  }

  let salvarEstiloTimer = null;
  function salvarEstiloAtual() {
    if (!state.displayPainelId) return;
    clearTimeout(salvarEstiloTimer);
    salvarEstiloTimer = setTimeout(async () => {
      try {
        await fetchJson(`/api/paineis/${state.displayPainelId}/estilo`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estilo: state.displayEstilo }),
        });
      } catch (err) {
        console.error("Falha ao salvar aparência do painel:", err.message);
      }
    }, 400);
  }

  document.getElementById("estiloToggleBtn").addEventListener("click", () => {
    const painel = document.getElementById("estiloPainel");
    painel.hidden = !painel.hidden;
  });

  document.getElementById("estiloTamanhoFonte").addEventListener("change", (e) => {
    state.displayEstilo.tamanhoFonte = e.target.value;
    aplicarEstiloPersonalizado();
    salvarEstiloAtual();
  });

  document.getElementById("estiloCorFundo").addEventListener("input", (e) => {
    state.displayEstilo.corFundo = e.target.value;
    aplicarEstiloPersonalizado();
    salvarEstiloAtual();
  });

  document.getElementById("estiloCorTexto").addEventListener("input", (e) => {
    state.displayEstilo.corTexto = e.target.value;
    aplicarEstiloPersonalizado();
    salvarEstiloAtual();
  });

  document.getElementById("estiloRestaurarBtn").addEventListener("click", () => {
    state.displayEstilo = { ...ESTILO_PADRAO };
    aplicarEstiloPersonalizado();
    atualizarControlesEstilo();
    salvarEstiloAtual();
  });

  // ==================== ROTEAMENTO ====================

  function stopDisplayAutoRefresh() {
    if (state.displayRefreshTimer) {
      clearInterval(state.displayRefreshTimer);
      state.displayRefreshTimer = null;
    }
  }

  function pararRotacaoTelas() {
    if (state.displayPaginacaoTimer) {
      clearInterval(state.displayPaginacaoTimer);
      state.displayPaginacaoTimer = null;
    }
  }

  function iniciarRotacaoTelas() {
    pararRotacaoTelas();
    const segundos = Math.max(5, state.displayPrefs.intervaloTela || INTERVALO_TELA_PADRAO_SEGUNDOS);
    state.displayPaginacaoTimer = setInterval(() => {
      state.displayPage += 1;
      atualizarPaginaAtual();
    }, segundos * 1000);
  }

  async function verificarSessao() {
    try {
      const data = await fetchJson("/api/sessao");
      state.autenticado = !!data.autenticado;
    } catch {
      state.autenticado = false;
    }
    document.getElementById("logoutBtn").hidden = !state.autenticado;
    document.getElementById("navMeusPaineis").hidden = !state.autenticado;
    document.getElementById("navNovoPainel").hidden = !state.autenticado;
    document.getElementById("atualizacaoBtn").hidden = !state.autenticado;
    if (!state.autenticado) document.getElementById("atualizacaoPainel").hidden = true;
    return state.autenticado;
  }

  async function router() {
    const hash = location.hash || "#/";
    stopDisplayAutoRefresh();
    pararRotacaoTelas();
    if (document.fullscreenElement) document.exitFullscreen();

    const editorNovoMatch = hash.match(/^#\/editor\/novo$/);
    const editorIdMatch = hash.match(/^#\/editor\/([^/]+)$/);
    const painelMatch = hash.match(/^#\/painel\/([^/]+)$/);

    try {
      // exibição do painel (TV) é pública - não exige login
      if (painelMatch) {
        return await renderDisplay(painelMatch[1]);
      }

      // todo o resto (lista, editor) é área protegida
      const autenticado = await verificarSessao();
      if (!autenticado) {
        return renderLogin();
      }

      if (editorNovoMatch) {
        await renderEditor(null);
      } else if (editorIdMatch) {
        await renderEditor(editorIdMatch[1]);
      } else {
        await renderLista();
      }
    } catch (err) {
      console.error(err);
    }
  }
  window.addEventListener("hashchange", router);

  // ==================== LOGIN ====================

  function renderLogin(mensagem) {
    showView("login");
    document.getElementById("loginSenha").value = "";
    document.getElementById("loginErro").textContent = mensagem || "";
    document.getElementById("loginConfigPainel").hidden = true;
  }

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const usuario = document.getElementById("loginUsuario").value.trim();
    const senha = document.getElementById("loginSenha").value;
    const erroEl = document.getElementById("loginErro");
    const btn = document.getElementById("loginSubmitBtn");

    erroEl.textContent = "";
    btn.disabled = true;
    try {
      await fetchJson("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      state.autenticado = true;
      if (location.hash === "#/") await router();
      else location.hash = "#/";
    } catch (err) {
      erroEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
      await fetchJson("/api/logout", { method: "POST" });
    } catch {
      /* mesmo que falhe, segue e limpa o estado local */
    }
    state.autenticado = false;
    if (location.hash === "#/") await router();
    else location.hash = "#/";
  });

  document.getElementById("loginConfigToggleBtn").addEventListener("click", async () => {
    const painel = document.getElementById("loginConfigPainel");
    const abrindo = painel.hidden;
    painel.hidden = !painel.hidden;
    if (!abrindo) return;

    document.getElementById("configStatus").textContent = "";
    document.getElementById("configStatus").className = "status-line";
    try {
      const atual = await fetchJson("/api/conexao");
      document.getElementById("configBaseUrl").value = atual.baseUrl || "";
      document.getElementById("configUsuario").value = atual.usuario || "";
      document.getElementById("configSenha").value = "";
    } catch (err) {
      console.error("Erro ao carregar configuração da conexão:", err.message);
    }
  });

  function dadosFormularioConexao() {
    return {
      baseUrl: document.getElementById("configBaseUrl").value.trim(),
      usuario: document.getElementById("configUsuario").value.trim(),
      senha: document.getElementById("configSenha").value,
    };
  }

  document.getElementById("configTestarBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("configStatus");
    statusEl.className = "status-line";
    statusEl.textContent = "Testando conexão…";
    try {
      await fetchJson("/api/conexao/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dadosFormularioConexao()),
      });
      statusEl.textContent = "Conexão OK!";
      statusEl.className = "status-line status-line--ok";
    } catch (err) {
      statusEl.textContent = "Falha na conexão: " + err.message;
      statusEl.className = "status-line status-line--erro";
    }
  });

  document.getElementById("configForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("configStatus");
    const dados = dadosFormularioConexao();
    statusEl.className = "status-line";
    statusEl.textContent = "Salvando…";
    try {
      await fetchJson("/api/conexao", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      statusEl.textContent = "Configuração salva! Use esse usuário e senha para entrar.";
      statusEl.className = "status-line status-line--ok";
      document.getElementById("loginUsuario").value = dados.usuario;
    } catch (err) {
      statusEl.textContent = "Erro ao salvar: " + err.message;
      statusEl.className = "status-line status-line--erro";
    }
  });

  // ==================== ATUALIZAÇÃO (via GitHub) ====================

  document.getElementById("atualizacaoBtn").addEventListener("click", async () => {
    const painel = document.getElementById("atualizacaoPainel");
    const abrindo = painel.hidden;
    painel.hidden = !painel.hidden;
    if (abrindo) await verificarAtualizacaoDisponivel();
  });

  document.getElementById("atualizacaoFecharBtn").addEventListener("click", () => {
    document.getElementById("atualizacaoPainel").hidden = true;
  });

  async function verificarAtualizacaoDisponivel() {
    const statusEl = document.getElementById("atualizacaoStatus");
    const detalhesEl = document.getElementById("atualizacaoDetalhes");
    detalhesEl.hidden = true;
    statusEl.className = "status-line";
    statusEl.textContent = "Verificando…";

    try {
      const info = await fetchJson("/api/atualizacao");
      if (!info.temAtualizacao) {
        statusEl.textContent = `Você já está na versão mais recente (v${info.versaoAtual}).`;
        statusEl.className = "status-line status-line--ok";
        return;
      }
      statusEl.textContent = "Nova versão disponível!";
      document.getElementById("atualizacaoVersaoAtual").textContent = "v" + info.versaoAtual;
      document.getElementById("atualizacaoVersaoDisponivel").textContent = "v" + info.versaoDisponivel;
      document.getElementById("atualizacaoNotas").textContent = info.notas || "(sem notas de versão)";
      detalhesEl.hidden = false;
    } catch (err) {
      statusEl.textContent = "Erro ao verificar atualização: " + err.message;
      statusEl.className = "status-line status-line--erro";
    }
  }

  document.getElementById("atualizacaoAplicarBtn").addEventListener("click", async () => {
    const statusEl = document.getElementById("atualizacaoStatus");
    const btn = document.getElementById("atualizacaoAplicarBtn");
    btn.disabled = true;
    statusEl.className = "status-line";
    statusEl.textContent = "Baixando e aplicando a atualização…";

    try {
      await fetchJson("/api/atualizacao/aplicar", { method: "POST" });
      statusEl.textContent = "Atualização aplicada! Reiniciando o servidor…";
      statusEl.className = "status-line status-line--ok";
      document.getElementById("atualizacaoDetalhes").hidden = true;
      aguardarServidorVoltar();
    } catch (err) {
      statusEl.textContent = "Erro ao atualizar: " + err.message;
      statusEl.className = "status-line status-line--erro";
      btn.disabled = false;
    }
  });

  function aguardarServidorVoltar() {
    const statusEl = document.getElementById("atualizacaoStatus");
    let tentativas = 0;
    const intervalo = setInterval(async () => {
      tentativas++;
      try {
        const res = await fetch("/api/sessao");
        if (res.ok) {
          clearInterval(intervalo);
          statusEl.textContent = "Pronto! Recarregando…";
          setTimeout(() => location.reload(), 800);
          return;
        }
      } catch {
        /* servidor ainda reiniciando, tenta de novo */
      }
      if (tentativas >= 30) {
        clearInterval(intervalo);
        statusEl.textContent = "O servidor está demorando para voltar. Recarregue a página manualmente.";
        statusEl.className = "status-line status-line--erro";
      }
    }, 2000);
  }

  // ==================== LISTA DE PAINÉIS ====================

  async function renderLista() {
    showView("lista");
    const statusEl = document.getElementById("listaStatus");
    const listaEl = document.getElementById("listaPaineis");
    const emptyEl = document.getElementById("listaEmpty");

    statusEl.textContent = "Carregando painéis…";
    try {
      await ensureDepartamentosUnidades();
      const paineis = await fetchJson("/api/paineis");

      statusEl.textContent = paineis.length ? `${paineis.length} painel(is) salvos.` : "";
      emptyEl.hidden = paineis.length > 0;
      listaEl.innerHTML = "";

      const frag = document.createDocumentFragment();
      for (const p of paineis) {
        const card = document.createElement("article");
        card.className = "painel-card";
        card.innerHTML = `
          <h3 class="painel-card__nome">${escapeHtml(p.nome)}</h3>
          <p class="painel-card__meta">${escapeHtml(nomeDepartamento(p.departamento))} · ${escapeHtml(nomeUnidade(p.unidade))}</p>
          <p class="painel-card__meta">${p.totalItens} item(ns) selecionado(s)</p>
          <div class="painel-card__acoes">
            <a class="btn" href="#/painel/${p.id}">Exibir</a>
            <a class="btn btn--ghost" href="#/editor/${p.id}">Editar</a>
            <button type="button" class="btn btn--danger" data-excluir="${p.id}">Excluir</button>
          </div>
        `;
        frag.appendChild(card);
      }
      listaEl.appendChild(frag);

      listaEl.querySelectorAll("[data-excluir]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const painel = paineis.find((x) => x.id === btn.dataset.excluir);
          if (!confirm(`Excluir o painel "${painel?.nome || ""}"? Essa ação não pode ser desfeita.`)) return;
          try {
            await fetchJson(`/api/paineis/${btn.dataset.excluir}`, { method: "DELETE" });
            renderLista();
          } catch (err) {
            alert("Erro ao excluir: " + err.message);
          }
        });
      });
    } catch (err) {
      statusEl.textContent = "Erro ao carregar painéis: " + err.message;
    }
  }

  // ==================== EDITOR ====================

  async function renderEditor(id) {
    showView("editor");
    await ensureDepartamentosUnidades();

    state.editor = {
      id,
      unidade: "",
      departamento: "",
      produtos: [],
      selecionados: new Set(),
      camposSelecionados: new Set(CAMPOS_DISPONIVEIS.map((c) => c.chave)),
    };

    document.getElementById("editorTitulo").textContent = id ? "Editar painel" : "Novo painel";
    document.getElementById("editorNome").value = "";
    document.getElementById("editorPicker").hidden = true;
    document.getElementById("editorCampos").hidden = true;
    document.getElementById("editorSalvar").disabled = true;
    document.getElementById("pickerLista").innerHTML = "";
    document.getElementById("pickerStatus").textContent = "";
    document.getElementById("pickerSearch").value = "";

    populateSelect(
      document.getElementById("editorUnidade"),
      state.unidades,
      (u) => codigoDe(u, "Codigo", "codigo"),
      (u) => codigoDe(u, "Nome", "nome", "nomeFantasia", "razaoSocial")
    );
    populateSelect(
      document.getElementById("editorDepartamento"),
      state.departamentos,
      (d) => codigoDe(d, "codigo", "Codigo"),
      (d) => codigoDe(d, "descricao", "Descricao"),
      "Selecione…"
    );

    if (id) {
      const painel = await fetchJson(`/api/paineis/${id}`);
      document.getElementById("editorNome").value = painel.nome;
      state.editor.unidade = painel.unidade;
      state.editor.departamento = painel.departamento;
      state.editor.selecionados = new Set((painel.itensSelecionados || []).map(String));
      state.editor.camposSelecionados = new Set(
        Array.isArray(painel.camposExibidos) ? painel.camposExibidos : CAMPOS_DISPONIVEIS.map((c) => c.chave)
      );
    } else if (document.getElementById("editorUnidade").options.length) {
      state.editor.unidade = document.getElementById("editorUnidade").options[0].value;
    }

    document.getElementById("editorUnidade").value = state.editor.unidade;
    document.getElementById("editorDepartamento").value = state.editor.departamento;
    renderCamposExibidos();

    if (state.editor.departamento && state.editor.unidade) {
      document.getElementById("editorCampos").hidden = false;
      await carregarProdutosEditor({ preservarSelecao: true });
    }
  }

  function renderCamposExibidos() {
    const listaEl = document.getElementById("camposExibidosLista");
    listaEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const campo of CAMPOS_DISPONIVEIS) {
      const label = document.createElement("label");
      label.className = "campos-exibidos__opcao";
      label.innerHTML = `
        <input type="checkbox" data-campo="${campo.chave}" ${state.editor.camposSelecionados.has(campo.chave) ? "checked" : ""} />
        <span>${escapeHtml(campo.label)}</span>
      `;
      frag.appendChild(label);
    }
    listaEl.appendChild(frag);

    listaEl.querySelectorAll("input[type=checkbox]").forEach((chk) => {
      chk.addEventListener("change", () => {
        if (chk.checked) state.editor.camposSelecionados.add(chk.dataset.campo);
        else state.editor.camposSelecionados.delete(chk.dataset.campo);
      });
    });
  }

  async function carregarProdutosEditor({ preservarSelecao = false } = {}) {
    const pickerEl = document.getElementById("editorPicker");
    const statusEl = document.getElementById("pickerStatus");
    const salvarBtn = document.getElementById("editorSalvar");

    pickerEl.hidden = false;
    statusEl.textContent = "Carregando produtos do departamento…";
    document.getElementById("pickerLista").innerHTML = "";
    salvarBtn.disabled = true;

    try {
      const produtos = await fetchJson(
        `/api/produtos?departamento=${encodeURIComponent(state.editor.departamento)}&unidade=${encodeURIComponent(state.editor.unidade)}`
      );
      state.editor.produtos = produtos;
      if (!preservarSelecao) {
        // departamento/loja novos (ou painel novo): seleciona todos os produtos por padrão
        state.editor.selecionados = new Set(produtos.map((p) => String(p.codigoProduto)));
      }
      statusEl.textContent = `${produtos.length} produto(s) encontrados no departamento.`;
      renderPickerLista();
      salvarBtn.disabled = false;
    } catch (err) {
      statusEl.textContent = "Erro ao carregar produtos: " + err.message;
    }
  }

  function renderPickerLista() {
    const q = document.getElementById("pickerSearch").value.trim().toLowerCase();
    const listaEl = document.getElementById("pickerLista");

    const produtosFiltrados = !q
      ? state.editor.produtos
      : state.editor.produtos.filter((p) => `${p.nomeProduto || ""} ${p.marca || ""}`.toLowerCase().includes(q));

    listaEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const p of produtosFiltrados) {
      const codigo = String(p.codigoProduto);
      const row = document.createElement("label");
      row.className = "item-picker__row" + (p.emOferta ? " item-picker__row--oferta" : "");
      row.innerHTML = `
        <input type="checkbox" data-codigo="${escapeHtml(codigo)}" ${state.editor.selecionados.has(codigo) ? "checked" : ""} />
        <span class="item-picker__nome">${escapeHtml(p.nomeProduto || "")}</span>
        <span class="item-picker__marca">${escapeHtml(p.marca || "")}</span>
        <span class="item-picker__preco">${formatMoney(p.precoAtual)}</span>
        ${p.emOferta ? `<span class="item-picker__badge">OFERTA</span>` : ""}
      `;
      frag.appendChild(row);
    }
    listaEl.appendChild(frag);

    listaEl.querySelectorAll("input[type=checkbox]").forEach((chk) => {
      chk.addEventListener("change", () => {
        if (chk.checked) state.editor.selecionados.add(chk.dataset.codigo);
        else state.editor.selecionados.delete(chk.dataset.codigo);
        atualizarContagem();
      });
    });

    atualizarContagem();
  }

  function atualizarContagem() {
    document.getElementById("pickerContagem").textContent =
      `${state.editor.selecionados.size} de ${state.editor.produtos.length} selecionado(s)`;
  }

  document.getElementById("editorUnidade").addEventListener("change", async (e) => {
    state.editor.unidade = e.target.value;
    if (state.editor.departamento) await carregarProdutosEditor();
  });

  document.getElementById("editorDepartamento").addEventListener("change", async (e) => {
    state.editor.departamento = e.target.value;
    if (state.editor.departamento && state.editor.unidade) {
      document.getElementById("editorCampos").hidden = false;
      await carregarProdutosEditor();
    } else {
      document.getElementById("editorPicker").hidden = true;
      document.getElementById("editorCampos").hidden = true;
      document.getElementById("editorSalvar").disabled = true;
    }
  });

  document.getElementById("pickerSearch").addEventListener("input", renderPickerLista);

  document.getElementById("pickerSelecionarTodos").addEventListener("click", () => {
    state.editor.selecionados = new Set(state.editor.produtos.map((p) => String(p.codigoProduto)));
    renderPickerLista();
  });

  document.getElementById("pickerLimparTodos").addEventListener("click", () => {
    state.editor.selecionados = new Set();
    renderPickerLista();
  });

  document.getElementById("editorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = document.getElementById("editorNome").value.trim();
    if (!nome) return alert("Informe o nome do painel.");
    if (!state.editor.departamento) return alert("Selecione o departamento.");
    if (!state.editor.unidade) return alert("Selecione a loja.");

    const payload = {
      nome,
      departamento: state.editor.departamento,
      unidade: state.editor.unidade,
      itensSelecionados: Array.from(state.editor.selecionados),
      camposExibidos: Array.from(state.editor.camposSelecionados),
    };

    const salvarBtn = document.getElementById("editorSalvar");
    salvarBtn.disabled = true;
    try {
      const painel = state.editor.id
        ? await fetchJson(`/api/paineis/${state.editor.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchJson("/api/paineis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      location.hash = `#/painel/${painel.id}`;
    } catch (err) {
      alert("Erro ao salvar painel: " + err.message);
      salvarBtn.disabled = false;
    }
  });

  // ==================== EXIBIÇÃO DO PAINEL ====================

  /** Lê quantas colunas o grid realmente está renderizando no momento (depende
   *  da largura da tela — no modo cards os cartões se ajustam automaticamente). */
  function calcularColunasAtuais(grid) {
    const valor = getComputedStyle(grid).gridTemplateColumns;
    const colunas = valor.split(" ").filter(Boolean).length;
    return Math.max(1, colunas);
  }

  /**
   * TVs não têm como rolar a tela, então em vez de uma lista contínua o
   * painel divide os produtos em "telas" (páginas) de N linhas × colunas
   * visíveis, e troca automaticamente de tela a cada X segundos.
   */
  function atualizarPaginaAtual() {
    if (state.displayPrefs.modo === "destaque") return atualizarDestaqueAtual();

    const grid = document.getElementById("grid");
    const modoLista = state.displayPrefs.modo === "lista";
    grid.className = modoLista ? "grid grid--lista" : "grid";
    grid.style.setProperty("--lista-colunas", state.displayPrefs.colunas);

    const colunas = calcularColunasAtuais(grid);
    const linhas = Math.max(1, state.displayPrefs.linhas);
    const tamanhoPagina = colunas * linhas;
    const totalPaginas = Math.max(1, Math.ceil(state.displayItens.length / tamanhoPagina));
    if (state.displayPage >= totalPaginas || state.displayPage < 0) state.displayPage = 0;

    const inicio = state.displayPage * tamanhoPagina;
    const pagina = state.displayItens.slice(inicio, inicio + tamanhoPagina);
    renderCards(pagina);

    const statusEl = document.getElementById("displayStatus");
    const emOferta = state.displayItens.filter((i) => i.emOferta).length;
    const base = `${state.displayItens.length} produto(s) — ${emOferta} em oferta.`;
    statusEl.textContent = totalPaginas > 1 ? `${base} Tela ${state.displayPage + 1} de ${totalPaginas}.` : base;
  }

  /** Pinta apenas a página atual (subconjunto) de produtos no grid. */
  function renderCards(items) {
    const grid = document.getElementById("grid");
    const emptyEl = document.getElementById("emptyState");
    const modoLista = state.displayPrefs.modo === "lista";

    grid.innerHTML = "";
    emptyEl.hidden = state.displayItens.length > 0;

    const frag = document.createDocumentFragment();
    for (const item of items) {
      const card = document.createElement("article");
      card.className = [
        "card",
        item.emOferta ? "card--oferta" : "",
        modoLista ? "card--lista" : "",
      ].filter(Boolean).join(" ");

      const hasDesconto = item.emOferta && item.desconto > 0;
      const hasPrecoAnterior = item.emOferta && item.precoAnterior;
      const mostrar = state.displayCampos;

      const codigoPartes = [];
      if (mostrar.has("codigoInterno")) codigoPartes.push(`Cód. ${escapeHtml(String(item.codigoProduto ?? ""))}`);
      if (mostrar.has("codigoBarras") && item.codigoBarras) codigoPartes.push(escapeHtml(item.codigoBarras));

      const urlImagem = `/api/produtos/${encodeURIComponent(item.codigoProduto)}/imagem?unidade=${encodeURIComponent(state.displayUnidade)}`;

      card.innerHTML = `
        ${item.emOferta ? `<span class="card__badge">${hasDesconto ? `OFERTA -${item.desconto}%` : "OFERTA"}</span>` : ""}
        ${
          !mostrar.has("imagem")
            ? ""
            : `<img class="card__image" src="${urlImagem}" alt="${escapeHtml(item.nomeProduto || "")}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card__image card__image--placeholder',textContent:'🖼️'}))" />`
        }
        ${mostrar.has("marca") ? `<span class="card__marca">${escapeHtml(item.marca || "")}</span>` : ""}
        <span class="card__nome">${escapeHtml(item.nomeProduto || "Produto sem nome")}</span>
        <div class="card__precos">
          ${hasPrecoAnterior ? `<span class="card__preco-anterior">${formatMoney(item.precoAnterior)}</span>` : ""}
          <span class="card__preco-atual">${formatMoney(item.precoAtual)}</span>
        </div>
        ${codigoPartes.length ? `<span class="card__codigo">${codigoPartes.join(" · ")}</span>` : ""}
      `;
      frag.appendChild(card);
    }
    grid.appendChild(frag);
  }

  // ---- modo destaque: um produto por tela, no estilo de TV de açougue ----

  /** No destaque só entram as ofertas; se o painel não tiver nenhuma, mostra
   *  todos os produtos para a TV não ficar vazia. */
  function itensDestaque() {
    const ofertas = state.displayItens.filter((i) => i.emOferta);
    return ofertas.length ? ofertas : state.displayItens;
  }

  function urlImagemProduto(item) {
    return `/api/produtos/${encodeURIComponent(item.codigoProduto)}/imagem?unidade=${encodeURIComponent(state.displayUnidade)}`;
  }

  function atualizarDestaqueAtual() {
    const grid = document.getElementById("grid");
    const emptyEl = document.getElementById("emptyState");
    grid.className = "grid grid--destaque";
    grid.innerHTML = "";

    const itens = itensDestaque();
    emptyEl.hidden = itens.length > 0;
    if (state.displayPage >= itens.length || state.displayPage < 0) state.displayPage = 0;

    // fontes proporcionais à "tela" (1u = 1% da largura útil em 16:9), para
    // o slide ficar igual em qualquer TV/resolução
    const unidade = Math.min(grid.clientWidth, (grid.clientHeight * 16) / 9) / 100;
    grid.style.setProperty("--u", `${unidade}px`);
    grid.style.setProperty("--card-escala-fonte", ESCALA_FONTE[state.displayEstilo.tamanhoFonte] || 1);

    const item = itens[state.displayPage];
    if (item) grid.appendChild(montarSlideDestaque(item));

    // já baixa a imagem do próximo para a troca de tela não "piscar"
    const proximo = itens[(state.displayPage + 1) % itens.length];
    if (proximo && proximo !== item && state.displayCampos.has("imagem")) new Image().src = urlImagemProduto(proximo);

    const emOferta = state.displayItens.filter((i) => i.emOferta).length;
    const base = `${state.displayItens.length} produto(s) — ${emOferta} em oferta.`;
    document.getElementById("displayStatus").textContent =
      itens.length > 1 ? `${base} Destaque ${state.displayPage + 1} de ${itens.length}.` : base;
  }

  function montarSlideDestaque(item) {
    const mostrar = state.displayCampos;
    const [inteiro, centavos] = (Number(item.precoAtual) || 0).toFixed(2).split(".");
    const hasPrecoAnterior = item.emOferta && item.precoAnterior > item.precoAtual;
    const selo = item.emOferta ? "Baixou<br>o preço" : "Confira";

    const slide = document.createElement("article");
    slide.className = "destaque" + (mostrar.has("imagem") ? "" : " sem-imagem");
    slide.innerHTML = `
      ${item.emOferta ? `<div class="destaque__faixa">OFERTA</div>` : ""}
      <div class="destaque__midia">
        ${
          mostrar.has("imagem")
            ? `<img class="destaque__imagem" src="${urlImagemProduto(item)}" alt="" onerror="this.closest('.destaque').classList.add('sem-imagem')" />`
            : ""
        }
        <div class="destaque__selo">${selo}</div>
      </div>
      <span class="destaque__ilustrativa">Imagem ilustrativa</span>
      <div class="destaque__info">
        ${mostrar.has("marca") && item.marca ? `<span class="destaque__marca">${escapeHtml(item.marca)}</span>` : ""}
        <h3 class="destaque__nome">${escapeHtml(item.nomeProduto || "Produto sem nome")}</h3>
        ${hasPrecoAnterior ? `<span class="destaque__de">De <s>${formatMoney(item.precoAnterior)}</s> por</span>` : ""}
        <div class="destaque__preco">
          <span class="destaque__rs">R$</span>
          <span class="destaque__inteiro">${Number(inteiro).toLocaleString("pt-BR")}</span>
          <span class="destaque__centavos">,${centavos}</span>
        </div>
        ${item.emOferta && item.desconto > 0 ? `<span class="destaque__desconto">-${item.desconto}%</span>` : ""}
      </div>
    `;
    return slide;
  }

  async function carregarDisplay(id) {
    const statusEl = document.getElementById("displayStatus");
    statusEl.textContent = "Carregando ofertas…";
    try {
      const data = await fetchJson(`/api/paineis/${id}/produtos`);
      document.getElementById("displayNome").textContent = data.painel?.nome || "Painel";
      state.displayUnidade = data.painel?.unidade || "";
      state.displayCampos = new Set(
        Array.isArray(data.painel?.camposExibidos)
          ? data.painel.camposExibidos
          : CAMPOS_DISPONIVEIS.map((c) => c.chave)
      );
      state.displayEstilo = {
        tamanhoFonte: ESCALA_FONTE[data.painel?.estilo?.tamanhoFonte] ? data.painel.estilo.tamanhoFonte : "media",
        corFundo: data.painel?.estilo?.corFundo || null,
        corTexto: data.painel?.estilo?.corTexto || null,
      };
      aplicarEstiloPersonalizado();
      atualizarControlesEstilo();
      state.displayPrefs = {
        modo: ["lista", "destaque"].includes(data.painel?.layout?.modo) ? data.painel.layout.modo : "cards",
        colunas: Number(data.painel?.layout?.colunas) || LAYOUT_PADRAO.colunas,
        linhas: Number(data.painel?.layout?.linhas) || LAYOUT_PADRAO.linhas,
        intervaloTela: Number(data.painel?.layout?.intervaloTela) || LAYOUT_PADRAO.intervaloTela,
      };
      aplicarControlesExibicao();
      state.displayItens = data.content || [];
      state.displayPage = 0;
      atualizarPaginaAtual();
      document.getElementById("lastUpdated").textContent = `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;
    } catch (err) {
      statusEl.textContent = "Erro ao carregar painel: " + err.message;
    }
  }

  async function renderDisplay(id) {
    showView("display");
    state.displayPainelId = id;
    document.getElementById("displayEditarLink").href = `#/editor/${id}`;
    document.getElementById("displayRefreshBtn").onclick = () => carregarDisplay(id);
    document.getElementById("estiloPainel").hidden = true;
    aplicarControlesExibicao();

    await carregarDisplay(id);
    iniciarRotacaoTelas();

    try {
      const cfg = await fetchJson("/api/config");
      const minutes = cfg.refreshIntervalMinutes || 5;
      stopDisplayAutoRefresh();
      state.displayRefreshTimer = setInterval(() => carregarDisplay(id), minutes * 60 * 1000);
    } catch {
      /* usa apenas atualização manual se /api/config falhar */
    }
  }

  async function carregarVersao() {
    try {
      const cfg = await fetchJson("/api/config");
      if (cfg.versao) document.getElementById("versaoBadge").textContent = `v${cfg.versao}`;
    } catch {
      /* selo de versão é só informativo - se falhar, simplesmente não mostra nada */
    }
  }
  carregarVersao();

  router();
})();
