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
	type BenchmarkResult,
	type Capabilities,
	type CraigSource,
	type LocalRunSummary,
	type PreparationStatus,
	type SystemSnapshot,
	type TranscriptionProfileId,
} from "./protocol";
import { PROCESSING_REFRESH_POLICY } from "./refresh-policy";
import {
	estimateProfileProcessing,
	formatEstimateProvenance,
	formatEstimateRange,
} from "./processing-estimator";
import {
	craigTranscriptionRequestByteLength,
	LOCAL_JSON_BODY_MAX_BYTES,
	TRANSCRIPTION_TEXT_MAX_CHARS,
	truncateUnicodeScalars,
} from "./request-budget";
import {
	fetchQwenRuntimeReleaseAvailability,
	qwenRuntimeReleaseLabel,
	qwenRuntimeReleaseMessage,
	type QwenRuntimeReleaseAvailability,
} from "./qwen-runtime-release-availability";
import { SessionRecordingComposer } from "./session-composer";
import {
	composeAndQueueSession,
	SessionTranscriptionWorkflowError,
	stageSessionSources,
} from "./session-transcription-workflow";
import {
	chooseSubmissionProfile,
	formatSubmissionBytes,
	profileReadinessCopy,
	submissionCtaLabel,
	submissionEngineLabel,
	submissionProfileLabel,
	suggestSessionIdFromFilename,
	validateCraigFile,
} from "./submission-model";
import styles from "./submission.module.css";
const QWEN_RUNTIME_UPGRADE_REASON = "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED";

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
	return {
		TRANSCRIPTION_PREPARATION_ALREADY_RUNNING:
			"Já existe outra preparação em andamento neste computador.",
		TRANSCRIPTION_PREPARATION_CANCELLED:
			"A preparação local foi cancelada antes de terminar.",
		TRANSCRIPTION_PREPARATION_STALE_OPERATION:
			"A preparação mudou desde a última leitura. Atualizei o estado sem cancelar a operação mais nova.",
		TRANSCRIPTION_PREPARATION_OPERATION_INVALID:
			"O Companion recusou a identidade da preparação.",
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
		QWEN_GATE_RUNTIME_NOT_READY:
			"O Qwen ainda não possui um runtime compatível pronto nesta máquina.",
		RUNTIME_RC_RELEASE_NOT_PUBLISHED:
			"O runtime Qwen compatível ainda não foi publicado no canal esperado. Tente novamente quando a atualização estiver disponível ou escolha outro perfil.",
		WHISPER_RUNTIME_UNAVAILABLE:
			"O runtime Whisper compatível ainda não está disponível.",
		WHISPER_MODEL_DOWNLOAD_FAILED:
			"Não foi possível baixar o modelo Whisper.",
		WHISPER_MODEL_PREPARATION_TIMEOUT:
			"A preparação do modelo Whisper excedeu o limite de tempo.",
		BODY_TOO_LARGE:
			"Contexto e glossário excedem o orçamento UTF-8 aceito pelo Companion. Reduza o texto antes de enviar.",
	}[code] ??
		(code.startsWith("CRAIG_ARCHIVE_")
			? "O ZIP foi recusado pela validação segura do Craig. Verifique o export original antes de repetir."
			: code.startsWith("CRAIG_TRACK_")
				? "Uma faixa do ZIP Craig é inválida ou excede os limites aceitos."
				: code.startsWith("CRAIG_MANIFEST_")
					? "A cópia local da fonte não corresponde mais ao manifesto verificado. Reenvie o ZIP original."
					: `Operação local não concluída · ${code}`);
}

type PendingStage = "validating" | "preparing" | "submitting";

function sourceMustBeRestaged(code: string | null): boolean {
	if (!code) return false;
	return (
		code.startsWith("CRAIG_MANIFEST_") ||
		code === "CRAIG_STAGING_EXISTING_INVALID" ||
		code === "CRAIG_STAGING_REPAIR_FAILED"
	);
}

const EMPTY_RUNS: readonly LocalRunSummary[] = [];
const EMPTY_BENCHMARKS: readonly BenchmarkResult[] = [];

export function ProcessingSubmission({
	className,
	compact = false,
	recoveryScope = null,
	onOpenDiagnostics,
	runs = EMPTY_RUNS,
	benchmarks = EMPTY_BENCHMARKS,
	system = null,
}: Readonly<{
	className?: string;
	compact?: boolean;
	recoveryScope?: string | null;
	onOpenDiagnostics?: () => void;
	runs?: readonly LocalRunSummary[];
	benchmarks?: readonly BenchmarkResult[];
	system?: SystemSnapshot | null;
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
	const [files, setFiles] = useState<readonly File[]>([]);
	const [fileError, setFileError] = useState<string | null>(null);
	const [source, setSource] = useState<CraigSource | null>(null);
	const [composerActive, setComposerActive] = useState(false);
	const [workflowNonce, setWorkflowNonce] = useState(0);
	const [busy, setBusy] = useState(false);
	const [pendingStage, setPendingStage] = useState<PendingStage | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [capabilityError, setCapabilityError] = useState<string | null>(null);
	const [preparation, setPreparation] = useState<PreparationStatus | null>(null);
	const [preparationCancelling, setPreparationCancelling] = useState(false);
	const [qwenReleaseAvailability, setQwenReleaseAvailability] = useState<
		QwenRuntimeReleaseAvailability | "checking" | null
	>(null);
	const request = useRef<AbortController | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

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
				const profileStates = value.transcription.catalog.length
					? value.transcription.catalog
					: value.transcription.profiles.map((id) => ({
							id,
							engine: id.startsWith("qwen-")
								? ("qwen3" as const)
								: ("whisper" as const),
							ready: true,
							preparationRequired: false,
							reason: null,
						}));
				setProfile((current) => chooseSubmissionProfile(current, profileStates));
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

	useEffect(() => {
		if (!paired) {
			setPreparation(null);
			return;
		}
		const controller = new AbortController();
		let stopped = false;
		let reading = false;
		const refreshPreparation = async () => {
			if (stopped || reading || controller.signal.aborted) return;
			reading = true;
			try {
				const next = await bridge.preparation(controller.signal);
				if (!stopped && !controller.signal.aborted) setPreparation(next);
			} catch {
				// Capabilities/connection owns the global error surface. Losing one
				// preparation poll must not erase the last authoritative snapshot.
			} finally {
				reading = false;
			}
		};
		void refreshPreparation();
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refreshPreparation();
		}, 1500);
		const visible = () => {
			if (document.visibilityState === "visible") void refreshPreparation();
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

	const selectedProfileState = useMemo(
		() => availableProfiles.find((item) => item.id === profile) ?? null,
		[availableProfiles, profile],
	);
	const profileEstimates = useMemo(
		() =>
			new Map(
				availableProfiles.map((item) => [
					item.id,
					estimateProfileProcessing({
						audioWorkSeconds: source?.audioWorkSeconds ?? null,
						profile: item,
						runs,
						benchmarks,
						system,
					}),
				]),
			),
		[availableProfiles, benchmarks, runs, source?.audioWorkSeconds, system],
	);
	const selectedEstimate = profile ? profileEstimates.get(profile) : null;
	const qwenRuntimeUpgradeRequired =
		selectedProfileState?.reason === QWEN_RUNTIME_UPGRADE_REASON;
	const profileBlocked = Boolean(
		selectedProfileState &&
			!selectedProfileState.ready &&
			!selectedProfileState.preparationRequired,
	);

	useEffect(() => {
		if (!paired || !qwenRuntimeUpgradeRequired) {
			setQwenReleaseAvailability(null);
			return;
		}
		const controller = new AbortController();
		setQwenReleaseAvailability("checking");
		void fetchQwenRuntimeReleaseAvailability(controller.signal).then((availability) => {
			if (!controller.signal.aborted) setQwenReleaseAvailability(availability);
		});
		return () => controller.abort();
	}, [paired, qwenRuntimeUpgradeRequired]);

	const qwenRuntimeBlockMessage = qwenRuntimeReleaseMessage(
		qwenReleaseAvailability,
	);
	const qwenRuntimeBlockLabel = qwenRuntimeReleaseLabel(
		qwenReleaseAvailability,
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

	function applyFiles(nextFiles: readonly File[]) {
		setSource(null);
		setStatus(null);
		setError(null);
		if (!nextFiles.length) {
			setFile(null);
			setFiles([]);
			setFileError(null);
			return;
		}
		const invalid = nextFiles
			.map((candidate) => ({
				candidate,
				reason: validateCraigFile(candidate),
			}))
			.find((item) => item.reason);
		if (invalid) {
			setFile(null);
			setFiles([]);
			setFileError(invalid.candidate.name + ": " + invalid.reason);
			if (fileInput.current) fileInput.current.value = "";
			return;
		}
		const unique = nextFiles.filter(
			(candidate, index) =>
				nextFiles.findIndex(
					(other) =>
						other.name === candidate.name &&
						other.size === candidate.size &&
						other.lastModified === candidate.lastModified,
				) === index,
		);
		setFiles(unique);
		setFile(unique[0] ?? null);
		setFileError(null);
		if (!sessionId && unique[0]) {
			const suggestion = suggestSessionIdFromFilename(unique[0].name);
			if (suggestion) setSessionId(suggestion);
		}
	}

	function handleDrop(event: DragEvent<HTMLButtonElement>) {
		event.preventDefault();
		setDragActive(false);
		if (busy) return;
		applyFiles(Array.from(event.dataTransfer.files));
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !files.length || !profile || !canSubmit || profileBlocked) return;
		if (qwenRuntimeUpgradeRequired) {
			setError(qwenRuntimeBlockMessage);
			return;
		}
		if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
			setError("Use um ID de sessão com letras, números, _ ou -, até 128 caracteres.");
			return;
		}
		const invalidFile = files
			.map((candidate) => ({ candidate, reason: validateCraigFile(candidate) }))
			.find((item) => item.reason);
		if (invalidFile) {
			setFileError(invalidFile.candidate.name + ": " + invalidFile.reason);
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
			files.length === 1
				? "Validando a gravação diretamente no Companion local…"
				: "Validando " + files.length + " gravações diretamente no Companion local…",
		);
		try {
			const stagedSources = await stageSessionSources(
				bridge,
				files,
				controller.signal,
				(index, total, candidate) =>
					setStatus(
						"Validando gravação " +
							index +
							"/" +
							total +
							" · " +
							candidate.name,
					),
			);
			const staged = stagedSources[0];
			if (!staged) {
				setError("Nenhuma gravação válida foi selecionada.");
				return;
			}
			setSource(staged);
			setStatus(
				(stagedSources.length === 1
					? "Gravação verificada"
					: stagedSources.length + " gravações verificadas") +
					" · continuando automaticamente.",
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
			if (selectedProfile.reason === QWEN_RUNTIME_UPGRADE_REASON) {
				setError(qwenRuntimeBlockMessage);
				return;
			}
			if (!selectedProfile.ready && !selectedProfile.preparationRequired) {
				setError(
					selectedProfile.reason
						? localOperationMessage(selectedProfile.reason)
						: "O perfil selecionado está indisponível neste Companion.",
				);
				return;
			}
			if (!selectedProfile.ready) {
				setPendingStage("preparing");
				setStatus("Preparando o perfil no Agent local…");
				let observed = preparation;
				if (observed?.active) {
					if (
						observed.sourceId !== staged.sourceId ||
						observed.profileId !== profile
					) {
						setError(
							"Já existe outra preparação em andamento. Acompanhe ou cancele a operação atual antes de iniciar outra.",
						);
						return;
					}
				} else {
					observed = await bridge.prepareProfile(
						staged.sourceId,
						profile,
						controller.signal,
					);
					setPreparation(observed);
				}
				const operationId = observed.operationId;
				if (!operationId) {
					setError("O Agent não retornou a identidade da preparação.");
					return;
				}
				while (observed.state === "running") {
					setStatus(
						`${observed.title} ${observed.detail} · ${Math.round(observed.elapsedSeconds)} s`,
					);
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
					if (controller.signal.aborted) return;
					const next = await bridge.preparation(controller.signal);
					setPreparation(next);
					if (next.operationId !== operationId) {
						setError(
							"A preparação observada terminou ou foi substituída. O estado foi atualizado sem agir sobre a operação nova.",
						);
						return;
					}
					observed = next;
				}
				if (observed.state !== "completed") {
					setError(localOperationMessage(observed.errorCode));
					return;
				}
				setStatus("Perfil preparado e validado. Confirmando capacidade do Agent…");
				const refreshed = await bridge.capabilities(controller.signal);
				setCapabilities(refreshed);
				const refreshedProfile = refreshed.transcription.catalog.find(
					(item) => item.id === profile,
				);
				if (refreshedProfile?.reason === QWEN_RUNTIME_UPGRADE_REASON) {
					setError(qwenRuntimeBlockMessage);
					return;
				}
				if (!refreshed.transcription.profiles.includes(profile)) {
					setError("O Agent concluiu a preparação, mas ainda não anunciou o perfil como pronto.");
					return;
				}
			}

			setPendingStage("submitting");
			setStatus("Montando a sessão local e enfileirando somente o que falta…");
			const workflow = await composeAndQueueSession({
				bridge,
				sources: stagedSources,
				sessionId,
				profile,
				glossary,
				context,
				recoveryScope,
				storage: window.localStorage,
				signal: controller.signal,
			});
			setComposerActive(true);
			setWorkflowNonce((value) => value + 1);
			setStatus(
				workflow.workspace.timeline.state === "ready"
					? "Sessão em andamento · " +
							workflow.queued +
							" gravação(ões) enfileirada(s), " +
							workflow.reused +
							" reaproveitada(s). A transcrição contínua será montada automaticamente."
					: "Processamento iniciado. A cronologia precisa de uma decisão antes da montagem final.",
			);
			setFiles([]);
			setFile(null);
			setSource(null);
			if (fileInput.current) fileInput.current.value = "";
		} catch (cause) {
			if (
				cause instanceof SessionTranscriptionWorkflowError &&
				cause.code === "recording_variant"
			) {
				setError(
					"Há duas variantes da mesma gravação. Escolha qual delas pertence à sessão antes de continuar.",
				);
			} else if (cause instanceof BridgeError) {
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
				"A sessão foi preservada localmente. Repetir com os mesmos dados reconcilia as gravações pelo contrato idempotente.",
			);
		} finally {
			setBusy(false);
			setPendingStage(null);
		}
	}

	async function resumePreparation() {
		if (busy || preparation?.state !== "interrupted" || !preparation.sourceId || !preparation.profileId) return;
		setBusy(true);
		setError(null);
		const controller = new AbortController();
		request.current?.abort();
		request.current = controller;
		try {
			setPreparation(await bridge.prepareProfile(preparation.sourceId, preparation.profileId, controller.signal));
			setStatus("Retomando preparação após reinício. Os arquivos locais serão verificados novamente.");
		} catch (cause) {
			setError(cause instanceof BridgeError && cause.serverCode ? localOperationMessage(cause.serverCode) : messageFor("service_error"));
		} finally {
			setBusy(false);
		}
	}

	async function cancelActivePreparation() {
		const operationId = preparation?.operationId;
		if (
			!operationId ||
			!preparation.active ||
			preparationCancelling ||
			!capabilities?.capabilities.includes("transcription.prepare.cancel")
		)
			return;
		const controller = new AbortController();
		setPreparationCancelling(true);
		setError(null);
		try {
			const next = await bridge.cancelPreparation(operationId, controller.signal);
			setPreparation(next);
			setStatus("Cancelamento solicitado ao Agent local.");
		} catch (cause) {
			if (cause instanceof BridgeError) {
				setError(
					cause.serverCode
						? localOperationMessage(cause.serverCode)
						: messageFor(cause.code),
				);
				try {
					setPreparation(await bridge.preparation(controller.signal));
				} catch {
					// Keep the last snapshot; the normal observer will retry.
				}
			} else {
				setError(messageFor("service_error"));
			}
		} finally {
			setPreparationCancelling(false);
		}
	}

	const readiness = profileReadinessCopy(selectedProfileState);
	const readinessReason =
		selectedProfileState?.reason && !selectedProfileState.ready
			? qwenRuntimeUpgradeRequired
				? qwenRuntimeBlockMessage
				: localOperationMessage(selectedProfileState.reason)
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
					<h2 id="new-local-transcription">Nova transcrição Craig</h2>
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
						<Button type="button" size="sm" variant="tertiary" onClick={onOpenDiagnostics}>
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
						<span>Este Companion não anunciou um fluxo de transcrição ou preparação compatível.</span>
					</div>
					{onOpenDiagnostics ? (
						<Button type="button" size="sm" variant="tertiary" onClick={onOpenDiagnostics}>
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
					>
						<input
							ref={fileInput}
							className={styles.fileInput}
							type="file"
							accept=".zip,application/zip"
							aria-label="Exports do Craig"
							multiple
							disabled={busy}
							onChange={(event) =>
								applyFiles(Array.from(event.target.files ?? []))
							}
						/>
						<button
							type="button"
							className={styles.dropAction}
							data-craig-drop-target="true"
							disabled={busy}
							onClick={() => fileInput.current?.click()}
							onDragEnter={(event) => {
								event.preventDefault();
								if (!busy) setDragActive(true);
							}}
							onDragOver={(event) => {
								event.preventDefault();
								if (!busy) setDragActive(true);
							}}
							onDragLeave={(event) => {
								if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
								setDragActive(false);
							}}
							onDrop={handleDrop}
						>
							<span className={styles.dropGlyph} aria-hidden="true">{file ? "✓" : "ZIP"}</span>
							<span className={styles.dropCopy}>
								<strong>
									{files.length > 1
										? files.length + " gravações selecionadas"
										: file
											? file.name
											: "Arraste um ou mais ZIPs do Craig aqui"}
								</strong>
								<span>
									{file
										? formatSubmissionBytes(
												files.reduce((total, item) => total + item.size, 0),
											) + " · escolher novamente"
										: "ou escolher arquivos"}
								</span>
							</span>
						</button>
					</div>

					{fileError ? <p className={styles.inlineError} role="alert">{fileError}</p> : null}

					{file ? (
						<dl className={styles.fileFacts}>
							<div><dt>Gravações</dt><dd>{files.length}</dd></div>
							<div>
								<dt>Arquivos</dt>
								<dd title={files.map((item) => item.name).join(", ")}>
									{files.length === 1
										? file.name
										: file.name + " +" + (files.length - 1)}
								</dd>
							</div>
							<div>
								<dt>Tamanho</dt>
								<dd>
									{formatSubmissionBytes(
										files.reduce((total, item) => total + item.size, 0),
									)}
								</dd>
							</div>
							{source ? (
								<>
									<div><dt>Tracks</dt><dd>{source.trackCount}</dd></div>
									<div><dt>Fonte</dt><dd>{source.reused ? "Já verificada" : "Verificada agora"}</dd></div>
								</>
							) : null}
						</dl>
					) : null}

					<div className={styles.identityGrid}>
						<label>
							<span>ID da sessão</span>
							<input
								value={sessionId}
								data-craig-session-id="true"
								onChange={(event) => setSessionId(event.target.value.trim())}
								pattern="[A-Za-z0-9_-]{1,128}"
								maxLength={128}
								required
								disabled={busy || composerActive}
								placeholder="sessao-42"
								aria-describedby="session-id-help"
							/>
							<small id="session-id-help">
								{composerActive
									? "Alvo fixado enquanto o composer desta sessão estiver ativo."
									: "Sugestão vem do nome do ZIP quando o campo está vazio. Sempre editável antes de compor."}
							</small>
						</label>
						<label>
							<span>Perfil</span>
							<select
								value={profile}
								onChange={(event) => setProfile(event.target.value as TranscriptionProfileId)}
								disabled={busy}
								required
							>
								{availableProfiles.map((item) => (
									<option key={item.id} value={item.id}>
										{submissionProfileLabel(item.id)}
									</option>
								))}
							</select>
						</label>
						<div className={styles.submitRow}>
							<Button
								type="submit"
								variant="primary"
								disabled={
									busy ||
									!file ||
									!profile ||
									!canSubmit ||
									requestTooLarge ||
									profileBlocked ||
									qwenRuntimeUpgradeRequired
								}
							>
								{submissionCtaLabel(pendingStage)}
							</Button>
							{requestTooLarge ? (
								<span className={styles.budgetWarning}>
									{requestBytes} / {LOCAL_JSON_BODY_MAX_BYTES} bytes UTF-8
								</span>
							) : null}
						</div>
					</div>

					{selectedProfileState ? (
						<div
							className={styles.profileSummary}
							data-ready={selectedProfileState.ready ? "true" : "false"}
							role={profileBlocked ? "alert" : "status"}
						>
							<div>
								<strong>{submissionProfileLabel(selectedProfileState.id)}</strong>
								<span>
									{submissionEngineLabel(selectedProfileState)} ·{" "}
									{qwenRuntimeUpgradeRequired
										? qwenRuntimeBlockLabel
										: selectedProfileState.ready
											? "pronto neste Companion"
											: selectedProfileState.preparationRequired
												? "preparação necessária"
												: "indisponível"}
								</span>
								{readinessReason ? <small>{readinessReason}</small> : null}
							</div>
							<div className={styles.profileMeta}>
								<small>
									{selectedEstimate?.available
										? `${formatEstimateRange(
												selectedEstimate.lowerSeconds,
												selectedEstimate.upperSeconds,
											)} · confiança ${{
												high: "alta",
												medium: "média",
												low: "baixa",
											}[selectedEstimate.confidence]}`
										: "Sem calibração compatível nesta máquina."}
								</small>
								{profileBlocked && onOpenDiagnostics ? (
									<Button type="button" size="sm" variant="tertiary" onClick={onOpenDiagnostics}>
										Diagnóstico
									</Button>
								) : null}
							</div>
						</div>
					) : null}
					{source ? (
						<section className={styles.estimatePanel} aria-label="Estimativas locais por perfil">
							<div>
								<strong>Estimativa nesta máquina</strong>
								<small>
									{Math.round(source.audioWorkSeconds ?? 0)} s de trabalho de áudio
								</small>
							</div>
							<div className={styles.estimateGrid}>
								{availableProfiles.map((item) => {
									const estimate = profileEstimates.get(item.id);
									return (
										<div key={item.id} data-selected={item.id === profile ? "true" : "false"}>
											<span>{submissionProfileLabel(item.id)}</span>
											<strong>
												{estimate?.available
													? formatEstimateRange(estimate.lowerSeconds, estimate.upperSeconds)
													: "Sem estimativa calibrada"}
											</strong>
											<small>
												{estimate?.available
													? `Confiança ${{
															high: "alta",
															medium: "média",
															low: "baixa",
														}[estimate.confidence]} · ${formatEstimateProvenance(estimate)}`
													: "Histórico compatível insuficiente"}
												{item.preparationRequired ? " · + preparação necessária" : ""}
											</small>
										</div>
									);
								})}
							</div>
						</section>
					) : null}


					<div className={styles.metaRow}>
						<div className={styles.privacy}>
							<strong><span aria-hidden="true">🔒</span> Áudio permanece nesta máquina.</strong>
							<details>
								<summary>Como funciona</summary>
								<p>
									O ZIP é enviado somente por loopback ao TDA Companion local. Resultados ficam locais até uma ação editorial explícita de publicação.
								</p>
							</details>
						</div>

						<details
							className={styles.advanced}
							open={advancedOpen}
							onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
						>
							<summary><span>Opções avançadas</span><small>Contexto e glossário · opcional</small></summary>
							<div className={styles.advancedGrid}>
								<label>
									<span>Contexto opcional</span>
									<textarea
										value={context}
										onChange={(event) =>
												setContext(truncateUnicodeScalars(event.target.value, TRANSCRIPTION_TEXT_MAX_CHARS))
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
												setGlossary(truncateUnicodeScalars(event.target.value, TRANSCRIPTION_TEXT_MAX_CHARS))
										}
										disabled={busy}
										placeholder="Personagens, NPCs, lugares e termos difíceis."
									/>
								</label>
							</div>
						</details>
					</div>

					{requestTooLarge ? (
						<p className={styles.inlineError} role="alert">
							Contexto e glossário excedem o orçamento local: {requestBytes} / {LOCAL_JSON_BODY_MAX_BYTES} bytes UTF-8. Reduza o texto antes de enviar.
						</p>
					) : null}
				</form>
			)}

			{capabilities ? (
				<SessionRecordingComposer
					bridge={bridge}
					capabilities={capabilities.capabilities}
					sessionId={sessionId}
					currentSource={source}
					workflowNonce={workflowNonce}
					profile={profile}
					context={context}
					glossary={glossary}
					profileReady={selectedProfileState?.ready === true}
					recoveryScope={recoveryScope}
					disabled={busy || requestTooLarge}
					onActiveChange={setComposerActive}
					onRestoreSessionId={(value) =>
						setSessionId((current) => current || value)
					}
					onStatus={setStatus}
					onError={setError}
				/>
			) : null}

			{preparation?.state === "interrupted" ? (
				<div className={styles.notice} role="status">
					<strong>Preparação interrompida pelo reinício do Companion.</strong>{" "}
					Etapa anterior: {preparation.stage}. A prontidão do profile é verificada pelos arquivos locais.
					<Button type="button" variant="secondary" disabled={busy} onClick={() => void resumePreparation()}>
						Retomar preparação
					</Button>
				</div>
			) : null}
			{preparation?.active ? (
				<div className={styles.notice} role="status">
					<strong>{preparation.title}</strong>{" "}
					{preparation.detail} · {Math.round(preparation.elapsedSeconds)} s · op{" "}
					{preparation.operationId?.slice(0, 8)}…
					{capabilities?.capabilities.includes("transcription.prepare.cancel") && preparation.operationId ? (
						<Button
							type="button"
							variant="secondary"
							disabled={preparationCancelling}
							onClick={() => void cancelActivePreparation()}
						>
							{preparationCancelling ? "Cancelando…" : "Cancelar preparação"}
						</Button>
					) : null}
				</div>
			) : null}

			{status ? <p className={styles.status} role="status">{status}</p> : null}
			{capabilityError && capabilities ? <p className={styles.inlineError} role="alert">{capabilityError}</p> : null}
			{error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
		</section>
	);

}
