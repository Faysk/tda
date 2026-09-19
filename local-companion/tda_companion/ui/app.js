(() => {
  const $ = (id) => document.getElementById(id);
  let api = null;
  let lastSnapshot = null;
  let allLogs = [];
  let refreshTimer = null;
  let lastConnectionState = null;

  const FRIENDLY_ERRORS = {
    CRAIG_FILE_PICKER_UNAVAILABLE: "O seletor de arquivos do Windows não está disponível.",
    CRAIG_ZIP_REQUIRED: "Selecione o ZIP original do Craig.",
    CRAIG_ARCHIVE_INVALID: "O arquivo selecionado não é um ZIP Craig válido.",
    CRAIG_ARCHIVE_NO_TRACKS: "O ZIP não contém faixas FLAC do Craig.",
    CRAIG_SOURCE_CHANGED: "O arquivo mudou enquanto era lido. Selecione-o novamente.",
    CRAIG_UPLOAD_SIZE_LIMIT: "A sessão excede o limite local de tamanho.",
    TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB: "Espere o trabalho atual terminar antes de preparar outro perfil.",
    TRANSCRIPTION_PREPARATION_ALREADY_RUNNING: "Já existe uma preparação de perfil em andamento neste Companion.",
    TRANSCRIPTION_WORK_ALREADY_ACTIVE: "Esta mesma transcrição já está ativa em outra tela ou sessão. Acompanhe o trabalho existente em vez de criar uma cópia.",
    MAINTENANCE_BLOCKED_BY_TRANSCRIPTION_PREPARATION: "Aguarde a preparação do perfil terminar antes de atualizar ou remover o Companion.",
    RUNTIME_UPDATE_BLOCKED_BY_RUNNING_JOB: "O runtime não pode ser alterado enquanto há um trabalho em execução.",
    RUNTIME_UPDATE_BLOCKED_BY_TRANSCRIPTION_PREPARATION: "O runtime não pode ser alterado enquanto o Agent prepara um perfil de transcrição.",
    QWEN_RUNTIME_UNAVAILABLE: "O runtime Qwen ainda não está disponível.",
    QWEN_RUNTIME_LONG_GATE_REQUIRED: "O runtime Qwen instalado é antigo e precisa ser atualizado.",
    QWEN_CUDA_UNAVAILABLE: "O Qwen não encontrou CUDA disponível nesta máquina.",
    QWEN_CUDA_DRIVER_INCOMPATIBLE: "A RTX foi encontrada, mas o driver NVIDIA não consegue executar o runtime CUDA deste Qwen. Atualize o driver NVIDIA e tente novamente.",
    QWEN_CUDA_EXECUTION_FAILED: "A RTX foi encontrada, mas uma operação CUDA real falhou antes de carregar o modelo.",
    QWEN_ACCEPTANCE_AUDIO_TOO_SHORT: "Nenhuma faixa possui 60 segundos úteis para validar o Qwen.",
    QWEN_ACCEPTANCE_NO_SPEECH_RECOGNIZED: "A amostra escolhida não teve fala suficiente. Tente outra sessão.",
    QWEN_MODEL_DOWNLOAD_FAILED: "Não foi possível baixar o modelo Qwen.",
    QWEN_MODEL_REPAIR_REQUIRED: "O modelo Qwen local precisa de reparo.",
    QWEN_MODEL_REPAIR_FAILED: "O Companion não conseguiu substituir automaticamente o modelo Qwen local inválido.",
    QWEN_ALIGNER_REPAIR_REQUIRED: "O alinhador Qwen local precisa de reparo.",
    QWEN_ALIGNER_REPAIR_FAILED: "O Companion não conseguiu substituir automaticamente o alinhador Qwen local inválido.",
    QWEN_MODEL_NOT_GPU_RESIDENT: "O modelo Qwen não coube integralmente na GPU.",
    QWEN_ALIGNER_NOT_GPU_RESIDENT: "O alinhador Qwen não coube integralmente na GPU.",
    QWEN_ASR_GPU_MEMORY_EXHAUSTED: "O Qwen ficou sem VRAM durante a inferência. Feche outros usos da GPU ou tente o perfil Qwen equilibrado.",
    QWEN_ASR_CUDA_FAILED: "A execução CUDA do Qwen falhou durante a inferência.",
    QWEN_ASR_RUNTIME_API_FAILED: "O runtime Qwen encontrou uma incompatibilidade de API durante a inferência.",
    QWEN_ASR_INPUT_FAILED: "O runtime Qwen rejeitou o formato ou o tamanho da amostra de áudio.",
    QWEN_ALIGNMENT_FAILED: "O Qwen transcreveu a amostra, mas o alinhamento por palavra falhou.",
    QWEN_ASR_INFERENCE_FAILED: "A inferência Qwen falhou. Consulte os logs da preparação para o estágio exato.",
    QWEN_ASR_AUDIO_BACKEND_MISSING: "O runtime Qwen não conseguiu abrir o áudio com o backend empacotado.",
    QWEN_AUDIO_DECODE_RUNTIME_FAILED: "O runtime Qwen instalado falhou no teste interno de decodificação de áudio e precisa ser atualizado.",
    QWEN_ACCEPTANCE_AUDIO_DECODE_FAILED: "O Qwen não conseguiu decodificar a amostra local de áudio para o gate físico.",
    QWEN_ACCEPTANCE_GPU_NAME_MISMATCH: "O gate físico não foi executado na GPU exigida por esta validação.",
    WHISPER_RUNTIME_UNAVAILABLE: "O runtime Whisper compatível ainda não está pronto.",
    WHISPER_MODEL_DOWNLOAD_FAILED: "Não foi possível baixar o modelo Whisper. Verifique a conexão e tente novamente; o download pode ser retomado no próximo preparo.",
    WHISPER_MODEL_DOWNLOAD_INCOMPLETE: "O download do modelo Whisper terminou incompleto e foi rejeitado.",
    WHISPER_MODEL_INTEGRITY_FAILED: "O modelo Whisper baixado não passou na verificação de integridade.",
    WHISPER_MODEL_REPAIR_FAILED: "O Companion não conseguiu substituir automaticamente o modelo Whisper local inválido.",
    WHISPER_MODEL_PREPARATION_TIMEOUT: "A preparação do modelo Whisper excedeu o limite de tempo.",
    WHISPER_MODEL_PREPARATION_NOT_VISIBLE: "O modelo Whisper foi preparado, mas o Agent ainda não o reconheceu como pronto.",
    WHISPER_MODEL_PREPARATION_REQUIRED: "O modelo Whisper ainda precisa ser preparado antes de criar o trabalho.",
    AGENT_CONNECTION_REFUSED: "O Agent local não está respondendo.",
    AGENT_CONNECTION_TIMEOUT: "O Agent local demorou demais para responder.",
    AGENT_CONNECTION_FAILED: "Não foi possível conectar ao Agent local.",
    AGENT_RECONNECT_BACKOFF: "O Agent continua indisponível. Uma nova tentativa será feita automaticamente.",
    AGENT_RECOVERY_FAILED: "O Agent não voltou após a tentativa de recuperação.",
    AGENT_START_FAILED: "O Agent local não pôde ser iniciado.",
    AGENT_STOPPED_BY_USER: "O Agent foi parado deliberadamente neste computador.",
    AGENT_PORT_CONFLICT: "A porta local 8765 está sendo usada por outro processo. O Companion não enviou seu token para ele.",
    AGENT_API_INCOMPATIBLE: "O Agent em execução usa uma API incompatível com esta interface.",
    AGENT_VERSION_MISMATCH: "A interface e o Agent são de versões diferentes. Reinicie o Agent antes de alterar o estado local.",
    AGENT_RESTART_VERSION_MISMATCH: "O Agent reiniciado ainda não corresponde à versão desta interface.",
    AGENT_RESTART_FAILED: "O Agent não voltou corretamente após o reinício.",
    AGENT_RESTART_BLOCKED_BY_TRANSCRIPTION_PREPARATION: "O Agent está preparando um perfil de transcrição e não pode ser reiniciado agora.",
    AGENT_SHUTDOWN_TIMEOUT: "O Agent não encerrou dentro do tempo esperado.",
  };

  function errorText(error) {
    const raw = String(error || "Erro desconhecido");
    const code = raw.replace(/^Error:\s*/, "").trim();
    return FRIENDLY_ERRORS[code] || code;
  }

  function toast(message, error = false) {
    const node = $("toast");
    node.textContent = String(message || "Concluído");
    node.classList.toggle("error", error);
    node.classList.add("show");
    window.clearTimeout(node._timer);
    node._timer = window.setTimeout(() => node.classList.remove("show"), 3600);
  }

  function formatBytes(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
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
    if (name === "logs") refreshLogs(false);
  }

  function formatLogContext(context) {
    if (!context || typeof context !== "object") return "";
    const labels = {
      stage: "etapa",
      profile_id: "perfil",
      engine: "engine",
      runtime_version: "runtime",
      gpu_name: "GPU",
      track_number: "faixa",
      track_count: "faixas",
      audio_window_seconds: "amostra",
      downloaded_bytes: "baixado",
      error_code: "erro",
      worker_code: "código do worker",
      job_id: "job",
      terminal: "terminal",
      failure_stage: "etapa da falha",
      sequence: "#",
    };
    const parts = [];
    Object.entries(labels).forEach(([key, label]) => {
      const value = context[key];
      if (value === undefined || value === null || value === "") return;
      if (key === "downloaded_bytes" && typeof value === "number") {
        parts.push(`${label}=${formatBytes(value)}`);
      } else if (key === "audio_window_seconds" && typeof value === "number") {
        parts.push(`${label}=${value}s`);
      } else {
        parts.push(`${label}=${String(value).slice(0, 120)}`);
      }
    });
    return parts.join(" · ");
  }

  function renderLogRows(target, rows, compact = false) {
    target.replaceChildren();
    const query = ($("log-search")?.value || "").trim().toLocaleLowerCase("pt-BR");
    const visible = compact
      ? rows.slice(-8)
      : rows.filter((row) => {
          if (!query) return true;
          return `${row.code || ""} ${row.component || ""} ${row.message || ""} ${formatLogContext(row.context)}`
            .toLocaleLowerCase("pt-BR")
            .includes(query);
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
      const stamp = document.createElement("span");
      stamp.className = "log-time";
      stamp.textContent = timeOnly(row.at);
      const level = document.createElement("span");
      level.className = `log-level ${row.level || "info"}`;
      level.textContent = row.level || "info";
      const component = document.createElement("span");
      component.className = "log-component";
      component.textContent = row.component || "agent";

      const message = document.createElement("div");
      message.className = "log-message";
      const main = document.createElement("div");
      main.className = "log-message-main";
      if (row.code) {
        const code = document.createElement("span");
        code.className = "log-code";
        code.textContent = row.code;
        main.append(code);
      }
      const copy = document.createElement("span");
      copy.textContent = row.message || row.code || "Evento";
      main.append(copy);
      message.append(main);

      const contextText = formatLogContext(row.context);
      if (contextText) {
        const context = document.createElement("span");
        context.className = "log-context";
        context.textContent = contextText;
        message.append(context);
      }

      line.append(stamp, level, component, message);
      target.append(line);
    });
    if (!compact) target.scrollTop = target.scrollHeight;
  }

  function renderLogsUnavailable(result) {
    allLogs = [];
    const message = `Logs indisponíveis enquanto o Agent não responde. ${errorText(result?.error || "AGENT_CONNECTION_FAILED")}`;
    [$("full-logs"), $("overview-logs")].forEach((target) => {
      target.replaceChildren();
      const row = document.createElement("div");
      row.className = "log-row";
      const level = document.createElement("span");
      level.className = "log-level warning";
      level.textContent = "warning";
      const component = document.createElement("span");
      component.className = "log-component";
      component.textContent = "agent";
      const text = document.createElement("span");
      text.className = "log-message";
      text.textContent = message;
      row.append(level, component, text);
      target.append(row);
    });
  }

  function renderWhisperRuntime(result, checkedRemote = false) {
    const status = result?.status || "missing";
    const current = result?.current_version || result?.version || null;
    const detail = $("whisper-runtime-detail");
    const feedback = $("whisper-runtime-feedback");
    const install = $("install-whisper-runtime");

    if (status === "ready") detail.textContent = `Whisper runtime${current ? ` v${current}` : ""} instalado e íntegro.`;
    else if (status === "corrupt") detail.textContent = `Runtime Whisper${current ? ` v${current}` : ""} precisa de reparo.`;
    else detail.textContent = "Runtime Whisper ainda não instalado.";

    if (!checkedRemote) {
      install.classList.add("hidden");
      feedback.textContent = "Runtime isolado; não altera o PATH global.";
      return;
    }

    const available = Boolean(result?.available);
    install.classList.toggle("hidden", !available);
    if (available) {
      install.textContent = status === "ready" ? `Atualizar para ${result.version}` : `Instalar ${result.version}`;
      feedback.textContent = `Pacote verificado · ${formatBytes(result.size)} · v${result.version}`;
    } else {
      feedback.textContent = status === "ready" ? "Whisper já está na versão estável mais recente." : "Nenhum runtime Whisper estável disponível.";
    }
  }

  function renderQwenRuntime(result, checkedRemote = false) {
    const status = result?.status || "missing";
    const current = result?.current_version || result?.installed_version || result?.version || null;
    const detail = $("qwen-runtime-detail");
    const feedback = $("qwen-runtime-feedback");
    const install = $("install-qwen-runtime");

    if (status === "ready") detail.textContent = `Qwen runtime${current ? ` v${current}` : ""} instalado e íntegro.`;
    else if (status === "corrupt") detail.textContent = `Runtime Qwen${current ? ` v${current}` : ""} precisa de reparo.`;
    else detail.textContent = "Runtime Qwen ainda não instalado.";

    if (!checkedRemote) {
      install.classList.add("hidden");
      feedback.textContent = "O gate físico e os modelos são preparados quando você escolher um perfil Qwen.";
      return;
    }

    const available = Boolean(result?.available);
    install.classList.toggle("hidden", !available);
    if (available) {
      install.textContent = status === "ready" ? `Atualizar para ${result.version}` : `Instalar ${result.version}`;
      const parts = typeof result.part_count === "number" ? ` · ${result.part_count} parte(s)` : "";
      feedback.textContent = `Pacote verificado · ${formatBytes(result.size)}${parts} · v${result.version}`;
    } else {
      feedback.textContent = status === "ready" ? "Qwen já está na versão estável mais recente." : "Nenhum runtime Qwen estável disponível.";
    }
  }

  function connectionFamily(state) {
    if (state === "ready") return "ready";
    if (state === "reconnecting" || state === "unavailable" || state === "starting") return "recovering";
    if (state === "stopped_by_user") return "stopped";
    if (state === "port_conflict" || state === "incompatible") return "blocked";
    return "unknown";
  }

  function announceConnectionTransition(connection) {
    const state = connection?.state || "ready";
    if (lastConnectionState === null) {
      lastConnectionState = state;
      return;
    }
    const previousFamily = connectionFamily(lastConnectionState);
    const nextFamily = connectionFamily(state);
    lastConnectionState = state;
    if (previousFamily === nextFamily) return;
    if (nextFamily === "ready") {
      toast("Agent local recuperado.");
      return;
    }
    if (nextFamily === "recovering") {
      toast("Agent local indisponível. O Companion está tentando recuperar a conexão.", true);
      return;
    }
    if (nextFamily === "stopped") {
      toast("Agent local está parado e não será reiniciado automaticamente.", true);
      return;
    }
    if (nextFamily === "blocked") {
      toast(errorText(connection?.error || "AGENT_PORT_CONFLICT"), true);
    }
  }

  function renderSnapshot(value) {
    lastSnapshot = value;
    const version = value.version || "—";
    $("rail-version").textContent = `v${version}`;
    $("head-version").textContent = `v${version}`;
    $("settings-version").textContent = `TDA Companion ${version}`;

    const agent = value.agent || {};
    const connection = value.connection || { state: agent.lifecycle || "ready" };
    const connectionState = connection.state || "ready";
    const lifecycle = agent.lifecycle || connectionState || "starting";
    const queuePaused = connectionState === "ready" && lifecycle === "paused";
    const labels = {
      ready: ["● Agente local ativo", "Online"],
      starting: ["● Iniciando Agent", "Iniciando"],
      reconnecting: ["● Reconectando Agent", "Reconectando"],
      unavailable: ["● Agent indisponível", "Indisponível"],
      stopped_by_user: ["● Agent parado", "Parado"],
      port_conflict: ["● Conflito na porta local", "Conflito"],
      incompatible: ["● Agent incompatível", "Incompatível"],
    };
    const [pillText, machineText] = queuePaused
      ? ["● Fila pausada", "Pausado"]
      : labels[connectionState] || labels.starting;
    $("agent-pill").textContent = pillText;
    $("agent-pill").classList.toggle("warning", connectionState !== "ready" || queuePaused);
    $("machine-state").textContent = machineText;
    $("machine-state").classList.toggle("warning", connectionState !== "ready" || queuePaused);

    if (connectionState === "ready") {
      const mismatch = connection.compatibility === "compatible" ? ` · Agent v${connection.service_version || "?"} precisa ser reiniciado` : "";
      $("agent-detail").textContent = `TDA local · API v${agent.api_version || "1"} · 127.0.0.1:${agent.port || 8765} · ativo há ${duration(agent.uptime_seconds)}${mismatch}`;
    } else {
      const retry = Number(connection.retry_after_seconds || 0);
      const retryText = retry > 0 ? ` · nova tentativa em ${retry.toFixed(0)} s` : "";
      $("agent-detail").textContent = `${errorText(connection.error || agent.error || "AGENT_CONNECTION_FAILED")}${retryText}`;
    }
    announceConnectionTransition(connection);

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
    $("toggle-queue").textContent = queuePaused ? "Retomar fila" : "Pausar fila";
    $("toggle-queue").disabled = connectionState !== "ready";
    $("restart-agent").disabled = connectionState === "port_conflict" || connectionState === "incompatible";

    const active = (value.jobs || []).find((job) => job.status === "running");
    const preparation = value.preparation || {};
    const preparationActive = preparation.active === true || preparation.state === "running";
    const summary = $("work-summary");
    if (preparationActive) {
      summary.querySelector("h3").textContent = "Preparação de perfil em andamento";
      summary.querySelector("p").textContent =
        `${preparation.title || "Preparando runtime/modelo…"} ${preparation.detail || ""} · ${Math.round(Number(preparation.elapsed_seconds || 0))} s`.trim();
    } else if (active) {
      summary.querySelector("h3").textContent = "Processamento em andamento";
      const progress = active.progress || {};
      const stages = {
        runtime_validation: "Validando runtime e gate físico",
        source_validation: "Validando sessão local",
        model_prepare: "Preparando modelo",
        model_load: "Carregando modelo",
        transcription: "Transcrevendo áudio",
        alignment: "Alinhando palavras",
        energy_analysis: "Analisando energia entre faixas",
        cross_track_dedup: "Removendo duplicações",
        merge_timeline: "Montando linha do tempo",
        turn_building: "Organizando turnos",
        result_prepare: "Gravando resultado",
      };
      const stage = stages[active.stage] || active.stage || "Worker ativo";
      const measure = typeof progress.completed === "number" && typeof progress.total === "number"
        ? ` · ${progress.completed} de ${progress.total} ${progress.unit || "itens"}`
        : "";
      summary.querySelector("p").textContent = `${stage} · última atividade ${timeOnly(active.updated_at)}${measure}`;
    } else if (connectionState !== "ready") {
      summary.querySelector("h3").textContent = "Agent local indisponível.";
      summary.querySelector("p").textContent = "A interface continua ativa. O Companion tentará recuperar o Agent; os trabalhos persistidos permanecem no armazenamento local.";
    } else {
      summary.querySelector("h3").textContent = "Nenhum processamento em andamento.";
      summary.querySelector("p").textContent = counts.queued ? `${counts.queued} trabalho(s) aguardando na fila.` : "A fila está livre. Inicie uma nova sessão pela tela de Processamento no TDA Web.";
    }

    const settings = value.settings || {};
    $("setting-startup").checked = Boolean(settings.start_with_windows);
    $("setting-tray").checked = Boolean(settings.show_tray);
    $("setting-updates").checked = Boolean(settings.check_updates);
    $("setting-theme").value = settings.theme || "system";
    $("setting-close").value = settings.close_behavior || "hide";
    renderWhisperRuntime(value.whisper_runtime || { status: "missing" }, false);
    renderQwenRuntime(value.qwen_runtime || { status: "missing" }, false);

    const executionState = $("execution-state");
    const executionTitle = $("execution-title");
    const executionDetail = $("execution-detail");
    if (preparationActive) {
      executionState.textContent = "Preparando";
      executionState.classList.add("warning");
      executionTitle.textContent = preparation.title || "Preparando perfil de transcrição";
      executionDetail.textContent =
        `${preparation.detail || "Runtime, modelo e validações locais em andamento."} · ${Math.round(Number(preparation.elapsed_seconds || 0))} s`;
    } else if (active) {
      const progress = active.progress || {};
      const stages = {
        runtime_validation: "Validando runtime e gate físico",
        source_validation: "Validando sessão local",
        model_prepare: "Preparando modelo",
        model_load: "Carregando modelo na GPU",
        transcription: "Transcrevendo áudio",
        alignment: "Alinhando palavras",
        energy_analysis: "Analisando energia entre faixas",
        cross_track_dedup: "Removendo duplicações",
        merge_timeline: "Montando linha do tempo",
        turn_building: "Organizando turnos",
        result_prepare: "Gravando resultado",
      };
      const stage = stages[active.stage] || active.stage || "Worker ativo";
      executionState.textContent = "Processando";
      executionState.classList.add("warning");
      executionTitle.textContent = stage;
      const progressText =
        typeof progress.completed === "number" && typeof progress.total === "number"
          ? `${progress.completed} de ${progress.total} ${progress.unit || "itens"} · `
          : "";
      executionDetail.textContent =
        `${progressText}última atividade ${timeOnly(active.updated_at)} · tentativa ${active.attempt || 1}`;
    } else {
      executionState.classList.remove("warning");
      executionState.textContent = connectionState === "ready" ? "Livre" : "Indisponível";
      executionTitle.textContent =
        connectionState === "ready"
          ? counts.queued
            ? `${counts.queued} trabalho(s) aguardando na fila.`
            : "Nenhum processamento em andamento."
          : "Agent local indisponível.";
      executionDetail.textContent =
        connectionState === "ready"
          ? "Novas sessões são iniciadas no TDA Web."
          : "Os trabalhos persistidos permanecem no armazenamento local enquanto o Companion tenta recuperar o Agent.";
    }
  }

  async function refreshSnapshot() {
    if (!api) return;
    try {
      const snapshot = await api.snapshot();
      renderSnapshot(snapshot);
    } catch {
      $("agent-pill").textContent = "● Agent indisponível";
      $("agent-pill").classList.add("warning");
      $("execution-state").textContent = "Indisponível";
      $("execution-state").classList.add("warning");
      $("execution-title").textContent = "Agent local indisponível.";
      $("execution-detail").textContent =
        "Os trabalhos persistidos permanecem locais; consulte Logs ou Diagnóstico para investigar.";
    }
  }

  async function refreshLogs(announce = false) {
    if (!api) return;
    try {
      const level = $("log-level")?.value || null;
      const result = await api.logs(level, null, 300);
      if (result?.unavailable) {
        renderLogsUnavailable(result);
        if (announce) toast(`Logs indisponíveis: ${errorText(result.error)}`, true);
        return;
      }
      allLogs = Array.isArray(result.logs) ? result.logs : [];
      renderLogRows($("full-logs"), allLogs, false);
      renderLogRows($("overview-logs"), allLogs, true);
    } catch (error) {
      if (announce) toast(`Não foi possível ler os logs: ${errorText(error)}`, true);
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
      if (announce) toast(`Não foi possível verificar atualização: ${errorText(error)}`, true);
    }
  }

  async function checkWhisperRuntime(announce = false) {
    const button = $("check-whisper-runtime");
    button.disabled = true;
    try {
      const result = await api.check_whisper_runtime();
      renderWhisperRuntime(result, true);
      if (announce) toast(result.available ? `Whisper runtime ${result.version} disponível.` : "Runtime Whisper já está atualizado.");
    } catch (error) {
      if (announce) toast(`Não foi possível verificar o Whisper: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function installWhisperRuntime() {
    if (!window.confirm("Baixar e instalar o runtime Whisper isolado?")) return;
    const button = $("install-whisper-runtime");
    button.disabled = true;
    button.textContent = "Baixando e verificando…";
    try {
      const result = await api.install_whisper_runtime();
      toast(result.accepted ? `Whisper runtime ${result.version} instalado e verificado.` : "Runtime Whisper já está atualizado.");
      await refreshSnapshot();
      await checkWhisperRuntime(false);
    } catch (error) {
      toast(`O runtime Whisper não foi instalado: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function checkQwenRuntime(announce = false) {
    const button = $("check-qwen-runtime");
    button.disabled = true;
    try {
      const result = await api.check_qwen_runtime();
      renderQwenRuntime(result, true);
      if (announce) toast(result.available ? `Qwen runtime ${result.version} disponível.` : "Runtime Qwen já está atualizado.");
    } catch (error) {
      if (announce) toast(`Não foi possível verificar o Qwen: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  async function installQwenRuntime() {
    if (!window.confirm("Baixar e instalar o runtime Qwen isolado? Os modelos e o gate físico serão preparados somente ao processar uma sessão.")) return;
    const button = $("install-qwen-runtime");
    button.disabled = true;
    button.textContent = "Baixando e verificando…";
    try {
      const result = await api.install_qwen_runtime();
      toast(result.accepted ? `Qwen runtime ${result.version} instalado e verificado.` : "Runtime Qwen já está atualizado.");
      await refreshSnapshot();
      await checkQwenRuntime(false);
    } catch (error) {
      toast(`O runtime Qwen não foi instalado: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function renderDiagnostics(result) {
    $("diagnostic-overall").textContent = result.overall === "pass" ? "Tudo certo" : result.overall === "warning" ? "Atenção recomendada" : "Problema encontrado";
    $("diagnostic-time").textContent = result.generated_at ? new Date(result.generated_at).toLocaleString("pt-BR") : "—";
    const target = $("diagnostic-list");
    target.replaceChildren();
    (result.checks || []).forEach((check) => {
      const row = document.createElement("div");
      row.className = "diagnostic-row";
      const dot = document.createElement("i");
      dot.className = `diagnostic-status ${check.status || ""}`;
      const code = document.createElement("b");
      code.textContent = check.code || "check";
      const message = document.createElement("span");
      message.textContent = check.message || "—";
      const detail = document.createElement("small");
      detail.textContent = check.detail || check.status || "—";
      row.append(dot, code, message, detail);
      target.append(row);
    });
  }

  async function runDiagnostics() {
    try {
      renderDiagnostics(await api.diagnostics());
    } catch (error) {
      toast(`Diagnóstico falhou: ${errorText(error)}`, true);
    }
  }

  async function updateSetting(key, value) {
    try {
      await api.update_settings({ [key]: value });
      await refreshSnapshot();
    } catch (error) {
      toast(`Não foi possível salvar: ${errorText(error)}`, true);
    }
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
      toast(`A atualização não foi iniciada: ${errorText(error)}`, true);
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
      toast(`A desinstalação não foi iniciada: ${errorText(error)}`, true);
    }
  }

  function bindEvents() {
    document.querySelectorAll(".nav-item").forEach((node) => {
      node.addEventListener("click", () => showView(node.dataset.view));
    });
    document.querySelectorAll("[data-go]").forEach((node) => {
      node.addEventListener("click", () => showView(node.dataset.go));
    });
    $("new-session").addEventListener("click", () => api.open_tda());
    $("open-processing-web").addEventListener("click", () => api.open_tda());
    $("execution-open-logs").addEventListener("click", () => showView("logs"));
    $("open-tda").addEventListener("click", () => api.open_tda());
    $("open-local").addEventListener("click", () => api.open_local_folder());
    $("open-logs").addEventListener("click", () => api.open_logs_folder());
    $("toggle-queue").addEventListener("click", async () => {
      try {
        await api.set_queue_paused(lastSnapshot?.agent?.lifecycle !== "paused");
        await refreshSnapshot();
      } catch (error) {
        toast(`Não foi possível alterar a fila: ${errorText(error)}`, true);
      }
    });
    $("restart-agent").addEventListener("click", async () => {
      if (!window.confirm("Reiniciar o Agent local? A ação é bloqueada se houver trabalho em execução.")) return;
      try {
        await api.restart_agent();
        toast("Agent reiniciado.");
        await refreshSnapshot();
      } catch (error) {
        toast(`Não foi possível reiniciar: ${errorText(error)}`, true);
      }
    });
    $("quick-diagnostics").addEventListener("click", () => {
      showView("diagnostics");
      runDiagnostics();
    });
    $("run-diagnostics").addEventListener("click", runDiagnostics);
    $("export-diagnostics").addEventListener("click", async () => {
      try {
        const path = await api.export_diagnostics();
        toast(`Diagnóstico exportado: ${path}`);
      } catch (error) {
        toast(`Export falhou: ${errorText(error)}`, true);
      }
    });
    $("refresh-logs").addEventListener("click", () => refreshLogs(true));
    $("log-level").addEventListener("change", () => refreshLogs(true));
    $("log-search").addEventListener("input", () => renderLogRows($("full-logs"), allLogs, false));
    $("setting-startup").addEventListener("change", (event) => updateSetting("start_with_windows", event.target.checked));
    $("setting-tray").addEventListener("change", (event) => updateSetting("show_tray", event.target.checked));
    $("setting-updates").addEventListener("change", (event) => updateSetting("check_updates", event.target.checked));
    $("setting-theme").addEventListener("change", (event) => updateSetting("theme", event.target.value));
    $("setting-close").addEventListener("change", (event) => updateSetting("close_behavior", event.target.value));
    $("check-whisper-runtime").addEventListener("click", () => checkWhisperRuntime(true));
    $("install-whisper-runtime").addEventListener("click", installWhisperRuntime);
    $("check-qwen-runtime").addEventListener("click", () => checkQwenRuntime(true));
    $("install-qwen-runtime").addEventListener("click", installQwenRuntime);
    $("check-update").addEventListener("click", () => checkUpdate(true));
    $("install-update").addEventListener("click", installUpdate);
    $("update-banner").addEventListener("click", () => {
      showView("settings");
      checkUpdate(true);
    });
    $("uninstall-keep").addEventListener("click", () => uninstall(false));
    $("uninstall-purge").addEventListener("click", () => uninstall(true));
  }

  async function boot() {
    api = window.pywebview?.api;
    if (!api) return;
    bindEvents();
    await refreshSnapshot();
    await refreshLogs(false);
    if (lastSnapshot?.settings?.check_updates) {
      checkUpdate(false);
      checkWhisperRuntime(false);
      checkQwenRuntime(false);
    }
    refreshTimer = window.setInterval(async () => {
      await refreshSnapshot();
      if (document.visibilityState === "visible") await refreshLogs(false);
    }, 3000);
  }

  window.addEventListener("pywebviewready", boot, { once: true });
  window.addEventListener("beforeunload", () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
  });
})();
