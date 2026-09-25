"use client";

import {
	type DragEvent,
	type FormEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	LocalBridge,
	localBridgePaired,
	subscribeLocalBridgePairing,
} from "./bridge";
import {
	BridgeError,
	type Capabilities,
	type CraigSource,
	type PreparationStatus,
	type TranscriptionProfileId,
} from "./protocol";
import { PROCESSING_REFRESH_POLICY } from "./refresh-policy";
import {
	craigTranscriptionRequestByteLength,
	LOCAL_JSON_BODY_MAX_BYTES,
	TRANSCRIPTION_TEXT_MAX_CHARS,
	truncateUnicodeScalars,
} from "./request-budget";
import styles from "./submission.module.css";

const profileLabels: Record<TranscriptionProfileId, string> = {
	"whisper-turbo": "Whisper Turbo",
	"whisper-detailed": "Whisper Detalhado",
	"qwen-fast": "Qwen Fast",
	"qwen-quality": "Qwen Quality",
};

type SubmissionPhase = "idle" | "validating" | "preparing" | "submitting";

function formatFileSize(value: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function validateCraigFile(value: File | null): string | null {
	if (!value) return null;
	if (!value.name.toLowerCase().endsWith(".zip"))
		return "Escolha um arquivo .zip exportado pelo Craig.";
	if (value.size <= 0) return "O ZIP selecionado está vazio.";
	return null;
}

function engineLabel(value: "whisper" | "qwen3"): string {
	return value === "qwen3" ? "Qwen3-ASR" : "Whisper";
}

function messageFor(code: string): string {
	return {
		unauthorized: "A sessão local expirou. O TDA tentará reconectar ao Companion.",
		forbidden: "O Companion recusou esta origem.",
		conflict: "O Companion recusou a operação no estado atual.",
		timeout: "A operação local excedeu o tempo esperado. Confira a fila antes de repetir.",
		unreachable: "Não foi possível alcançar o Companion local.",
		invalid_response: "O Companion respondeu com um contrato inválido.",
		payload_too_large:
			"Contexto e glossário excedem o orçamento UTF-8 aceito pelo Companion. Reduza o texto antes de enviar.",
		api_incompatible: "A API do Companion não suporta este fluxo. Atualize o aplicativo local.",
		version_incompatible: "A versão do Companion é antiga demais para este fluxo. Atualize o aplicativo local.",
		session_incompatible: "O Companion não oferece a sessão automática exigida por este fluxo. Atualize o aplicativo local.",
		incompatible: "O Companion não suporta este fluxo. Atualize o aplicativo local.",
		service_error: "O Companion encontrou uma falha local.",
	}[code] ?? "Falha local inesperada.";
}

function localOperationMessage(code: string | null): string {
	if (!code) return "A operação local não foi concluída.";
	if (code === "CRAIG_ARCHIVE_INVALID")
		return "O arquivo não é um ZIP Craig válido ou está corrompido.";
	if (code === "CRAIG_ARCHIVE_NO_TRACKS")
		return "O ZIP não contém tracks FLAC reconhecidas do Craig.";
	if (
		code.startsWith("CRAIG_ARCHIVE_") ||
		code.startsWith("CRAIG_TRACK_")
	)
		return "O ZIP Craig foi recusado por formato, limites ou segurança. Exporte a sessão novamente e tente com o arquivo original.";
	return {
		TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
			"Já existe outra preparação em andamento neste computador.",
		TRANSCRIPTION_PREPARATION_CANCELLED:
			"A preparação local foi cancelada antes de terminar.",
		TRANSCRIPTION_PREPARATION_TIMEOUT:
			"A preparação local atingiu o limite de 2 horas e foi encerrada.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB:
			"Já existe um trabalho local na fila ou em execução. Aguarde antes de preparar outro perfil.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB:
			"Espere o trabalho atual terminar antes de preparar outro perfil.",
		TRANSCRIPTION_WORK_ALREADY_ACTIVE:
			"Já existe uma transcrição equivalente na fila ou em execução.",
		CRAIG_STAGING_REPAIR_BLOCKED_BY_RUNNING_JOB:
			"Essa fonte está em uso pelo processamento ou pela preparação local. Aguarde terminar antes de reimportar o ZIP.",
		CRAIG_STAGING_REPAIR_FAILED:
			"O Companion tentou reparar a cópia local da sessão, mas não conseguiu concluir a troca segura.",
		CRAIG_STAGING_EXISTING_INVALID:
			"A cópia local dessa sessão está inconsistente. Reenvie o ZIP original quando a fonte não estiver em uso.",
		CRAIG_MANIFEST_TRACK_HASH_MISMATCH:
			"Uma faixa da cópia local foi alterada. Reenvie o ZIP original para reparar a sessão.",
		CRAIG_MANIFEST_TRACK_SIZE_MISMATCH:
			"Uma faixa da cópia local mudou de tamanho. Reenvie o ZIP original para reparar a sessão.",
		CRAIG_UPLOAD_STORAGE_FAILED:
			"O Companion não conseguiu gravar o ZIP no armazenamento local.",
		CRAIG_UPLOAD_SIZE_LIMIT:
			"O ZIP ultrapassa o limite aceito pelo Companion.",
		CRAIG_UPLOAD_EMPTY:
			"O ZIP recebido pelo Companion está vazio.",
		CRAIG_SOURCE_CHANGED:
			"O arquivo mudou durante o envio. Selecione o ZIP original novamente.",
		CRAIG_SOURCE_ID_COLLISION:
			"O conteúdo colidiu com uma fonte local diferente. Reimporte o ZIP original antes de continuar.",
		CRAIG_ZIP_REQUIRED:
			"Escolha um arquivo ZIP exportado pelo Craig.",
		QWEN_PHYSICAL_ACCEPTANCE_REQUIRED:
			"O Qwen precisa ser preparado e validado novamente nesta GPU antes de entrar na fila.",
		WHISPER_MODEL_PREPARATION_REQUIRED:
			"O modelo Whisper precisa ser preparado novamente antes de entrar na fila.",
		QWEN_CUDA_UNAVAILABLE:
			"O Qwen não encontrou CUDA disponível nesta máquina.",
		QWEN_CUDA_DRIVER_INCOMPATIBLE:
			"O driver NVIDIA não consegue executar o runtime CUDA exigido pelo Qwen.",
		QWEN_CUDA_EXECUTION_FAILED:
			"A GPU foi encontrada, mas uma operação CUDA real falhou.",
		QWEN_ASR_GPU_MEMORY_EXHAUSTED:
			"O Qwen ficou sem VRAM durante a validação local.",
		QWEN_ACCEPTANCE_AUDIO_TOO_SHORT:
			"Nenhuma faixa do ZIP possui áudio útil suficiente para validar o Qwen.",
		QWEN_ACCEPTANCE_NO_SPEECH_RECOGNIZED:
			"A amostra local escolhida não teve fala suficiente para validar o Qwen.",
		QWEN_MODEL_DOWNLOAD_FAILED:
			"Não foi possível baixar o modelo Qwen.",
		QWEN_RUNTIME_UNAVAILABLE:
			"O runtime Qwen compatível ainda não está disponível.",
		WHISPER_RUNTIME_UNAVAILABLE:
			"O runtime Whisper compatível ainda não está disponível.",
		WHISPER_MODEL_DOWNLOAD_FAILED:
			"Não foi possível baixar o modelo Whisper.",
		WHISPER_MODEL_PREPARATION_TIMEOUT:
			"A preparação do modelo Whisper excedeu o limite de tempo.",
		BODY_TOO_LARGE:
			"Contexto e glossário excedem o orçamento UTF-8 aceito pelo Companion. Reduza o texto antes de enviar.",
	}[code] ?? `Operação local não concluída · ${code}`;
}

type PendingSubmission = {
	key: string;
	signature: string;
};

function sourceMustBeRestaged(code: string | null): boolean {
	if (!code) return false;
	return (
		code.startsWith("CRAIG_MANIFEST_") ||
		code === "CRAIG_STAGING_EXISTING_INVALID" ||
		code === "CRAIG_STAGING_REPAIR_FAILED"
	);
}

export function ProcessingSubmission({
	className,
	compact = false,
}: Readonly<{ className?: string; compact?: boolean }> = {}) {
	const paired = useSyncExternalStore(
		subscribeLocalBridgePairing,
		localBridgePaired,
		() => false,
	);
	const [bridge] = useState(() => new LocalBridge());
	const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
	const [profile, setProfile] = useState<TranscriptionProfileId | "">("");
	const [sessionId, setSessionId] = useState("");
	const [context, setContext] = useState("");
	const [glossary, setGlossary] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [busy, setBusy] = useState(false);
	const [phase, setPhase] = useState<SubmissionPhase>("idle");
	const [dragging, setDragging] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [capabilityError, setCapabilityError] = useState<string | null>(null);
	const request = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const pending = useRef<PendingSubmission | null>(null);

	useEffect(() => {
		return () => request.current?.abort();
	}, []);

	useEffect(() => {
		if (!paired) {
			request.current?.abort();
			setCapabilities(null);
			setProfile("");
			setCapabilityError(null);
			return;
		}

		const controller = new AbortController();
		let reading = false;
		let stopped = false;
		const refreshCapabilities = async () => {
			if (reading || stopped || controller.signal.aborted) return;
			reading = true;
			try {
				const value = await bridge.capabilities(controller.signal);
				if (stopped || controller.signal.aborted) return;
				setCapabilities(value);
				const choices = value.transcription.catalog.length
					? value.transcription.catalog.map((item) => item.id)
					: value.transcription.profiles;
				setProfile((current) =>
					current && choices.includes(current)
						? current
						: choices.includes("qwen-quality")
							? "qwen-quality"
							: (choices[0] ?? ""),
				);
				setCapabilityError(null);
			} catch (cause) {
				if (!stopped && !controller.signal.aborted) {
					setCapabilityError(messageFor(cause instanceof BridgeError ? cause.code : "service_error"));
				}
			} finally {
				reading = false;
			}
		};

		void refreshCapabilities();
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refreshCapabilities();
		}, PROCESSING_REFRESH_POLICY.capabilitiesPollMs);
		const visible = () => {
			if (document.visibilityState === "visible") void refreshCapabilities();
		};
		document.addEventListener("visibilitychange", visible);
		return () => {
			stopped = true;
			window.clearInterval(timer);
			document.removeEventListener("visibilitychange", visible);
			controller.abort();
		};
	}, [bridge, paired]);

	const availableProfiles = useMemo(
		() =>
			capabilities?.transcription.catalog.length
				? capabilities.transcription.catalog
				: (capabilities?.transcription.profiles ?? []).map((id) => ({
						id,
						engine: id.startsWith("qwen-")
							? ("qwen3" as const)
							: ("whisper" as const),
						ready: true,
						preparationRequired: false,
						reason: null,
					})),
		[capabilities],
	);
	const selectedProfile = availableProfiles.find((item) => item.id === profile) ?? null;
	const fileError = useMemo(() => validateCraigFile(file), [file]);
	const submitLabel =
		phase === "validating"
			? "Validando ZIP…"
			: phase === "preparing"
				? "Preparando profile…"
				: phase === "submitting"
					? "Enviando ao Companion…"
					: "Adicionar à fila";

	const canSubmit = useMemo(
		() =>
			Boolean(
				capabilities &&
					availableProfiles.length > 0 &&
					(capabilities.capabilities.includes("transcription.craig") ||
						capabilities.capabilities.includes("transcription.prepare")),
			),
		[availableProfiles, capabilities],
	);
	const requestBytes = useMemo(() => {
		if (!profile || !/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) return null;
		return craigTranscriptionRequestByteLength({
			campaignId: CAMPAIGN_SLUG,
			sessionId,
			sourceId: source?.sourceId ?? `craig-${"0".repeat(64)}`,
			profileId: profile,
			glossary,
			context,
		});
	}, [context, glossary, profile, sessionId, source]);
	const requestTooLarge =
		requestBytes !== null && requestBytes > LOCAL_JSON_BODY_MAX_BYTES;

	if (!paired) return null;

	function selectFile(next: File | null) {
		setDragging(false);
		setFile(next);
		setSource(null);
		setStatus(null);
		setError(null);
		pending.current = null;
	}

	function drag(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		if (!busy) setDragging(true);
	}

	function leave(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		if (!event.currentTarget.contains(event.relatedTarget as Node | null))
			setDragging(false);
	}

	function drop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		if (busy) return;
		selectFile(event.dataTransfer.files?.[0] ?? null);
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !file || !profile || !canSubmit || fileError) return;
		if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
			setError("Use um ID de sessão com letras, números, _ ou -, até 128 caracteres.");
			return;
		}
		if (!file.name.toLowerCase().endsWith(".zip") || file.size <= 0) {
			setError("Escolha um ZIP válido exportado pelo Craig.");
			return;
		}
		if (requestTooLarge) {
			setError(
				`Contexto e glossário excedem o orçamento local: ${requestBytes} / ${LOCAL_JSON_BODY_MAX_BYTES} bytes UTF-8. Reduza o texto antes de enviar.`,
			);
			return;
		}

		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		setBusy(true);
		setPhase(source ? "submitting" : "validating");
		setError(null);
		setStatus(
			source
				? "Reutilizando a fonte já verificada neste Companion…"
				: "Validando o ZIP diretamente no Companion local…",
		);
		try {
			const staged = source ?? (await bridge.craigSource(file, controller.signal));
			if (!source) setSource(staged);
			setStatus(
				staged.reused || source
					? `Fonte local já verificada · ${staged.trackCount} tracks.`
					: `ZIP verificado · ${staged.trackCount} tracks.`,
			);

			// Uploads grandes can take long enough for runtime/model readiness to
			// change. Decide preparation from a fresh Agent snapshot, not from the
			// render that existed when the user clicked submit.
			const currentCapabilities = await bridge.capabilities(controller.signal);
			setCapabilities(currentCapabilities);
			const currentProfiles = currentCapabilities.transcription.catalog.length
				? currentCapabilities.transcription.catalog
				: currentCapabilities.transcription.profiles.map((id) => ({
						id,
						engine: id.startsWith("qwen-")
							? ("qwen3" as const)
							: ("whisper" as const),
						ready: true,
						preparationRequired: false,
						reason: null,
					}));
			const selectedProfile = currentProfiles.find((item) => item.id === profile);
			if (!selectedProfile) {
				setError("O perfil selecionado não está disponível neste Companion.");
				return;
			}
			if (!selectedProfile.ready) {
				setPhase("preparing");
				setStatus("Preparando o perfil no Agent local…");
				let preparation: PreparationStatus = await bridge.prepareProfile(
					staged.sourceId,
					profile,
					controller.signal,
				);
				const preparationDeadline = Date.now() + 2 * 60 * 60 * 1000;
				while (preparation.state === "running") {
					setStatus(
						`${preparation.title} ${preparation.detail} · ${Math.round(preparation.elapsedSeconds)} s`,
					);
					if (Date.now() >= preparationDeadline) {
						setError("A preparação excedeu o limite de 2 horas.");
						return;
					}
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
					if (controller.signal.aborted) return;
					preparation = await bridge.preparation(controller.signal);
				}
				if (preparation.state !== "completed") {
					setError(localOperationMessage(preparation.errorCode));
					return;
				}
				setStatus("Perfil preparado e validado. Confirmando capacidade do Agent…");
				const refreshed = await bridge.capabilities(controller.signal);
				setCapabilities(refreshed);
				if (!refreshed.transcription.profiles.includes(profile)) {
					setError("O Agent concluiu a preparação, mas ainda não anunciou o perfil como pronto.");
					return;
				}
			}

			setPhase("submitting");
			setStatus("Enviando o trabalho validado para a fila local…");

			const signature = JSON.stringify([
				CAMPAIGN_SLUG,
				sessionId,
				staged.sourceId,
				profile,
				glossary,
				context,
			]);
			if (!pending.current || pending.current.signature !== signature) {
				pending.current = { key: crypto.randomUUID(), signature };
			}

			const job = await bridge.transcription(
				{
					campaignId: CAMPAIGN_SLUG,
					sessionId,
					sourceId: staged.sourceId,
					profileId: profile,
					glossary,
					context,
				},
				pending.current.key,
				controller.signal,
			);
			pending.current = null;
			setStatus(`Trabalho ${job.id.slice(0, 8)}… entrou na fila local.`);
			setFile(null);
			setSource(null);
			if (fileInput.current) fileInput.current.value = "";
		} catch (cause) {
			if (cause instanceof BridgeError) {
				if (sourceMustBeRestaged(cause.serverCode)) setSource(null);
				setError(
					cause.serverCode
						? localOperationMessage(cause.serverCode)
						: messageFor(cause.code),
				);
			} else {
				setError(messageFor("service_error"));
			}
			setStatus(
				pending.current
					? "A tentativa ficou ambígua; repetir com os mesmos dados reutiliza a mesma chave idempotente."
					: null,
			);
		} finally {
			setBusy(false);
			setPhase("idle");
			setDragging(false);
		}
	}

	return (
		<section
			className={className ? `${styles.card} ${className}` : styles.card}
			data-processing-submission="true"
			data-layout={compact ? "compact" : "default"}
			aria-labelledby="new-local-transcription"
		>
			<div className={styles.heading}>
				<div>
					<span>Craig → Companion local</span>
					<h2 id="new-local-transcription">Nova transcrição</h2>
				</div>
				<small>Áudio local · publicação explícita</small>
			</div>

			{!capabilities ? (
				<p className={styles.notice} role="status">
					Lendo os perfis disponíveis no Companion…
				</p>
			) : !canSubmit ? (
				<p className={styles.notice} role="status">
					Este Companion não anunciou um fluxo de transcrição/preparação compatível. Atualize o aplicativo local.
				</p>
			) : (
				<form className={styles.form} onSubmit={submit}>
					<div
						className={styles.dropZone}
						data-craig-dropzone="true"
						data-dragging={dragging ? "true" : "false"}
						data-has-file={file ? "true" : "false"}
						onDragEnter={drag}
						onDragOver={drag}
						onDragLeave={leave}
						onDrop={drop}
					>
						<input
							ref={fileInput}
							className={styles.fileInput}
							type="file"
							accept=".zip,application/zip"
							aria-label="Export do Craig"
							disabled={busy}
							tabIndex={-1}
							onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
						/>
						<div className={styles.dropCopy}>
							<span className={styles.dropEyebrow}>
								{file ? "ZIP selecionado" : "Export do Craig"}
							</span>
							<strong>
								{file ? file.name : "Arraste o ZIP do Craig aqui"}
							</strong>
							<span>
								{file
									? `${formatFileSize(file.size)} · validação real acontece no Companion`
									: "ou escolha o arquivo pelo picker"}
							</span>
						</div>
						<Button
							type="button"
							size="sm"
							variant="tertiary"
							disabled={busy}
							onClick={() => fileInput.current?.click()}
						>
							{file ? "Trocar ZIP" : "Escolher ZIP"}
						</Button>
					</div>

					{fileError ? (
						<p className={styles.inlineError} role="alert">
							{fileError}
						</p>
					) : null}

					<div className={styles.coreFields}>
						<label>
							<span>ID da sessão</span>
							<input
								value={sessionId}
								onChange={(event) => setSessionId(event.target.value.trim())}
								pattern="[A-Za-z0-9_-]{1,128}"
								maxLength={128}
								required
								disabled={busy}
								placeholder="sessao-42"
							/>
						</label>
						<label>
							<span>Perfil</span>
							<select
								value={profile}
								onChange={(event) =>
									setProfile(event.target.value as TranscriptionProfileId)
								}
								disabled={busy}
								required
							>
								{availableProfiles.map((item) => (
									<option key={item.id} value={item.id}>
										{profileLabels[item.id]}
										{item.ready ? "" : " · preparar no primeiro uso"}
									</option>
								))}
							</select>
						</label>
					</div>

					{selectedProfile ? (
						<div className={styles.profileSummary}>
							<div>
								<strong>{profileLabels[selectedProfile.id]}</strong>
								<span>
									{engineLabel(selectedProfile.engine)} ·{" "}
									{selectedProfile.ready
										? "pronto neste Companion"
										: "preparação necessária no primeiro uso"}
								</span>
							</div>
							<span className={styles.estimate}>
								Sem estimativa calibrada nesta máquina.
							</span>
						</div>
					) : null}

					{source ? (
						<div className={styles.sourceSummary} role="status">
							<strong>
								{source.reused ? "Fonte local reutilizada" : "ZIP verificado"}
							</strong>
							<span>
								{source.trackCount} tracks · {formatFileSize(source.sizeBytes)}
							</span>
						</div>
					) : null}

					<div className={styles.actions}>
						<Button
							type="submit"
							variant="primary"
							disabled={
								busy ||
								!file ||
								!profile ||
								!sessionId ||
								Boolean(fileError) ||
								requestTooLarge
							}
						>
							{submitLabel}
						</Button>
						<span className={styles.privacy}>
							<span aria-hidden="true">🔒</span> Áudio permanece nesta máquina.
						</span>
					</div>

					<details className={styles.privacyDetails}>
						<summary>Privacidade e fluxo local</summary>
						<p>
							O ZIP é enviado apenas ao Companion em loopback. Revisão e publicação
							continuam etapas explícitas depois do processamento.
						</p>
					</details>

					<details className={styles.advanced}>
						<summary>
							<span>Contexto e glossário</span>
							<small>opcional</small>
						</summary>
						<div className={styles.advancedGrid}>
							<label>
								<span>Contexto opcional</span>
								<textarea
									value={context}
									onChange={(event) =>
										setContext(
											truncateUnicodeScalars(
												event.target.value,
												TRANSCRIPTION_TEXT_MAX_CHARS,
											),
										)
									}
									disabled={busy}
									placeholder="Contexto curto da sessão/campanha para reconhecimento."
								/>
							</label>
							<label>
								<span>Glossário opcional</span>
								<textarea
									value={glossary}
									onChange={(event) =>
										setGlossary(
											truncateUnicodeScalars(
												event.target.value,
												TRANSCRIPTION_TEXT_MAX_CHARS,
											),
										)
									}
									disabled={busy}
									placeholder="Personagens, NPCs, lugares e termos difíceis."
								/>
							</label>
						</div>
					</details>

					{requestTooLarge ? (
						<p className={styles.error} role="alert">
							Contexto e glossário usam {requestBytes} /{" "}
							{LOCAL_JSON_BODY_MAX_BYTES} bytes UTF-8 no request local. Reduza o
							texto antes de enviar.
						</p>
					) : null}
					{profile && !selectedProfile?.ready ? (
						<p className={styles.notice} role="status">
							Primeiro uso: runtime, modelo e validação local da GPU serão
							preparados automaticamente antes de criar o job.
						</p>
					) : null}
				</form>
			)}

			{status ? (
				<p className={styles.status} role="status">
					{status}
				</p>
			) : null}
			{capabilityError ? (
				<p className={styles.error} role="alert">
					{capabilityError}
				</p>
			) : null}
			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
