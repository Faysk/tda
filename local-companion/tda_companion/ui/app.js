(() => {
  const $ = (id) => document.getElementById(id);
  let api = null;
  let lastSnapshot = null;
  let allLogs = [];
  let refreshTimer = null;
  let lastConnectionState = null;
  let lastWhisperRuntimeCheck = null;
  let lastQwenRuntimeCheck = null;
  let lastUpdateCheck = null;
  let maintenanceDialogState = null;
  let maintenanceDialogBusy = false;

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
    RUNTIME_UPDATE_BLOCKED_BY_RUNTIME_MAINTENANCE: "O runtime Whisper já está em manutenção. Aguarde a operação terminar.",
    RUNTIME_ROLLBACK_BLOCKED_BY_RUNNING_JOB: "O rollback do Whisper está bloqueado enquanto há trabalho na fila ou em execução.",
    RUNTIME_ROLLBACK_BLOCKED_BY_TRANSCRIPTION_PREPARATION: "O rollback do Whisper está bloqueado durante a preparação de um perfil.",
    RUNTIME_ROLLBACK_BLOCKED_BY_RUNTIME_MAINTENANCE: "O rollback do Whisper está bloqueado enquanto outro runtime está em manutenção.",
    WHISPER_RUNTIME_ROLLBACK_TARGET_INVALID: "A versão preservada está corrompida ou não corresponde ao marker. O runtime atual foi mantido.",
    WHISPER_RUNTIME_ROLLBACK_TARGET_NOT_OLDER: "Escolha uma versão Whisper anterior à atualmente ativa.",
    WHISPER_RUNTIME_ROLLBACK_TARGET_INCOMPATIBLE: "Essa versão Whisper é antiga demais para este Companion.",
    WHISPER_RUNTIME_ROLLBACK_MAINTENANCE_BUSY: "O runtime Whisper já está em manutenção. Aguarde e tente novamente.",
    WHISPER_RUNTIME_ROLLBACK_CURRENT_INVALID: "O runtime Whisper atual não passou na verificação de integridade; o rollback foi bloqueado.",
    WHISPER_RUNTIME_ROLLBACK_VERIFY_FAILED: "A versão escolhida não ficou íntegra após a troca. O runtime anterior foi restaurado.",
    WHISPER_RUNTIME_ROLLBACK_RESTORE_FAILED: "A recuperação automática do seletor falhou. Não inicie uma nova transcrição antes de executar o diagnóstico.",
    WHISPER_RUNTIME_ROLLBACK_MANIFEST_MISMATCH: "A release retornada não corresponde exatamente à versão solicitada.",
    WHISPER_RUNTIME_ROLLBACK_VERSION_INVALID: "Informe uma versão exata no formato X.Y.Z.",
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

  function compareSemver(left, right) {
    const parse = (value) => {
      if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) return null;
      return value.split(".").map((part) => Number.parseInt(part, 10));
    };
    const a = parse(left);
    const b = parse(right);
    if (!a || !b) return null;
    for (let index = 0; index < 3; index += 1) {
      if (a[index] < b[index]) return -1;
      if (a[index] > b[index]) return 1;
    }
    return 0;
  }

  function setMaintenanceDialogMessage(kind, message) {
    const node = $("maintenance-dialog-" + kind);
    if (!node) return;
    const visible = Boolean(message);
    node.textContent = visible ? String(message) : "";
    node.classList.toggle("hidden", !visible);
  }

  function updateMaintenanceTarget() {
    const state = maintenanceDialogState;
    if (!state?.versionField) return;
    const value = $("maintenance-dialog-version").value.trim();
    $("maintenance-dialog-target-version").textContent = value ? "v" + value : "—";
  }

  function updateMaintenanceDialogControls() {
    const state = maintenanceDialogState;
    if (!state) return;
    const cancel = $("maintenance-dialog-cancel");
    const confirm = $("maintenance-dialog-confirm");
    const version = $("maintenance-dialog-version");
    const danger = $("maintenance-dialog-danger");
    const dangerMismatch = Boolean(
      state.dangerPhrase && danger.value.trim() !== state.dangerPhrase,
    );
    cancel.disabled = maintenanceDialogBusy;
    version.disabled = maintenanceDialogBusy;
    danger.disabled = maintenanceDialogBusy;
    confirm.disabled = maintenanceDialogBusy || dangerMismatch;
  }

  function renderMaintenanceVersionOptions(candidates) {
    const container = $("maintenance-dialog-local-versions");
    const list = $("maintenance-dialog-version-options");
    list.replaceChildren();
    const versions = Array.isArray(candidates)
      ? candidates.filter((value) => typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value))
      : [];
    container.classList.toggle("hidden", versions.length === 0);
    versions.forEach((version) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "maintenance-version-option";
      button.textContent = "v" + version;
      button.addEventListener("click", () => {
        if (maintenanceDialogBusy) return;
        $("maintenance-dialog-version").value = version;
        updateMaintenanceTarget();
        setMaintenanceDialogMessage("error", "");
        $("maintenance-dialog-version").focus();
      });
      list.append(button);
    });
  }

  function closeMaintenanceDialog() {
    if (maintenanceDialogBusy) return;
    const dialog = $("maintenance-dialog");
    const trigger = maintenanceDialogState?.trigger || null;
    maintenanceDialogState = null;
    setMaintenanceDialogMessage("error", "");
    setMaintenanceDialogMessage("status", "");
    if (dialog?.open) {
      if (typeof dialog.close === "function") dialog.close();
      else {
        dialog.open = false;
        dialog.removeAttribute?.("open");
      }
    }
    if (trigger && typeof trigger.focus === "function" && trigger.isConnected !== false) {
      trigger.focus();
    }
  }

  function openMaintenanceDialog(config) {
    const dialog = $("maintenance-dialog");
    const form = $("maintenance-dialog-form");
    if (!dialog || !form) return;
    if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute?.("open");
    }

    maintenanceDialogState = config;
    maintenanceDialogBusy = false;
    $("maintenance-dialog-title").textContent = config.title;
    $("maintenance-dialog-description").textContent = config.description || "";
    $("maintenance-dialog-effect").textContent = config.effect || "";
    $("maintenance-dialog-confirm").textContent = config.confirmLabel || "Confirmar";
    $("maintenance-dialog-confirm").classList.toggle("danger", config.danger === true);
    $("maintenance-dialog-confirm").classList.toggle("primary", config.danger !== true);

    const showVersions = Boolean(config.showVersions || config.versionField);
    $("maintenance-dialog-version-summary").classList.toggle("hidden", !showVersions);
    $("maintenance-dialog-current-version").textContent = config.currentVersion ? "v" + config.currentVersion : "—";
    $("maintenance-dialog-target-version").textContent = config.targetVersion ? "v" + config.targetVersion : "—";

    const versionField = $("maintenance-dialog-version-field");
    const versionInput = $("maintenance-dialog-version");
    versionField.classList.toggle("hidden", !config.versionField);
    versionInput.value = config.versionValue || config.targetVersion || "";

    const dangerField = $("maintenance-dialog-danger-field");
    const dangerInput = $("maintenance-dialog-danger");
    dangerField.classList.toggle("hidden", !config.dangerPhrase);
    dangerInput.value = "";

    renderMaintenanceVersionOptions(config.versionCandidates || []);
    updateMaintenanceTarget();
    setMaintenanceDialogMessage("error", "");
    setMaintenanceDialogMessage("status", "");
    updateMaintenanceDialogControls();

    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.open = true;
      dialog.setAttribute?.("open", "");
    }
    $("maintenance-dialog-cancel").focus();
  }

  function validateMaintenanceDialog() {
    const state = maintenanceDialogState;
    if (!state) return null;
    const values = {};

    if (state.versionField) {
      const version = $("maintenance-dialog-version").value.trim();
      if (!/^\d+\.\d+\.\d+$/.test(version)) {
        setMaintenanceDialogMessage("error", errorText("WHISPER_RUNTIME_ROLLBACK_VERSION_INVALID"));
        $("maintenance-dialog-version").focus();
        return null;
      }
      const order = state.currentVersion ? compareSemver(version, state.currentVersion) : null;
      if (order !== null && order >= 0) {
        setMaintenanceDialogMessage("error", "Escolha uma versão Whisper anterior à atualmente ativa.");
        $("maintenance-dialog-version").focus();
        return null;
      }
      values.version = version;
    }

    if (state.dangerPhrase) {
      const phrase = $("maintenance-dialog-danger").value.trim();
      if (phrase !== state.dangerPhrase) {
        setMaintenanceDialogMessage("error", "Digite " + state.dangerPhrase + " para confirmar a remoção completa.");
        $("maintenance-dialog-danger").focus();
        return null;
      }
      values.dangerPhrase = phrase;
    }

    setMaintenanceDialogMessage("error", "");
    return values;
  }

  async function submitMaintenanceDialog(event) {
    event?.preventDefault?.();
    if (!maintenanceDialogState || maintenanceDialogBusy) return;
    const values = validateMaintenanceDialog();
    if (!values) return;

    const state = maintenanceDialogState;
    maintenanceDialogBusy = true;
    setMaintenanceDialogMessage("error", "");
    setMaintenanceDialogMessage("status", state.pendingLabel || "Executando…");
    updateMaintenanceDialogControls();

    try {
      const result = await state.execute(values);
      const closeDesktop = (await state.onSuccess?.(result, values)) === true;
      maintenanceDialogBusy = false;
      updateMaintenanceDialogControls();
      closeMaintenanceDialog();
      if (closeDesktop && api?.close_desktop) {
        Promise.resolve(api.close_desktop()).catch((error) => {
          toast("A operação foi iniciada, mas a janela não fechou: " + errorText(error), true);
        });
      }
    } catch (error) {
      maintenanceDialogBusy = false;
      setMaintenanceDialogMessage("status", "");
      const prefix = state.errorPrefix ? state.errorPrefix + ": " : "";
      setMaintenanceDialogMessage("error", prefix + errorText(error));
      updateMaintenanceDialogControls();
    }
  }

  function focusableMaintenanceDialogNodes() {
    const dialog = $("maintenance-dialog");
    if (!dialog?.querySelectorAll) return [];
    return Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => !node.hidden && !node.classList?.contains("hidden"));
  }

  function handleMaintenanceDialogKeydown(event) {
    if (!maintenanceDialogState) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (!maintenanceDialogBusy) closeMaintenanceDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableMaintenanceDialogNodes();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindMaintenanceDialog() {
    const dialog = $("maintenance-dialog");
    const form = $("maintenance-dialog-form");
    if (!dialog || !form) return;
    form.addEventListener("submit", submitMaintenanceDialog);
    $("maintenance-dialog-cancel").addEventListener("click", closeMaintenanceDialog);
    $("maintenance-dialog-version").addEventListener("input", () => {
      updateMaintenanceTarget();
      setMaintenanceDialogMessage("error", "");
    });
    $("maintenance-dialog-danger").addEventListener("input", () => {
      setMaintenanceDialogMessage("error", "");
      updateMaintenanceDialogControls();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!maintenanceDialogBusy) closeMaintenanceDialog();
    });
    dialog.addEventListener("keydown", handleMaintenanceDialogKeydown);
    dialog.addEventListener("mousedown", (event) => {
      if (event.target === dialog && !maintenanceDialogBusy) closeMaintenanceDialog();
    });
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
    if (!checkedRemote && lastWhisperRuntimeCheck) {
      if (result?.status === "ready" && result.version === lastWhisperRuntimeCheck.current_version) {
        result = lastWhisperRuntimeCheck;
        checkedRemote = true;
      } else {
        lastWhisperRuntimeCheck = null;
      }
    }
    const status = result?.status || "missing";
    const current = result?.current_version || result?.version || null;
    const detail = $("whisper-runtime-detail");
    const feedback = $("whisper-runtime-feedback");
    const install = $("install-whisper-runtime");
    const rollback = $("rollback-whisper-runtime");

    if (status === "ready") detail.textContent = `Whisper runtime${current ? ` v${current}` : ""} instalado e íntegro.`;
    else if (status === "corrupt") detail.textContent = `Runtime Whisper${current ? ` v${current}` : ""} precisa de reparo.`;
    else detail.textContent = "Runtime Whisper ainda não instalado.";

    if (!checkedRemote) {
      install.classList.add("hidden");
      rollback.classList.toggle("hidden", status !== "ready");
      feedback.textContent = "Runtime isolado; não altera o PATH global.";
      return;
    }

    const available = Boolean(result?.available);
    install.classList.toggle("hidden", !available);
    rollback.classList.toggle("hidden", status !== "ready");
    if (available) {
      install.textContent = status === "ready" ? `Atualizar para ${result.version}` : `Instalar ${result.version}`;
      feedback.textContent = `Pacote verificado · ${formatBytes(result.size)} · v${result.version}`;
    } else {
      feedback.textContent = status === "ready" ? "Nenhuma atualização automática disponível. Você pode reverter a versão manualmente." : "Nenhum runtime Whisper estável disponível.";
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
    lastUpdateCheck = result || null;
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
      lastWhisperRuntimeCheck = result;
      renderWhisperRuntime(result, true);
      if (announce) toast(result.available ? `Whisper runtime ${result.version} disponível.` : "Runtime Whisper já está atualizado.");
    } catch (error) {
      if (announce) toast(`Não foi possível verificar o Whisper: ${errorText(error)}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function installWhisperRuntime(event) {
    const currentVersion =
      lastWhisperRuntimeCheck?.current_version ||
      lastSnapshot?.whisper_runtime?.version ||
      null;
    const targetVersion = lastWhisperRuntimeCheck?.version || null;
    openMaintenanceDialog({
      trigger: event?.currentTarget || $("install-whisper-runtime"),
      title: currentVersion ? "Atualizar runtime Whisper?" : "Instalar runtime Whisper?",
      description: "O Companion baixa e verifica o runtime isolado antes de ativá-lo.",
      effect: "Nenhum runtime será trocado antes desta confirmação. Modelos, dados e runs locais permanecem preservados.",
      confirmLabel: currentVersion ? "Atualizar Whisper" : "Instalar Whisper",
      pendingLabel: "Baixando e verificando o runtime Whisper…",
      currentVersion,
      targetVersion,
      showVersions: Boolean(currentVersion || targetVersion),
      execute: () => api.install_whisper_runtime(),
      onSuccess: async (result) => {
        toast(result.accepted ? "Whisper runtime " + result.version + " instalado e verificado." : "Runtime Whisper já está atualizado.");
        await refreshSnapshot();
        await checkWhisperRuntime(false);
        return false;
      },
      errorPrefix: "O runtime Whisper não foi instalado",
    });
  }

  function rollbackWhisperRuntime(event) {
    const candidates = Array.isArray(lastWhisperRuntimeCheck?.rollback_versions)
      ? lastWhisperRuntimeCheck.rollback_versions
      : [];
    const currentVersion =
      lastWhisperRuntimeCheck?.current_version ||
      lastSnapshot?.whisper_runtime?.version ||
      null;
    openMaintenanceDialog({
      trigger: event?.currentTarget || $("rollback-whisper-runtime"),
      title: "Reverter runtime Whisper",
      description: "Escolha uma versão anterior exata. Versões locais verificadas aparecem como atalhos quando disponíveis.",
      effect: "O runtime atual, modelos, dados e runs serão preservados. Se os bytes não estiverem locais, o Companion buscará somente a release Stable exata.",
      confirmLabel: "Reverter Whisper",
      pendingLabel: "Verificando e reativando o runtime Whisper…",
      currentVersion,
      targetVersion: candidates[0] || null,
      showVersions: true,
      versionField: true,
      versionValue: candidates[0] || "",
      versionCandidates: candidates,
      execute: ({ version }) => api.rollback_whisper_runtime(version),
      onSuccess: async (result) => {
        toast("Whisper revertido de v" + result.previous_version + " para v" + result.version + ".");
        await refreshSnapshot();
        await checkWhisperRuntime(false);
        return false;
      },
      errorPrefix: "Rollback Whisper não realizado",
    });
  }

  async function checkQwenRuntime(announce = false) {
    const button = $("check-qwen-runtime");
    button.disabled = true;
    try {
      const result = await api.check_qwen_runtime();
      lastQwenRuntimeCheck = result;
      renderQwenRuntime(result, true);
      if (announce) toast(result.available ? "Qwen runtime " + result.version + " disponível." : "Runtime Qwen já está atualizado.");
    } catch (error) {
      if (announce) toast("Não foi possível verificar o Qwen: " + errorText(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function installQwenRuntime(event) {
    const currentVersion =
      lastQwenRuntimeCheck?.current_version ||
      lastQwenRuntimeCheck?.installed_version ||
      lastSnapshot?.qwen_runtime?.version ||
      null;
    const targetVersion = lastQwenRuntimeCheck?.version || null;
    openMaintenanceDialog({
      trigger: event?.currentTarget || $("install-qwen-runtime"),
      title: currentVersion ? "Atualizar runtime Qwen?" : "Instalar runtime Qwen?",
      description: "O Companion baixa e verifica o runtime Qwen isolado antes de ativá-lo.",
      effect: "Modelos e o gate físico só serão preparados quando uma sessão Qwen for processada. Dados e runs existentes não são alterados.",
      confirmLabel: currentVersion ? "Atualizar Qwen" : "Instalar Qwen",
      pendingLabel: "Baixando e verificando o runtime Qwen…",
      currentVersion,
      targetVersion,
      showVersions: Boolean(currentVersion || targetVersion),
      execute: () => api.install_qwen_runtime(),
      onSuccess: async (result) => {
        toast(result.accepted ? "Qwen runtime " + result.version + " instalado e verificado." : "Runtime Qwen já está atualizado.");
        await refreshSnapshot();
        await checkQwenRuntime(false);
        return false;
      },
      errorPrefix: "O runtime Qwen não foi instalado",
    });
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

  function installUpdate(event) {
    const currentVersion = lastSnapshot?.version || null;
    const targetVersion = lastUpdateCheck?.version || null;
    openMaintenanceDialog({
      trigger: event?.currentTarget || $("install-update"),
      title: "Atualizar TDA Companion?",
      description: "O pacote será baixado e verificado antes da manutenção ser entregue ao helper.",
      effect: "O Agent só será reiniciado se não houver trabalho ou preparação em execução. State, Data e Models são preservados.",
      confirmLabel: targetVersion ? "Atualizar para " + targetVersion : "Atualizar Companion",
      pendingLabel: "Preparando atualização do Companion…",
      currentVersion,
      targetVersion,
      showVersions: Boolean(currentVersion || targetVersion),
      execute: () => api.install_update(),
      onSuccess: async (result) => {
        if (!result.accepted) {
          renderUpdate(result);
          toast("Você já está na versão mais recente.");
          return false;
        }
        toast("Atualizando para " + result.version + "…");
        return true;
      },
      errorPrefix: "A atualização não foi iniciada",
    });
  }

  function uninstall(purge, event) {
    const destructive = Boolean(purge);
    openMaintenanceDialog({
      trigger: event?.currentTarget || $(destructive ? "uninstall-purge" : "uninstall-keep"),
      title: destructive ? "Remover TDA Companion e todos os dados locais?" : "Desinstalar TDA Companion?",
      description: destructive
        ? "Esta remoção apaga fila, resultados, modelos, logs e configurações locais deste usuário."
        : "O aplicativo será removido, mas seus dados locais serão mantidos para uma futura reinstalação.",
      effect: destructive
        ? "Esta ação não pode ser desfeita. Nenhuma remoção começa antes da confirmação final abaixo."
        : "State, Data, Models e demais dados locais permanecem no computador.",
      confirmLabel: destructive ? "Remover completamente" : "Desinstalar e manter dados",
      pendingLabel: destructive ? "Preparando remoção completa…" : "Preparando desinstalação…",
      danger: destructive,
      dangerPhrase: destructive ? "REMOVER" : null,
      execute: () => api.uninstall(destructive),
      onSuccess: async (result) => {
        if (result.accepted) {
          toast(destructive ? "Removendo completamente o TDA Companion…" : "Desinstalando o TDA Companion…");
          return true;
        }
        toast("Nenhuma desinstalação foi iniciada.");
        return false;
      },
      errorPrefix: "A desinstalação não foi iniciada",
    });
  }

  function restartAgent(event) {
    openMaintenanceDialog({
      trigger: event?.currentTarget || $("restart-agent"),
      title: "Reiniciar Agent local?",
      description: "Use esta ação para recuperar a conexão local sem reiniciar o Companion inteiro.",
      effect: "O backend bloqueia o reinício durante preparação ou trabalho incompatível. A fila persistida não é apagada.",
      confirmLabel: "Reiniciar Agent",
      pendingLabel: "Reiniciando o Agent local…",
      execute: () => api.restart_agent(),
      onSuccess: async () => {
        toast("Agent reiniciado.");
        await refreshSnapshot();
        return false;
      },
      errorPrefix: "Não foi possível reiniciar",
    });
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
    $("restart-agent").addEventListener("click", restartAgent);
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
    $("rollback-whisper-runtime").addEventListener("click", rollbackWhisperRuntime);
    $("check-qwen-runtime").addEventListener("click", () => checkQwenRuntime(true));
    $("install-qwen-runtime").addEventListener("click", installQwenRuntime);
    $("check-update").addEventListener("click", () => checkUpdate(true));
    $("install-update").addEventListener("click", installUpdate);
    $("update-banner").addEventListener("click", () => {
      showView("settings");
      checkUpdate(true);
    });
    $("uninstall-keep").addEventListener("click", (event) => uninstall(false, event));
    $("uninstall-purge").addEventListener("click", (event) => uninstall(true, event));
  }

  async function boot() {
    api = window.pywebview?.api;
    if (!api) return;
    bindMaintenanceDialog();
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
