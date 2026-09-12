(() => {
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
    document.querySelectorAll(".view").forEach((node) => {
      node.classList.toggle("active", node.id === `view-${name}`);
    });
    document.querySelectorAll(".nav-item").forEach((node) => {
      node.classList.toggle("active", node.dataset.view === name);
    });
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

  function renderWhisperRuntime(result, checkedRemote = false) {
    const status = result?.status || "missing";
    const current = result?.current_version || result?.version || null;
    const detail = $("whisper-runtime-detail");
    const feedback = $("whisper-runtime-feedback");
    const install = $("install-whisper-runtime");

    if (status === "ready") {
      detail.textContent = `Whisper runtime${current ? ` v${current}` : ""} instalado e íntegro.`;
    } else if (status === "corrupt") {
      detail.textContent = `Runtime Whisper${current ? ` v${current}` : ""} precisa de reparo.`;
    } else {
      detail.textContent = "Runtime Whisper ainda não instalado.";
    }

    if (!checkedRemote) {
      install.classList.add("hidden");
      feedback.textContent = "CUDA, cuBLAS e cuDNN ficam contidos no runtime local; o Companion não altera o PATH global.";
      return;
    }

    if (result?.repair_required) {
      install.classList.add("hidden");
      feedback.textContent = "A versão atual falhou na verificação de integridade. Use o diagnóstico antes de reinstalar.";
      return;
    }

    const available = Boolean(result?.available);
    install.classList.toggle("hidden", !available);
    if (available) {
      install.textContent = status === "ready" ? `Atualizar runtime para ${result.version}` : `Instalar runtime ${result.version}`;
      feedback.textContent = `Pacote verificado disponível · ${formatBytes(result.size)} · v${result.version}`;
    } else {
      feedback.textContent = status === "ready" ? "Runtime Whisper já está na versão estável mais recente." : "Nenhum runtime estável disponível neste momento.";
    }
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
    renderWhisperRuntime(value.whisper_runtime || { status: "missing" }, false);
  }

  async function refreshSnapshot() {
    if (!api) return;
    try {
      const value = await api.snapshot();
      renderSnapshot(value);
    } catch {
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

  function renderUpdate(result) {
    const available = Boolean(result?.available);
    $("update-banner").classList.toggle("hidden", !available);
    $("update-version").textContent = available ? `· v${result.version}` : "";
    $("install-update").classList.toggle("hidden", !available);
    if (available) $("install-update").textContent = `Atualizar para ${result.version}`;
  }

  async function checkUpdate(announce = false) {
    if (!api) return;
    try {
      const result = await api.check_update();
      renderUpdate(result);
      if (announce) toast(result.available ? `TDA Companion ${result.version} disponível.` : "Você já está na versão mais recente.");
    } catch (error) {
      if (announce) toast(`Não foi possível verificar atualização: ${error}`, true);
    }
  }

  async function checkWhisperRuntime(announce = false) {
    if (!api) return;
    const button = $("check-whisper-runtime");
    button.disabled = true;
    try {
      const result = await api.check_whisper_runtime();
      renderWhisperRuntime(result, true);
      if (announce) {
        const message = result.repair_required
          ? "O runtime Whisper precisa de reparo."
          : result.available
            ? `Whisper runtime ${result.version} disponível.`
            : "Runtime Whisper já está atualizado.";
        toast(message, Boolean(result.repair_required));
      }
    } catch (error) {
      if (announce) toast(`Não foi possível verificar o runtime: ${error}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function installWhisperRuntime() {
    if (!window.confirm("Baixar e instalar o runtime Whisper isolado? O pacote é grande e a instalação é bloqueada enquanto houver trabalho em execução.")) return;
    const button = $("install-whisper-runtime");
    button.disabled = true;
    button.textContent = "Baixando e verificando…";
    try {
      const result = await api.install_whisper_runtime();
      if (!result.accepted) {
        toast("Runtime Whisper já está atualizado.");
      } else {
        toast(`Whisper runtime ${result.version} instalado e verificado.`);
      }
      await refreshSnapshot();
      await checkWhisperRuntime(false);
    } catch (error) {
      toast(`O runtime não foi instalado: ${error}`, true);
      await checkWhisperRuntime(false);
    } finally {
      button.disabled = false;
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

  async function installUpdate() {
    if (!window.confirm("Baixar, verificar e instalar a atualização agora? O Agent só será reiniciado se não houver trabalho em execução.")) return;
    const button = $("install-update");
    button.disabled = true;
    button.textContent = "Preparando atualização…";
    try {
      const result = await api.install_update();
      if (!result.accepted) {
        renderUpdate(result);
        toast("Você já está na versão mais recente.");
        return;
      }
      toast(`Atualizando para ${result.version}…`);
      await api.close_desktop();
    } catch (error) {
      toast(`A atualização não foi iniciada: ${error}`, true);
      button.disabled = false;
      await checkUpdate(false);
    }
  }

  async function uninstall(purge) {
    const message = purge
      ? "Remover completamente o TDA Companion, fila, resultados, modelos, logs e configurações locais deste usuário? Esta ação não pode ser desfeita."
      : "Desinstalar o TDA Companion e manter seus dados locais para uma futura reinstalação?";
    if (!window.confirm(message)) return;
    if (purge && !window.confirm("Confirma a remoção COMPLETA dos dados locais do TDA neste computador?")) return;
    try {
      const result = await api.uninstall(Boolean(purge));
      if (result.accepted) {
        toast(purge ? "Removendo completamente o TDA Companion…" : "Desinstalando o TDA Companion…");
        await api.close_desktop();
      }
    } catch (error) {
      toast(`A desinstalação não foi iniciada: ${error}`, true);
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-item").forEach((node) => {
      node.addEventListener("click", () => showView(node.dataset.view));
    });
    document.querySelectorAll("[data-go]").forEach((node) => {
      node.addEventListener("click", () => showView(node.dataset.go));
    });
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
    $("check-whisper-runtime").addEventListener("click", () => checkWhisperRuntime(true));
    $("install-whisper-runtime").addEventListener("click", installWhisperRuntime);
    $("check-update").addEventListener("click", () => checkUpdate(true));
    $("install-update").addEventListener("click", installUpdate);
    $("update-banner").addEventListener("click", () => { showView("settings"); checkUpdate(true); });
    $("uninstall-keep").addEventListener("click", () => uninstall(false));
    $("uninstall-purge").addEventListener("click", () => uninstall(true));
  }

  async function boot() {
    api = window.pywebview?.api;
    if (!api) return;
    bindEvents();
    await refreshSnapshot();
    await refreshLogs();
    if (lastSnapshot?.settings?.check_updates) {
      checkUpdate(false);
      checkWhisperRuntime(false);
    }
    refreshTimer = window.setInterval(async () => {
      await refreshSnapshot();
      if (document.visibilityState === "visible") await refreshLogs();
    }, 3000);
  }

  window.addEventListener("pywebviewready", boot, { once: true });
  window.addEventListener("beforeunload", () => { if (refreshTimer) window.clearInterval(refreshTimer); });
})();