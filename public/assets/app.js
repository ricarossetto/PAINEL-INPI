const DATA_URL = "./data/inpi-dashboard.json";
const CONFIG_URL = "./data/config.json";

const state = {
  data: null,
  config: null,
  search: "",
  monitor: "all",
  field: "all",
  sort: "recent"
};

const els = {
  sourceStatus: document.querySelector("#sourceStatus"),
  lastUpdate: document.querySelector("#lastUpdate"),
  searchInput: document.querySelector("#searchInput"),
  monitorFilter: document.querySelector("#monitorFilter"),
  fieldFilter: document.querySelector("#fieldFilter"),
  sortFilter: document.querySelector("#sortFilter"),
  metricMatches: document.querySelector("#metricMatches"),
  metricProcesses: document.querySelector("#metricProcesses"),
  metricRevistas: document.querySelector("#metricRevistas"),
  metricLatest: document.querySelector("#metricLatest"),
  monitorCount: document.querySelector("#monitorCount"),
  monitorList: document.querySelector("#monitorList"),
  runScanned: document.querySelector("#runScanned"),
  runPending: document.querySelector("#runPending"),
  runErrors: document.querySelector("#runErrors"),
  resultCount: document.querySelector("#resultCount"),
  resultsList: document.querySelector("#resultsList"),
  emptyState: document.querySelector("#emptyState"),
  resetFilters: document.querySelector("#resetFilters")
};

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: value.includes("T") ? "short" : undefined
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value || 0);
}

async function fetchJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Falha ao carregar ${url}`, error);
    return fallback;
  }
}

function processText(match) {
  return [
    match.processo,
    match.marca?.nome,
    match.procuradores?.join(" "),
    match.requerentes?.map((item) => item.nome).join(" "),
    match.despachos?.map((item) => `${item.codigo} ${item.nome} ${item.texto}`).join(" "),
    match.classes?.map((item) => `${item.codigo} ${item.status} ${item.especificacao}`).join(" ")
  ].join(" ");
}

function fieldText(match, field) {
  if (field === "marca") return match.marca?.nome || "";
  if (field === "procurador") return match.procuradores?.join(" ") || "";
  if (field === "requerente") return match.requerentes?.map((item) => item.nome).join(" ") || "";
  if (field === "despacho") return match.despachos?.map((item) => `${item.codigo} ${item.nome} ${item.texto}`).join(" ") || "";
  if (field === "classe") return match.classes?.map((item) => `${item.codigo} ${item.status} ${item.especificacao}`).join(" ") || "";
  return processText(match);
}

function getFilteredMatches() {
  const data = state.data || {};
  const query = normalize(state.search);

  const matches = (data.matches || []).filter((match) => {
    if (state.monitor !== "all") {
      const hasMonitor = (match.monitores || []).some((monitor) => monitor.id === state.monitor);
      if (!hasMonitor) return false;
    }

    if (state.field !== "all") {
      const monitorHitsField = (match.monitores || []).some((monitor) => (monitor.fields || []).includes(state.field));
      if (!monitorHitsField && !normalize(fieldText(match, state.field)).includes(query)) {
        if (!query) return false;
      }
    }

    if (query) {
      const searchable = state.field === "all" ? processText(match) : fieldText(match, state.field);
      if (!normalize(searchable).includes(query)) return false;
    }

    return true;
  });

  matches.sort((a, b) => {
    if (state.sort === "brand") return String(a.marca?.nome || "").localeCompare(String(b.marca?.nome || ""), "pt-BR");
    if (state.sort === "process") return String(a.processo || "").localeCompare(String(b.processo || ""), "pt-BR");
    return Number(b.revista?.numero || 0) - Number(a.revista?.numero || 0);
  });

  return matches;
}

function renderStatus() {
  const data = state.data || {};
  const generatedAt = data.generatedAt;
  const errors = data.lastRun?.errors?.length || 0;

  els.sourceStatus.textContent = generatedAt ? "Atualizado" : "Sem carga";
  els.sourceStatus.className = `status-pill ${generatedAt ? (errors ? "warn" : "ok") : "warn"}`;
  els.lastUpdate.textContent = generatedAt ? `Gerado em ${formatDate(generatedAt)}` : "Aguardando primeira varredura";
}

function renderMetrics(matches) {
  const data = state.data || {};
  const latest = data.statistics?.latestRevista;
  const processes = new Set(matches.map((match) => match.processo).filter(Boolean));
  const revistas = new Set(matches.map((match) => match.revista?.numero).filter(Boolean));

  els.metricMatches.textContent = formatNumber(matches.length);
  els.metricProcesses.textContent = formatNumber(processes.size);
  els.metricRevistas.textContent = formatNumber(revistas.size || data.statistics?.totalRevistas || 0);
  els.metricLatest.textContent = latest?.numero ? `${latest.numero}` : "-";
}

function renderMonitorOptions() {
  const monitors = state.config?.monitors || [];
  els.monitorFilter.innerHTML = '<option value="all">Todos</option>';
  for (const monitor of monitors) {
    const option = document.createElement("option");
    option.value = monitor.id;
    option.textContent = monitor.label;
    els.monitorFilter.append(option);
  }
}

function renderMonitors() {
  const monitors = state.config?.monitors || [];
  const matches = state.data?.matches || [];
  els.monitorCount.textContent = monitors.length;
  els.monitorList.innerHTML = "";

  for (const monitor of monitors) {
    const count = matches.filter((match) => (match.monitores || []).some((hit) => hit.id === monitor.id)).length;
    const node = document.createElement("article");
    node.className = "monitor-item";
    node.innerHTML = `
      <strong>${escapeHtml(monitor.label)}</strong>
      <div class="monitor-meta">
        <span class="chip ${monitor.type === "marca" ? "amber" : "green"}">${escapeHtml(monitor.type || "alvo")}</span>
        ${monitor.oab ? `<span class="chip">${escapeHtml(monitor.oab)}</span>` : ""}
        <span class="chip">${formatNumber(count)} ocorrência${count === 1 ? "" : "s"}</span>
      </div>
    `;
    els.monitorList.append(node);
  }
}

function renderRunBox() {
  const run = state.data?.lastRun || {};
  els.runScanned.textContent = run.scannedRevistas ?? "-";
  els.runPending.textContent = run.pendingNotifications ?? "-";
  els.runErrors.textContent = run.errors?.length ? run.errors.length : "0";
}

function renderResults(matches) {
  els.resultCount.textContent = `${formatNumber(matches.length)} registro${matches.length === 1 ? "" : "s"}`;
  els.resultsList.innerHTML = "";
  els.emptyState.hidden = matches.length > 0;

  for (const match of matches) {
    const dispatch = (match.despachos || [])[0] || {};
    const classes = (match.classes || []).slice(0, 2).map((item) => `NCL ${item.codigo}${item.status ? ` · ${item.status}` : ""}`).join(" | ");
    const monitors = (match.monitores || []).map((item) => item.label).join(", ");
    const requerentes = (match.requerentes || []).map((item) => item.uf ? `${item.nome} (${item.uf})` : item.nome).join("; ");
    const procuradores = (match.procuradores || []).join("; ");

    const node = document.createElement("article");
    node.className = "result-card";
    node.innerHTML = `
      <div class="result-main">
        <span class="process-number">Processo ${escapeHtml(match.processo || "-")}</span>
        <strong class="brand-name">${escapeHtml(match.marca?.nome || "Marca não informada")}</strong>
        <div class="monitor-meta">
          <span class="chip green">RPI ${escapeHtml(match.revista?.numero || "-")}</span>
          <span class="chip">${escapeHtml(formatDate(match.revista?.data))}</span>
        </div>
      </div>

      <div class="stack">
        <div class="line-item">
          <span>Monitor</span>
          <strong>${escapeHtml(monitors || "-")}</strong>
        </div>
        <div class="line-item">
          <span>Despacho</span>
          <p class="dispatch">${escapeHtml([dispatch.codigo, dispatch.nome].filter(Boolean).join(" · ") || "-")}</p>
        </div>
        <div class="line-item">
          <span>Classe</span>
          <p>${escapeHtml(classes || "-")}</p>
        </div>
      </div>

      <div class="stack">
        <div class="line-item">
          <span>Procurador</span>
          <p>${escapeHtml(procuradores || "-")}</p>
        </div>
        <div class="line-item">
          <span>Requerente</span>
          <p>${escapeHtml(requerentes || "-")}</p>
        </div>
        <div class="actions">
          ${match.links?.pdf ? `<a class="action-link primary" href="${escapeHtml(match.links.pdf)}" target="_blank" rel="noreferrer">PDF</a>` : ""}
          ${match.links?.xml ? `<a class="action-link" href="${escapeHtml(match.links.xml)}" target="_blank" rel="noreferrer">XML</a>` : ""}
        </div>
      </div>
    `;
    els.resultsList.append(node);
  }
}

function render() {
  const matches = getFilteredMatches();
  renderStatus();
  renderMetrics(matches);
  renderMonitors();
  renderRunBox();
  renderResults(matches);
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  els.monitorFilter.addEventListener("change", (event) => {
    state.monitor = event.target.value;
    render();
  });

  els.fieldFilter.addEventListener("change", (event) => {
    state.field = event.target.value;
    render();
  });

  els.sortFilter.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  els.resetFilters.addEventListener("click", () => {
    state.search = "";
    state.monitor = "all";
    state.field = "all";
    state.sort = "recent";
    els.searchInput.value = "";
    els.monitorFilter.value = "all";
    els.fieldFilter.value = "all";
    els.sortFilter.value = "recent";
    render();
  });
}

async function init() {
  const [data, config] = await Promise.all([
    fetchJson(DATA_URL, { matches: [], statistics: {}, revistas: [] }),
    fetchJson(CONFIG_URL, { monitors: [] })
  ]);

  state.data = data;
  state.config = config;

  renderMonitorOptions();
  bindEvents();
  render();
}

init();
