"use client";

import {
	type DragEvent,
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
	ProcessingCampaignValidationError,
	validateProcessingCampaignForEnqueue,
} from "./campaign-validation";
import {
	LocalBridge,
	localBridgePaired,
	subscribeLocalBridgePairing,
} from "./bridge";
import {
	BridgeError,
	type BenchmarkResult,
	type Capabilities,
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
	appendCraigFiles,
	markExactSourceDuplicates,
	moveCraigFileSelection,
	removeCraigFileSelection,
	reorderCraigFileSelection,
	replaceCraigFileSelection,
	stageableCraigFiles,
	type CraigFileSelection,
	uniqueStagedCraigSources,
} from "./craig-file-selection";
import {
	fetchQwenRuntimeReleaseAvailability,
	qwenRuntimeReleaseLabel,
	qwenRuntimeReleaseMessage,
	type QwenRuntimeReleaseAvailability,
} from "./qwen-runtime-release-availability";
import { SessionRecordingComposer } from "./session-composer";
import {
	SessionIntentCoordinator,
	type SessionTranscriptionIntent,
} from "./session-intent";
import {
	sessionRecoveryForError,
	sessionRecoveryPrimaryText,
	type SessionRecoveryTarget,
} from "./session-recovery";
import {
	confirmSessionComposerPendingSubmission,
	resolveSessionComposerPendingSubmission,
	type SessionComposerPendingSubmission,
} from "./session-composer-storage";
import {
	chooseSubmissionProfile,
	formatSubmissionBytes,
	profileReadinessCopy,
	submissionCtaLabel,
	submissionEngineLabel,
	submissionProfileLabel,
	suggestSessionIdFromFilename,
} from "./submission-model";
import styles from "./submission.module.css";
const QWEN_RUNTIME_UPGRADE_REASON = "QWEN_RUNTIME_ALIGNMENT_UPGRADE_REQUIRED";

type AvailabilityFailure = "timeout" | "unreachable";

function recoveredAvailabilityNotice(code: AvailabilityFailure): string {
	const incident =
		code === "timeout"
			? "o Companion demorou demais para responder"
			: "o Companion ficou indisponível";
	return `Na tentativa anterior, ${incident}. O estado já salvo foi preservado. Agora o Companion está respondendo novamente. A reconexão não altera o progresso: só gravações com execução confirmada contam como concluídas. Se o ZIP original não estiver selecionado, escolha o mesmo arquivo para retomar.`;
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
					: code.startsWith("SESSION_WORKSPACE_") ||
							code.startsWith("SESSION_ASSEMBLY_")
						? sessionRecoveryPrimaryText(
								sessionRecoveryForError(
									new BridgeError("conflict", code),
									null,
								),
							)
						: "Não foi possível concluir esta operação local. Abra o Diagnóstico se o problema continuar.");
}

type PendingStage = "validating" | "preparing" | "submitting";

const EMPTY_RUNS: readonly LocalRunSummary[] = [];
const EMPTY_BENCHMARKS: readonly BenchmarkResult[] = [];

export function ProcessingSubmission({
	campaignId,
	className,
	compact = false,
	recoveryScope = null,
	onDraftStateChange,
	onOpenDiagnostics,
	onReviewSessionAssembly,
	runs = EMPTY_RUNS,
	benchmarks = EMPTY_BENCHMARKS,
	system = null,
}: Readonly<{
	campaignId: string;
	className?: string;
	compact?: boolean;
	recoveryScope?: string | null;
	onDraftStateChange?: (active: boolean) => void;
	onOpenDiagnostics?: () => void;
	onReviewSessionAssembly?: (
		assembly: import("./session-composer-protocol").SessionAssembly,
	) => void;
	runs?: readonly LocalRunSummary[];
	benchmarks?: readonly BenchmarkResult[];
	system?: SystemSnapshot | null;
}>) {
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
	const [files, setFiles] = useState<readonly CraigFileSelection[]>([]);
	const source =
		files.find((item) => item.source && item.state === "valid")?.source ?? null;
	const exactDuplicateCount = files.filter(
		(item) => item.state === "duplicate",
	).length;
	const [intentRequest, setIntentRequest] =
		useState<SessionTranscriptionIntent | null>(null);
	const [composerActive, setComposerActive] = useState(false);
	const [sourceRecoveryActive, setSourceRecoveryActive] = useState(false);
	const [technicalOpen, setTechnicalOpen] = useState(false);
	const [technicalTarget, setTechnicalTarget] =
		useState<SessionRecoveryTarget | null>(null);
	const [busy, setBusy] = useState(false);
	const [pendingStage, setPendingStage] = useState<PendingStage | null>(null);
	const [dragActive, setDragActive] = useState(false);
	const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [capabilityError, setCapabilityError] = useState<string | null>(null);
	const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
	const [preparation, setPreparation] = useState<PreparationStatus | null>(null);
	const [preparationCancelling, setPreparationCancelling] = useState(false);
	const [qwenReleaseAvailability, setQwenReleaseAvailability] = useState<
		QwenRuntimeReleaseAvailability | "checking" | null
	>(null);
	const request = useRef<AbortController | null>(null);
	const fallbackPending = useRef<SessionComposerPendingSubmission | null>(null);
	const historicalAvailabilityFailure = useRef<{
		code: AvailabilityFailure;
		message: string;
	} | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const handleChildError = useCallback(
		(message: string, availabilityFailure?: AvailabilityFailure) => {
			historicalAvailabilityFailure.current = availabilityFailure
				? { code: availabilityFailure, message }
				: null;
			setRecoveryNotice(null);
			setError(message);
		},
		[],
	);

	const openTechnicalRecovery = useCallback((target?: SessionRecoveryTarget) => {
		setTechnicalTarget(target ?? null);
		setTechnicalOpen(true);
	}, []);

	const openSourceRecovery = useCallback(() => {
		setSourceRecoveryActive(true);
		setIntentRequest(null);
		setAdvancedOpen(false);
		setFiles([]);
		setError(null);
		setRecoveryNotice(null);
		setStatus(
			"Selecione novamente o ZIP original. O workspace da sessão permanece preservado enquanto a fonte local é restaurada.",
		);
		window.requestAnimationFrame(() => fileInput.current?.click());
	}, []);

	const startNewTranscription = useCallback(() => {
		setIntentRequest(null);
		setComposerActive(false);
		setSourceRecoveryActive(false);
		setFiles([]);
		setSessionId("");
		setContext("");
		setGlossary("");
		setAdvancedOpen(false);
		setTechnicalOpen(false);
		setTechnicalTarget(null);
		setError(null);
		setRecoveryNotice(null);
		setStatus("Pronto para iniciar uma nova transcrição.");
	}, []);

	useEffect(() => {
		return () => request.current?.abort();
	}, []);

	useEffect(() => {
		if (!paired) {
			request.current?.abort();
			setCapabilities(null);
			setProfile("");
			setSourceRecoveryActive(false);
			setCapabilityError(null);
			setRecoveryNotice(null);
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
				const recoveredFailure = historicalAvailabilityFailure.current;
				if (recoveredFailure) {
					historicalAvailabilityFailure.current = null;
					setError((current) =>
						current === recoveredFailure.message ? null : current,
					);
					setRecoveryNotice(
						recoveredAvailabilityNotice(recoveredFailure.code),
					);
				}
			} catch (cause) {
				if (!stopped && !controller.signal.aborted) {
					setRecoveryNotice(null);
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
			campaignId: campaignId,
			sessionId,
			sourceId: source?.sourceId ?? `craig-${"0".repeat(64)}`,
			profileId: profile,
			glossary,
			context,
		});
	}, [campaignId, context, glossary, profile, sessionId, source]);
	const requestTooLarge =
		requestBytes !== null && requestBytes > LOCAL_JSON_BODY_MAX_BYTES;

	const draftActive = Boolean(
		busy ||
			intentRequest ||
			composerActive ||
			files.length ||
			sessionId.trim() ||
			context.trim() ||
			glossary.trim(),
	);
	useEffect(() => {
		onDraftStateChange?.(draftActive);
		return () => onDraftStateChange?.(false);
	}, [draftActive, onDraftStateChange]);

	if (!paired) return null;

	function applyFiles(nextFiles: readonly File[]) {
		if (!nextFiles.length || busy || intentRequest) return;
		setStatus(null);
		setError(null);
		setRecoveryNotice(null);
		historicalAvailabilityFailure.current = null;
		setFiles((current) => {
			const next = appendCraigFiles(current, nextFiles);
			if (!sessionId) {
				const first = next.find((item) => item.state !== "invalid");
				const suggestion = first
					? suggestSessionIdFromFilename(first.file.name)
					: "";
				if (suggestion) setSessionId(suggestion);
			}
			return next;
		});
	}

	function removeFile(id: string) {
		if (busy || intentRequest) return;
		setFiles((current) => removeCraigFileSelection(current, id));
	}

	function moveFile(id: string, direction: -1 | 1) {
		if (busy || intentRequest) return;
		setFiles((current) => moveCraigFileSelection(current, id, direction));
	}

	function handleOrderDrop(event: DragEvent<HTMLLIElement>, targetId: string) {
		event.preventDefault();
		if (busy || intentRequest) return;
		const movingId = event.dataTransfer.getData("text/plain") || draggedFileId;
		setDraggedFileId(null);
		if (!movingId || movingId === targetId) return;
		setFiles((current) => {
			const targetIndex = current.findIndex((item) => item.id === targetId);
			return targetIndex < 0
				? current
				: reorderCraigFileSelection(current, movingId, targetIndex);
		});
	}

	function handleDrop(event: DragEvent<HTMLButtonElement>) {
		event.preventDefault();
		setDragActive(false);
		if (busy || intentRequest) return;
		applyFiles(Array.from(event.dataTransfer.files));
	}

	async function revalidateSelectedCampaign(
		signal: AbortSignal,
		statusMessage: string,
	): Promise<boolean> {
		setStatus(statusMessage);
		try {
			await validateProcessingCampaignForEnqueue(campaignId, signal);
			return true;
		} catch (cause) {
			if (
				cause instanceof ProcessingCampaignValidationError &&
				cause.code === "campaign_unavailable"
			) {
				setError(
					"A campanha deixou de estar ativa ou seu acesso de processamento mudou. Nenhum trabalho novo foi criado. Recarregue a seleção de campanha antes de tentar novamente.",
				);
			} else {
				setError(
					"Não foi possível revalidar a campanha com segurança. Nenhum trabalho novo foi criado; tente novamente quando o Edit estiver disponível.",
				);
			}
			return false;
		}
	}

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (
			busy ||
			intentRequest ||
			!profile ||
			!canSubmit ||
			profileBlocked ||
			stageableCraigFiles(files).length === 0
		)
			return;
		if (qwenRuntimeUpgradeRequired) {
			setError(qwenRuntimeBlockMessage);
			return;
		}
		if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) {
			setError(
				"Use um ID de sessão com letras, números, _ ou -, até 128 caracteres.",
			);
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
		if (
			!(await revalidateSelectedCampaign(
				controller.signal,
				"Confirmando acesso à campanha antes de preparar arquivos locais…",
			))
		)
			return;
		setStatus("Validando os ZIPs no Companion local…");

		let stagedSelections = [...files];
		const patch = (
			id: string,
			change: Partial<Omit<CraigFileSelection, "id" | "file">>,
		) => {
			stagedSelections = replaceCraigFileSelection(
				stagedSelections,
				id,
				change,
			);
			setFiles(stagedSelections);
		};

		try {
			for (const item of stagedSelections) {
				if (item.state === "invalid") continue;
				if (item.source && (item.state === "valid" || item.state === "duplicate"))
					continue;
				patch(item.id, { state: "validating", error: null });
				try {
					const staged = await bridge.craigSource(item.file, controller.signal);
					patch(item.id, { state: "valid", source: staged, error: null });
				} catch (cause) {
					patch(item.id, {
						state: "error",
						source: null,
						error:
							cause instanceof BridgeError
								? cause.serverCode
									? localOperationMessage(cause.serverCode)
									: messageFor(cause.code)
								: messageFor("service_error"),
					});
				}
				if (controller.signal.aborted) return;
			}

			stagedSelections = markExactSourceDuplicates(stagedSelections);
			setFiles(stagedSelections);
			const stagedSources = uniqueStagedCraigSources(stagedSelections);
			if (!stagedSources.length) {
				setError(
					"Nenhum ZIP válido ficou pronto. Corrija somente os arquivos com erro e tente novamente.",
				);
				return;
			}

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
				setStatus("Preparando o perfil uma vez para toda a sessão…");
				let observed = preparation;
				const preparationSource = stagedSources[0]!;
				if (observed?.active) {
					if (
						observed.sourceId !== preparationSource.sourceId ||
						observed.profileId !== profile
					) {
						setError(
							"Já existe outra preparação em andamento. Acompanhe ou cancele a operação atual antes de iniciar outra.",
						);
						return;
					}
				} else {
					observed = await bridge.prepareProfile(
						preparationSource.sourceId,
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
				setStatus("Perfil pronto. Confirmando capacidade do Companion…");
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
					setError(
						"O Agent concluiu a preparação, mas ainda não anunciou o perfil como pronto.",
					);
					return;
				}
			}

			if (
				!(await revalidateSelectedCampaign(
					controller.signal,
					"Reconfirmando acesso à campanha antes de criar o trabalho…",
				))
			)
				return;

			const sessionIntentCapabilities = [
				"transcription.session-workspace",
				"transcription.session-intent",
				"transcription.session-timeline",
				"transcription.session-participants",
				"transcription.session-assembly",
				"transcription.session-assembly.review",
			];
			const supportsSessionIntent = sessionIntentCapabilities.every((capability) =>
				currentCapabilities.capabilities.includes(capability),
			);
			if (!supportsSessionIntent) {
				if (stagedSources.length !== 1) {
					setError(
						"Este Companion suporta uma gravação por vez. Atualize o aplicativo local para transcrever vários ZIPs como uma única sessão.",
					);
					return;
				}
				const staged = stagedSources[0]!;
				const signature = JSON.stringify([
					campaignId,
					sessionId,
					staged.sourceId,
					profile,
					glossary,
					context,
					false,
				]);
				const pending = await resolveSessionComposerPendingSubmission({
					storage: window.localStorage,
					recoveryScope,
					campaignId: campaignId,
					sessionId,
					sourceId: staged.sourceId,
					profileId: profile,
					requestSignature: signature,
					existing: fallbackPending.current,
				});
				fallbackPending.current = pending;
				setPendingStage("submitting");
				setStatus("Enviando a gravação ao Companion local…");
				const job = await bridge.transcription(
					{
						campaignId: campaignId,
						sessionId,
						sourceId: staged.sourceId,
						profileId: profile,
						glossary,
						context,
					},
					pending.key,
					controller.signal,
				);
				confirmSessionComposerPendingSubmission(window.localStorage, pending);
				fallbackPending.current = null;
				setSourceRecoveryActive(false);
				setFiles([]);
				setStatus(
					`Job ${job.id} confirmado no Companion · ${job.status === "succeeded" ? "concluído" : "acompanhe na fila"}.`,
				);
				return;
			}

			setPendingStage("submitting");
			setStatus(
				stagedSources.length === 1
					? "Iniciando a transcrição da sessão…"
					: `Iniciando a transcrição da sessão com ${stagedSources.length} gravações…`,
			);
			setSourceRecoveryActive(false);
			setAdvancedOpen(false);
			setIntentRequest({
				id: crypto.randomUUID(),
				sessionId,
				sources: stagedSources.map((staged) => ({
					sourceId: staged.sourceId,
					label:
						stagedSelections.find(
							(item) => item.source?.sourceId === staged.sourceId,
						)?.file.name ?? "Gravação",
				})),
				profile,
				context,
				glossary,
			});
		} catch (cause) {
			setError(
				cause instanceof BridgeError
					? cause.serverCode
						? localOperationMessage(cause.serverCode)
						: messageFor(cause.code)
					: messageFor("service_error"),
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
			setPreparation(
				await bridge.prepareProfile(
					preparation.sourceId,
					preparation.profileId,
					controller.signal,
					preparation.purpose,
				),
			);
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
			data-intent-fixed={
				(intentRequest || composerActive) && !sourceRecoveryActive
					? "true"
					: "false"
			}
			aria-labelledby="new-local-transcription"
		>
			<div className={styles.heading}>
				<div>
					<span>Processamento local</span>
					<h2 id="new-local-transcription">Transcrever sessão</h2>
				</div>
				<small>1..N ZIPs Craig → uma transcrição contínua</small>
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
						data-selected={files.length ? "true" : "false"}
					>
						<input
							ref={fileInput}
							className={styles.fileInput}
							type="file"
							multiple
							accept=".zip,application/zip"
							aria-label="Export do Craig"
							disabled={busy || Boolean(intentRequest)}
							onChange={(event) => {
								applyFiles(Array.from(event.target.files ?? []));
								event.currentTarget.value = "";
							}}
						/>
						<button
							type="button"
							className={styles.dropAction}
							data-craig-drop-target="true"
							disabled={busy || Boolean(intentRequest)}
							onClick={() => fileInput.current?.click()}
							onDragEnter={(event) => {
								event.preventDefault();
								if (!busy && !intentRequest) setDragActive(true);
							}}
							onDragOver={(event) => {
								event.preventDefault();
								if (!busy && !intentRequest) setDragActive(true);
							}}
							onDragLeave={(event) => {
								if (
									event.currentTarget.contains(
										event.relatedTarget as Node | null,
									)
								)
									return;
								setDragActive(false);
							}}
							onDrop={handleDrop}
						>
							<span className={styles.dropGlyph} aria-hidden="true">
								{files.length ? files.length : "ZIP"}
							</span>
							<span className={styles.dropCopy}>
								<strong>
									{files.length
										? `${files.length} ${files.length === 1 ? "gravação selecionada" : "gravações selecionadas"}`
										: "Arraste um ou vários ZIPs do Craig aqui"}
								</strong>
								<span>
									{intentRequest
										? "Intenção iniciada; o conjunto está fixado nesta sessão."
										: files.length
											? "solte mais ZIPs para adicionar sem apagar os anteriores"
											: "ou escolha um ou vários arquivos"}
								</span>
							</span>
						</button>
					</div>

					{files.length > 1 ? (
						<section
							className={styles.sessionPreview}
							aria-labelledby="multi-session-preview-title"
						>
							<div className={styles.sessionPreviewHeader}>
								<div>
									<strong id="multi-session-preview-title">
										{files.length} gravações serão unidas em uma única sessão
									</strong>
									<span>A saída será uma única transcrição contínua da sessão.</span>
								</div>
							</div>
							<ul
								className={styles.sessionSummary}
								aria-label="Resumo da montagem da sessão"
							>
								<li>✓ Ordem da sessão definida</li>
								<li>
									◐ Horário real só é usado quando o Craig fornece um horário confiável
								</li>
								<li>
									✓ Gap conhecido é informação; overlap confirmado pode exigir decisão
								</li>
							</ul>
							<p className={styles.sessionOrderHelp}>
								A sequência abaixo é o fallback editorial. Quando os próprios arquivos Craig
								 fornecerem horários absolutos confiáveis, o TDA usa automaticamente a ordem
								 factual e preserva gaps reais. Sem essa evidência, a sequência escolhida por
								 você continua sendo usada.
							</p>
							<div className={styles.orderHeading}>
								<strong>Ordem da sessão</strong>
								<span>
									{intentRequest
										? "A transcrição já começou; qualquer mudança agora exige uma ação explícita."
										: "Arraste as gravações ou use os botões Mover para cima/baixo."}
								</span>
							</div>
						</section>
					) : null}

					{files.length ? (
						<ol
							className={styles.fileList}
							aria-label="Gravações selecionadas"
							aria-describedby={files.length > 1 ? "multi-session-preview-title" : undefined}
						>
							{files.map((item, index) => (
								<li
									key={item.id}
									data-state={item.state}
									data-dragging={draggedFileId === item.id ? "true" : "false"}
									draggable={files.length > 1 && !busy && !intentRequest}
									onDragStart={(event) => {
										if (busy || intentRequest || files.length < 2) return;
										setDraggedFileId(item.id);
										event.dataTransfer.effectAllowed = "move";
										event.dataTransfer.setData("text/plain", item.id);
									}}
									onDragOver={(event) => {
										if (busy || intentRequest || files.length < 2) return;
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
									}}
									onDrop={(event) => handleOrderDrop(event, item.id)}
									onDragEnd={() => setDraggedFileId(null)}
								>
									<div>
										<strong title={item.file.name}>
											{index + 1}. {item.file.name}
										</strong>
										<span>
											{formatSubmissionBytes(item.file.size)} ·{" "}
											{item.state === "selected"
												? "pronta para validar"
												: item.state === "validating"
													? "validando localmente…"
													: item.state === "valid"
														? "validada"
														: item.state === "duplicate"
															? "duplicata exata · será reutilizada uma vez"
															: item.state === "invalid"
																? "arquivo inválido"
																: "falha local"}
										</span>
										{item.error ? <small role="alert">{item.error}</small> : null}
									</div>
									{!intentRequest ? (
										<div className={styles.fileActions}>
											{files.length > 1 ? (
												<>
													<Button
														type="button"
														size="sm"
														variant="tertiary"
														disabled={busy || index === 0}
														aria-label={`Mover ${item.file.name} para cima`}
														onClick={() => moveFile(item.id, -1)}
													>
														Mover para cima
													</Button>
													<Button
														type="button"
														size="sm"
														variant="tertiary"
														disabled={busy || index === files.length - 1}
														aria-label={`Mover ${item.file.name} para baixo`}
														onClick={() => moveFile(item.id, 1)}
													>
														Mover para baixo
													</Button>
												</>
											) : null}
											<Button
												type="button"
												size="sm"
												variant="tertiary"
												disabled={busy}
												aria-label={`Remover ${item.file.name}`}
												onClick={() => removeFile(item.id)}
											>
												Remover
											</Button>
										</div>
									) : null}
								</li>
							))}
						</ol>
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
								disabled={busy || composerActive || Boolean(intentRequest)}
								placeholder="sessao-42"
								aria-describedby="session-id-help"
							/>
							<small id="session-id-help">
								{composerActive
									? "Alvo fixado enquanto o composer desta sessão estiver ativo."
									: "Sugestão vem do nome do ZIP quando o campo está vazio. Sempre editável antes de compor."}
							</small>
						</label>
						<div>
							<span>Perfil</span>
							<Select
								value={profile}
								options={availableProfiles.map((item) => ({
									value: item.id,
									label: submissionProfileLabel(item.id),
								}))}
								onChange={(value) => setProfile(value as TranscriptionProfileId)}
								ariaLabel="Perfil"
								disabled={busy || composerActive || Boolean(intentRequest)}
								required
							/>
						</div>
						<div className={styles.submitRow}>
							<Button
								type="submit"
								variant="primary"
								disabled={
									busy ||
									Boolean(intentRequest) ||
									stageableCraigFiles(files).length === 0 ||
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
										disabled={busy || composerActive || Boolean(intentRequest)}
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
										disabled={busy || composerActive || Boolean(intentRequest)}
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

			{intentRequest || composerActive ? (
				<div className={styles.intentSummary} role="status" data-processing-intent-summary="true">
					<div>
						<strong>{sessionId}</strong>
						<span>
							{files.length
								? `${files.length} ${files.length === 1 ? "gravação" : "gravações"}${exactDuplicateCount === 1 ? " · 1 duplicata exata · será reutilizada uma vez" : exactDuplicateCount > 1 ? ` · ${exactDuplicateCount} duplicatas exatas · serão reutilizadas uma vez cada` : ""} · ${profile ? submissionProfileLabel(profile) : "perfil preservado"}`
								: `Gravações preservadas no Companion · ${profile ? submissionProfileLabel(profile) : "perfil preservado"}`}
						</span>
					</div>
					<small>A intenção da sessão está fixada; acompanhe progresso e decisões abaixo.</small>
				</div>
			) : null}

			{capabilities ? (
				<>
					<SessionIntentCoordinator
						bridge={bridge}
						campaignId={campaignId}
						capabilities={capabilities.capabilities}
						request={intentRequest}
						recoveryScope={recoveryScope}
						disabled={busy || requestTooLarge}
						onActiveChange={setComposerActive}
						onRestoreSessionId={(value) =>
							setSessionId((current) => current || value)
						}
						onRestoreIntent={(restored) => {
							setProfile(restored.profile);
							setContext(restored.context);
							setGlossary(restored.glossary);
						}}
						onStatus={setStatus}
						onError={handleChildError}
						onOpenTechnical={openTechnicalRecovery}
						onSelectSource={openSourceRecovery}
						onReviewAssembly={onReviewSessionAssembly}
						onNewTranscription={startNewTranscription}
					/>
					{composerActive ? (
						<details
							className={styles.technical}
							open={technicalOpen}
							onToggle={(event) =>
								setTechnicalOpen(event.currentTarget.open)
							}
						>
							<summary>
								Detalhes técnicos
								<small>
									ordem, participantes e resultados · use apenas quando necessário
								</small>
							</summary>
							<SessionRecordingComposer
								bridge={bridge}
								campaignId={campaignId}
								capabilities={capabilities.capabilities}
								sessionId={sessionId}
								currentSource={null}
								profile={profile}
								context={context}
								glossary={glossary}
								profileReady={selectedProfileState?.ready === true}
								recoveryScope={recoveryScope}
								disabled={busy || requestTooLarge}
								recoveryFocusTarget={technicalTarget}
								onActiveChange={setComposerActive}
								onRestoreSessionId={(value) =>
									setSessionId((current) => current || value)
								}
								onStatus={setStatus}
								onError={handleChildError}
							/>
						</details>
					) : null}
				</>
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

			{recoveryNotice ? (
				<div
					className={styles.notice}
					role="status"
					data-processing-recovery-history="true"
				>
					<strong>Conexão recuperada.</strong> {recoveryNotice}
				</div>
			) : null}
			{status ? <p className={styles.status} role="status">{status}</p> : null}
			{capabilityError && capabilities ? <p className={styles.inlineError} role="alert">{capabilityError}</p> : null}
			{error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
		</section>
	);

}
