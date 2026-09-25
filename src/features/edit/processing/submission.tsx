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
import {
	formatSubmissionBytes,
	profileReadinessCopy,
	submissionCtaLabel,
	submissionEngineLabel,
	submissionProfileLabel,
	suggestSessionIdFromFilename,
	validateCraigFile,
} from "./submission-model";
import styles from "./submission.module.css";

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
	const known = {
		TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
			"Já existe outra preparação em andamento neste computador.",
		TRANSCRIPTION_PREPARATION_CANCELLED:
			"A preparação local foi cancelada antes de terminar.",
		TRANSCRIPTION_PREPARATION_TIMEOUT:
			"A preparação local atingiu o limite de 2 horas e foi encerrada.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_ACTIVE_JOB:
			"Já existe um trabalho local na fila ou em execução. Aguarde antes de preparar outro profile.",
		TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB:
			"Espere o trabalho atual terminar antes de preparar outro profile.",
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
			"O ZIP ultrapassa o limite local de 64 GiB.",
		CRAIG_UPLOAD_EMPTY:
			"O ZIP selecionado está vazio.",
		CRAIG_ZIP_REQUIRED:
			"Escolha um arquivo ZIP exportado pelo Craig.",
		CRAIG_ARCHIVE_INVALID:
			"O arquivo não é um ZIP Craig válido.",
		CRAIG_ARCHIVE_NO_TRACKS:
			"O ZIP não contém faixas de áudio reconhecidas pelo fluxo Craig.",
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
	}[code as keyof typeof known];
	if (known) return known;
	if (code.startsWith("CRAIG_ARCHIVE_"))
		return "O ZIP foi recusado pela validação segura do Craig. Verifique o export original antes de repetir.";
	if (code.startsWith("CRAIG_TRACK_"))
		return "Uma faixa do ZIP Craig é inválida ou excede os limites aceitos.";
	if (code.startsWith("CRAIG_MANIFEST_"))
		return "A cópia local da fonte não corresponde mais ao manifesto verificado. Reenvie o ZIP original.";
	return `Operação local não concluída · ${code}`;
}

type PendingSubmission = {
	key: string;
	signature: string;
};

type PendingStage = "validating" | "preparing" | "submitting";

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
	onOpenDiagnostics,
}: Readonly<{
	className?: string;
	compact?: boolean;
	onOpenDiagnostics?: () => void;
}> = {}) {
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
	const [fileError, setFileError] = useState<string | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [busy, setBusy] = useState(false);
	const [pendingStage, setPendingStage] = useState<PendingStage | null>(null);
	const [dragActive, setDragActive] = useState(false);
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
					setCapabilityError(
						messageFor(
							cause instanceof BridgeError ? cause.code : "service_error",
						),
					);
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

	const selectedProfile = useMemo(
		() => availableProfiles.find((item) => item.id === profile) ?? null,
		[availableProfiles, profile],
	);
	const profileBlocked = Boolean(
		selectedProfile &&
			!selectedProfile.ready &&
			!selectedProfile.preparationRequired,
	);
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

	function applyFile(nextFile: File | null) {
		setSource(null);
		setStatus(null);
		setError(null);
		pending.current = null;
		if (!nextFile) {
			setFile(null);
			setFileError(null);
			return;
		}
		const validation = validateCraigFile(nextFile);
		if (validation) {
			setFile(null);
			setFileError(validation);
			return;
		}
		setFile(nextFile);
		setFileError(null);
		if (!sessionId) {
			const suggestion = suggestSessionIdFromFilename(nextFile.name);
			if (suggestion) setSessionId(suggestion);
		}
	}

	function handleDrop(event: DragEvent<HTMLDivElement>) {
		event.preventDefault();
		setDragActive(false);
		if (busy) return;
		applyFile(event.dataTransfer.files.item(0));
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			busy ||
			!file ||
			!profile ||
			!canSubmit ||
			profileBlocked
		)
			return;
		if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
			setError(
				"Use um ID de sessão com letras, números, _ ou -, até 128 caracteres.",
			);
			return;
		}
		const fileValidation = validateCraigFile(file);
		if (fileValidation) {
			setFileError(fileValidation);
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
		setPendingStage("validating");
		setError(null);
		setFileError(null);
		setStatus(
			source
				? "Revalidando a fonte já verificada neste Companion…"
				: "Validando e copiando o ZIP pelo loopback local…",
		);
		try {
			const staged = source ?? (await bridge.craigSource(file, controller.signal));
			if (!source) setSource(staged);
			setStatus(
				staged.reused || source
					? `Fonte local já verificada · ${staged.trackCount} tracks.`
					: `ZIP verificado · ${staged.trackCount} tracks.`,
			);

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
			const currentProfile = currentProfiles.find((item) => item.id === profile);
			if (!currentProfile) {
				setError("O profile selecionado não está disponível neste Companion.");
				return;
			}
			if (!currentProfile.ready && !currentProfile.preparationRequired) {
				setError(
					currentProfile.reason
						? localOperationMessage(currentProfile.reason)
						: "O profile selecionado está indisponível neste Companion.",
				);
				return;
			}
			if (!currentProfile.ready) {
				setPendingStage("preparing");
				setStatus("Preparando o profile no Agent local…");
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
				setStatus(
					"Profile preparado e validado. Confirmando capacidade do Agent…",
				);
				const refreshed = await bridge.capabilities(controller.signal);
				setCapabilities(refreshed);
				if (!refreshed.transcription.profiles.includes(profile)) {
					setError(
						"O Agent concluiu a preparação, mas ainda não anunciou o profile como pronto.",
					);
					return;
				}
			}

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

			setPendingStage("submitting");
			setStatus("Enviando o pedido ao Companion local…");
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
			setPendingStage(null);
		}
	}

	const readiness = profileReadinessCopy(selectedProfile);
	const readinessReason =
		selectedProfile?.reason && !selectedProfile.ready
			? localOperationMessage(selectedProfile.reason)
			: null;

	return (
		<section
			className={className ? `${styles.card} ${className}` : styles.card}
			data-craig-composer="true"
			data-layout={compact ? "compact" : "default"}
			aria-labelledby="new-local-transcription"
		>
			<div className={styles.heading}>
				<div>
					<span>Processamento local</span>
					<h2 id="new-local-transcription">Nova transcrição</h2>
				</div>
				<small>Craig ZIP → Companion → GPU local</small>
			</div>

			{!capabilities && capabilityError ? (
				<div className={styles.blocked} role="alert">
					<div>
						<strong>Não foi possível ler os profiles locais.</strong>
						<span>{capabilityError}</span>
					</div>
					{onOpenDiagnostics ? (
						<Button size="sm" variant="tertiary" onClick={onOpenDiagnostics}>
							Abrir Diagnóstico
						</Button>
					) : null}
				</div>
			) : !capabilities ? (
				<p className={styles.notice} role="status">
					Lendo os profiles disponíveis no Companion…
				</p>
			) : !canSubmit ? (
				<div className={styles.blocked} role="status">
					<div>
						<strong>Transcrição local indisponível.</strong>
						<span>
							Este Companion não anunciou um fluxo de transcrição ou preparação compatível.
						</span>
					</div>
					{onOpenDiagnostics ? (
						<Button size="sm" variant="tertiary" onClick={onOpenDiagnostics}>
							Abrir Diagnóstico
						</Button>
					) : null}
				</div>
			) : (
				<form className={styles.form} onSubmit={submit}>
					<div
						className={styles.dropZone}
						data-craig-dropzone="true"
						data-active={dragActive ? "true" : "false"}
						data-selected={file ? "true" : "false"}
						onDragEnter={(event) => {
							event.preventDefault();
							if (!busy) setDragActive(true);
						}}
						onDragOver={(event) => {
							event.preventDefault();
							if (!busy) setDragActive(true);
						}}
						onDragLeave={(event) => {
							if (event.currentTarget.contains(event.relatedTarget as Node | null))
								return;
							setDragActive(false);
						}}
						onDrop={handleDrop}
					>
						<input
							ref={fileInput}
							className={styles.fileInput}
							type="file"
							accept=".zip,application/zip"
							aria-label="Export do Craig"
							disabled={busy}
							onChange={(event) => applyFile(event.target.files?.[0] ?? null)}
						/>
						<button
							type="button"
							className={styles.dropAction}
							disabled={busy}
							onClick={() => fileInput.current?.click()}
						>
							<span className={styles.dropGlyph} aria-hidden="true">
								{file ? "✓" : "ZIP"}
							</span>
							<span className={styles.dropCopy}>
								<strong>
									{file ? file.name : "Arraste o ZIP do Craig aqui"}
								</strong>
								<span>
									{file
										? `${formatSubmissionBytes(file.size)} · escolher outro arquivo`
										: "ou escolher arquivo"}
								</span>
							</span>
						</button>
					</div>

					{fileError ? (
						<p className={styles.inlineError} role="alert">
							{fileError}
						</p>
					) : null}

					{file ? (
						<dl className={styles.fileFacts} aria-label="Resumo do arquivo selecionado">
							<div>
								<dt>Arquivo</dt>
								<dd title={file.name}>{file.name}</dd>
							</div>
							<div>
								<dt>Tamanho</dt>
								<dd>{formatSubmissionBytes(file.size)}</dd>
							</div>
							{source ? (
								<>
									<div>
										<dt>Tracks</dt>
										<dd>{source.trackCount}</dd>
									</div>
									<div>
										<dt>Fonte</dt>
										<dd>{source.reused ? "Já verificada" : "Verificada agora"}</dd>
									</div>
								</>
							) : null}
						</dl>
					) : null}

					<div className={styles.identityGrid}>
						<label>
							<span>Sessão</span>
							<input
								value={sessionId}
								onChange={(event) => setSessionId(event.target.value.trim())}
								pattern="[A-Za-z0-9_-]{1,128}"
								maxLength={128}
								required
								disabled={busy}
								placeholder="sessao-42"
								aria-describedby="session-id-help"
							/>
							<small id="session-id-help">
								Sugestão vem do nome do ZIP quando o campo está vazio. Sempre editável.
							</small>
						</label>

						<label>
							<span>Profile</span>
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
										{submissionProfileLabel(item.id)}
										{item.ready ? "" : item.preparationRequired ? " · preparar" : " · indisponível"}
									</option>
								))}
							</select>
						</label>
					</div>

					{selectedProfile ? (
						<div
							className={styles.profileSummary}
							data-ready={selectedProfile.ready ? "true" : "false"}
						>
							<div>
								<strong>{submissionProfileLabel(selectedProfile.id)}</strong>
								<span>
									{submissionEngineLabel(selectedProfile)}
									{selectedProfile.ready
										? " · pronto neste Companion"
										: selectedProfile.preparationRequired
											? " · preparação necessária"
											: " · indisponível"}
								</span>
							</div>
							<small>Ainda sem calibração nesta máquina.</small>
						</div>
					) : null}

					{readiness ? (
						<div className={profileBlocked ? styles.blocked : styles.readiness}>
							<div>
								<strong>{readiness}</strong>
								{readinessReason && readinessReason !== readiness ? (
									<span>{readinessReason}</span>
								) : null}
							</div>
							{profileBlocked && onOpenDiagnostics ? (
								<Button
									size="sm"
									variant="tertiary"
									onClick={onOpenDiagnostics}
								>
									Abrir Diagnóstico
								</Button>
							) : null}
						</div>
					) : null}

					<div className={styles.submitRow}>
						<Button
							type="submit"
							variant="primary"
							disabled={
								busy ||
								!file ||
								!profile ||
								requestTooLarge ||
								profileBlocked
							}
						>
							{submissionCtaLabel(selectedProfile, pendingStage)}
						</Button>
						{requestTooLarge ? (
							<span className={styles.budgetWarning}>
								{requestBytes} / {LOCAL_JSON_BODY_MAX_BYTES} bytes UTF-8
							</span>
						) : null}
					</div>

					<div className={styles.privacy}>
						<strong>
							<span aria-hidden="true">🔒</span> Áudio permanece nesta máquina.
						</strong>
						<details>
							<summary>Como funciona</summary>
							<p>
								O ZIP é enviado somente por loopback ao TDA Companion local.
								Resultados ficam locais até uma ação editorial explícita de publicação.
							</p>
						</details>
					</div>

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
						<p className={styles.inlineError} role="alert">
							Contexto e glossário excedem o orçamento local. Reduza o texto antes de enviar.
						</p>
					) : null}
				</form>
			)}

			{status ? (
				<p className={styles.status} role="status">
					{status}
				</p>
			) : null}
			{capabilityError && capabilities ? (
				<p className={styles.inlineError} role="alert">
					{capabilityError}
				</p>
			) : null}
			{error ? (
				<p className={styles.inlineError} role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
