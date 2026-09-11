(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let api = null;
  let lastSnapshot = null;
  let allLogs = [];
  let refreshTimer = null;

  function toast(message, error = false) {
    const node = $("toast");
    node.textContent = String(message || "Concluído");
    node.classList.toggle("error", error);
    node.classList.add("show");
    window.clearTimeout(node._timer);
    node._timer = window.setTimeout(() => node.classList.remove("show"), 3200);
  }

  function formatBytes(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
    const digits = unit >= 3 ? 1 : 0;
    return `${amount.toFixed(digits)} ${units[unit]}`;
  }

  function timeOnly(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function duration(seconds) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours}h ${minutes}min`;
    return `${minutes}min`;
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === `view-${name}`));
    document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === name));
    if (name === "logs") refreshLogs();
  }

  function renderLogRows(target, rows, compact = false) {
    target.replaceChildren();
    const query = ($("log-search")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const visible = compact ? rows.slice(-8) : rows.filter((row) => {
      if (!query) return true;
      return `${row.code || ""} ${row.component || ""} ${row.message || ""}`.toLocaleLowerCase("pt-BR").includes(query);
    });
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "log-row";
      const text = document.createElement("span");
      text.className = "log-message";
      text.textContent = "Nenhum log para mostrar.";
      empty.append(text);
      target.append(empty);
      return;
    }
    visible.forEach((row) => {
      const line = document.createElement("div");
      line.className = "log-row";
      const stamp = document.createElement("span"); stamp.className = "log-time"; stamp.textContent = timeOnly(row.at);
      const level = document.createElement("span"); level.className = `log-level ${row.level || "info"}`; level.textContent = row.level || "info";
      const component = document.createElement("span"); component.className = "log-component"; component.textContent = row.component || "agent";
      const message = document.createElement("span"); message.className = "log-message"; message.textContent = row.message || row.code || "Evento";
      line.append(stamp, level, component, message);
      target.append(line);
    });
    if (!compact) target.scrollTop = target.scrollHeight;
  }

  function renderSnapshot(value) {
    lastSnapshot = value;
    const version = value.version || "—";
    $("rail-version").textContent = `v${version}`;
    $("head-version").textContent = `v${version}`;
    $("settings-version").textContent = `TDA Companion ${version}`;

    const agent = value.agent || {};
    const lifecycle = agent.lifecycle || "preparing";
    $("agent-pill").textContent = lifecycle === "ready" ? "● Agente local ativo" : lifecycle === "paused" ? "● Fila pausada" : "● Preparando";
    $("agent-pill").classList.toggle("warning", lifecycle !== "ready");
    $("machine-state").textContent = lifecycle === "ready" ? "Online" : lifecycle === "paused" ? "Pausado" : "Preparando";
    $("agent-detail").textContent = `TDA local · API v${agent.api_version || "1"} · 127.0.0.1:${agent.port || 8765} · ativo há ${duration(agent.uptime_seconds)}`;

    const system = value.system || {};
    const host = system.host || {};
    const gpu = Array.isArray(system.gpus) && system.gpus.length ? system.gpus[0] : null;
    const cpu = system.cpu || {};
    const memory = system.memory || {};
    $("machine-description").textContent = [host.os, host.cpu, gpu?.name].filter(Boolean).join(" · ") || "Sistema local";
    $("gpu-value").textContent = gpu && typeof gpu.utilization_percent === "number" ? `${gpu.utilization_percent}%` : "—";
    $("vram-value").textContent = gpu ? `VRAM ${formatBytes(gpu.memory_used_bytes)} / ${formatBytes(gpu.memory_total_bytes)}` : "GPU NVIDIA indisponível";
    $("cpu-value").textContent = typeof cpu.utilization_percent === "number" ? `${cpu.utilization_percent}%` : "—";
    $("cpu-name").textContent = host.cpu || "CPU local";
    $("ram-value").textContent = typeof memory.percent === "number" ? `${memory.percent}%` : "—";
    $("ram-detail").textContent = `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.total_bytes)}`;

    const storage = value.storage || {};
    $("storage-value").textContent = storage.free_bytes == null ? "—" : `${formatBytes(storage.free_bytes)} livres`;
    $("storage-detail").textContent = storage.total_bytes == null ? "Volume local" : `de ${formatBytes(storage.total_bytes)}`;

    const counts = value.counts || {};
    $("count-processing").textContent = counts.processing ?? 0;
    $("count-queued").textContent = counts.queued ?? 0;
    $("count-completed").textContent = counts.completed ?? 0;
    $("count-attention").textContent = counts.attention ?? 0;
    $("last-update").textContent = `Atualizado ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    $("toggle-queue").textContent = lifecycle === "paused" ? "Retomar fila" : "Pausar fila";

    const active = (value.jobs || []).find((job) => job.status === "running");
    const summary = $("work-summary");
    if (active) {
      summary.querySelector("h3").textContent = "Processamento em andamento";
      const progress = active.progress || {};
      summary.querySelector("p").textContent = `${active.kind || "Trabalho local"} · ${progress.completed ?? 0} de ${progress.total ?? "—"} ${progress.unit || "itens"}`;
    } else {
      summary.querySelector("h3").textContent = "Nenhum processamento em andamento.";
      summary.querySelector("p").textContent = counts.queued ? `${counts.queued} trabalho(s) aguardando na fila.` : "A fila está livre. Envie um novo trabalho pelo site do TDA quando quiser processar uma sessão.";
    }

    const settings = value.settings || {};
    $("setting-startup").checked = Boolean(settings.start_with_windows);
    $("setting-tray").checked = Boolean(settings.show_tray);
    $("setting-updates").checked = Boolean(settings.check_updates);
    $("setting-theme").value = settings.theme || "system";
    $("setting-close").value = settings.close_behavior || "hide";
  }

  async function refreshSnapshot() {
    if (!api) return;
    try {
      const value = await api.snapshot();
      renderSnapshot(value);
    } catch (error) {
      $("agent-pill").textContent = "● Agente indisponível";
      $("agent-pill").classList.add("warning");
    }
  }

  async function refreshLogs() {
    if (!api) return;
    try {
      const level = $("log-level")?.value || null;
      const result = await api.logs(level, null, 300);
      allLogs = Array.isArray(result.logs) ? result.logs : [];
      renderLogRows($("full-logs"), allLogs, false);
      renderLogRows($("overview-logs"), allLogs, true);
    } catch (error) {
      toast(`Não foi possível ler os logs: ${error}`, true);
    }
  }

  async function checkUpdate(announce = false) {
    if (!api) return;
    try {
      const result = await api.check_update();
      $("update-banner").classList.toggle("hidden", !result.available);
      $("update-version").textContent = result.available ? `· v${result.version}` : "";
      if (announce) toast(result.available ? `TDA Companion ${result.version} disponível.` : "Você já está na versão mais recente.");
    } catch (error) {
      if (announce) toast(`Não foi possível verificar atualização: ${error}`, true);
    }
  }

  function renderDiagnostics(result) {
    $("diagnostic-overall").textContent = result.overall === "pass" ? "Tudo certo" : result.overall === "warning" ? "Atenção recomendada" : "Problema encontrado";
    $("diagnostic-time").textContent = result.generated_at ? new Date(result.generated_at).toLocaleString("pt-BR") : "—";
    const target = $("diagnostic-list"); target.replaceChildren();
    (result.checks || []).forEach((check) => {
      const row = document.createElement("div"); row.className = "diagnostic-row";
      const dot = document.createElement("i"); dot.className = `diagnostic-status ${check.status || ""}`;
      const code = document.createElement("b"); code.textContent = check.code || "check";
      const message = document.createElement("span"); message.textContent = check.message || "—";
      const detail = document.createElement("small"); detail.textContent = check.detail || check.status || "—";
      row.append(dot, code, message, detail); target.append(row);
    });
  }

  async function runDiagnostics() {
    try { renderDiagnostics(await api.diagnostics()); } catch (error) { toast(`Diagnóstico falhou: ${error}`, true); }
  }

  async function updateSetting(key, value) {
    try { await api.update_settings({ [key]: value }); await refreshSnapshot(); } catch (error) { toast(`Não foi possível salvar: ${error}`, true); }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-item").forEach((node) => node.addEventListener("click", () => showView(node.dataset.view)));
    document.querySelectorAll("[data-go]").forEach((node) => node.addEventListener("click", () => showView(node.dataset.go)));
    $("open-tda").addEventListener("click", () => api.open_tda());
    $("open-local").addEventListener("click", () => api.open_local_folder());
    $("open-logs").addEventListener("click", () => api.open_logs_folder());
    $("toggle-queue").addEventListener("click", async () => {
      try { await api.set_queue_paused(lastSnapshot?.agent?.lifecycle !== "paused"); await refreshSnapshot(); } catch (error) { toast(`Não foi possível alterar a fila: ${error}`, true); }
    });
    $("restart-agent").addEventListener("click", async () => {
      if (!window.confirm("Reiniciar o Agent local? A ação é bloqueada se houver trabalho em execução.")) return;
      try { await api.restart_agent(); toast("Agent reiniciado."); await refreshSnapshot(); } catch (error) { toast(`Não foi possível reiniciar: ${error}`, true); }
    });
    $("quick-diagnostics").addEventListener("click", () => { showView("diagnostics"); runDiagnostics(); });
    $("run-diagnostics").addEventListener("click", runDiagnostics);
    $("export-diagnostics").addEventListener("click", async () => {
      try { const path = await api.export_diagnostics(); toast(`Diagnóstico exportado: ${path}`); } catch (error) { toast(`Export falhou: ${error}`, true); }
    });
    $("refresh-logs").addEventListener("click", refreshLogs);
    $("log-level").addEventListener("change", refreshLogs);
    $("log-search").addEventListener("input", () => renderLogRows($("full-logs"), allLogs, false));
    $("setting-startup").addEventListener("change", (event) => updateSetting("start_with_windows", event.target.checked));
    $("setting-tray").addEventListener("change", (event) => updateSetting("show_tray", event.target.checked));
    $("setting-updates").addEventListener("change", (event) => updateSetting("check_updates", event.target.checked));
    $("setting-theme").addEventListener("change", (event) => updateSetting("theme", event.target.value));
    $("setting-close").addEventListener("change", (event) => updateSetting("close_behavior", event.target.value));
    $("copy-token").addEventListener("click", async () => {
      try {
        const token = await api.pairing_token();
        await navigator.clipboard.writeText(token);
        $("token-feedback").textContent = "Token copiado";
        window.setTimeout(() => $("token-feedback").textContent = "", 2200);
      } catch (error) { toast(`Não foi possível copiar o token: ${error}`, true); }
    });
    $("check-update").addEventListener("click", () => checkUpdate(true));
    $("update-banner").addEventListener("click", () => { showView("settings"); checkUpdate(true); });
  }

  async function boot() {
    api = window.pywebview?.api;
    if (!api) return;
    bindEvents();
    await refreshSnapshot();
    await refreshLogs();
    if (lastSnapshot?.settings?.check_updates) checkUpdate(false);
    refreshTimer = window.setInterval(async () => {
      await refreshSnapshot();
      if (document.visibilityState === "visible") await refreshLogs();
    }, 3000);
  }

  window.addEventListener("pywebviewready", boot, { once: true });
  window.addEventListener("beforeunload", () => { if (refreshTimer) window.clearInterval(refreshTimer); });
})();
