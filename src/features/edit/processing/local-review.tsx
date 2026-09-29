"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { actionStyles, Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import {
	PublicationClientError,
	preflightApprovedLocalReview,
	type PublicationReceiptView,
} from "./publication-client";
import type {
	LocalReview,
	LocalReviewSegment,
	LocalReviewStatus,
	LocalRunSummary,
} from "./protocol";
import styles from "./local-review.module.css";
import { browserHasPendingPublicationForRun, browserPublicationRecovery, PublicationRecoveryError, type PublicationConfirmation } from "./publication-recovery";
import { ReviewConflicts } from "./review-conflicts";
import { prepareReviewRebase, resolveReviewRebase, type ReviewRebase } from "./review-rebase";
import { ParticipantManager } from "./participant-manager";
import { applyParticipantRename } from "./participant-rename";
import { countWordsV1, isReviewStringV1 } from "../../transcript-review/text-contract";
import { localRunKey, serializeLocalRunKey } from "./local-run-key";
import { processingStageLabels } from "./engine-metrics";
import { RunComparisonView } from "./run-comparison-view";

type Props = Readonly<{
	runs: readonly LocalRunSummary[];
	hasMore?: boolean;
	onLoadMore?: () => void | Promise<void>;
	review: LocalReview | null;
	busy: boolean;
	error: string | null;
	publicationEnabled: boolean;
	comparisonEnabled?: boolean;
	onOpen: (sourceId: string, runId: string) => void | Promise<void>;
	onLoadSnapshot: (sourceId: string, runId: string) => Promise<LocalReview>;
	onDeleteRun?: (sourceId: string, runId: string, transcriptSha256: string) => Promise<boolean>;
	onSave: (
		baseline: LocalReview,
		status: LocalReviewStatus,
		segments: readonly LocalReviewSegment[],
	) => void | Promise<void>;
	onLoadLatest?: () => Promise<LocalReview>;
	onRepairTarget?: () => void | Promise<void>;
	onClose: () => void;
	onPublish: (
		review: LocalReview,
		operationId: string,
		expectedCurrentRevisionId: string | null,
		profileScope: string,
	) => Promise<PublicationReceiptView>;
}>;

	function publicationErrorMessage(code: string): string {
		return {
			storage_unavailable: "Não foi possível preservar a operação neste navegador. A preparação da sessão foi bloqueada antes do envio. Libere o armazenamento e tente novamente.",
			pending_mismatch: "Existe uma preparação anterior não reconciliada nesta campanha. Reabra a revisão original ou abandone a recuperação explicitamente.",
			pending_expired: "A recuperação ultrapassou 30 dias. Consulte o recibo ou abandone explicitamente antes de preparar outra sessão.",
			profile_changed: "O perfil autenticado mudou. Consulte novamente a preparação antes de continuar.",
			unauthenticated: "Sua sessão Web expirou. Entre novamente antes de preparar a sessão no Edit.",
			forbidden: "Seu acesso não permite preparar transcrições privadas nesta campanha.",
			publish_capability_undefined:
				"O handoff privado para o Edit ainda não está ativado para esta campanha.",
			approved_review_required:
				"Salve esta revisão como Aprovado localmente antes de preparar a sessão.",
			invalid_payload:
				"O servidor recusou o vínculo ou o conteúdo desta revisão.",
			too_large: "A revisão excede o limite aceito para o handoff privado.",
			not_found:
				"A sessão vinculada não foi localizada no escopo autorizado.",
			stale_current: "A revisão privada atual mudou. Consulte novamente e confirme a substituição antes de preparar a sessão.",
			conflict:
				"Esta operação conflita com um handoff já registrado. Recarregue antes de continuar.",
			dependency_unavailable:
				"O serviço de handoff está indisponível e não confirmou nenhuma alteração.",
			unconfirmed:
				"A resposta foi perdida e o readback ainda não confirmou o commit. Repetir reutilizará a mesma operação.",
		}[code] ?? `Preparação não confirmada · ${code}`;
	}


function formatDate(value: string | null): string {
	if (!value) return "data desconhecida";
	return new Date(value).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatSeconds(value: number | null): string {
	if (value === null) return "—";
	const seconds = Math.round(value);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return hours
		? `${hours}h ${String(minutes).padStart(2, "0")}m`
		: minutes
			? `${minutes}m ${String(rest).padStart(2, "0")}s`
			: `${rest}s`;
}

function formatTimestamp(value: number): string {
	const seconds = Math.max(0, Math.floor(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

function timelineStart(segment: LocalReviewSegment): number {
	return segment.timelineStart ?? segment.start;
}

function timelineEnd(segment: LocalReviewSegment): number {
	return segment.timelineEnd ?? segment.end;
}

function formatRealtime(rtf: number | null): string {
	if (rtf === null || rtf <= 0) return "—";
	const speed = 1 / rtf;
	return `${speed >= 10 ? speed.toFixed(1) : speed.toFixed(2)}×`;
}

function formatRunExecution(run: LocalRunSummary): string {
	const values = [run.device, run.computeType, run.alignment].filter(Boolean);
	return values.length ? values.join(" · ") : "execução não registrada";
}

function formatVram(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function formatRuntime(run: LocalRunSummary): string {
	const lineage = run.executionLineage;
	if (!lineage) return "—";
	const runtime = [lineage.runtimeFamily, lineage.runtimeVersion]
		.filter(Boolean)
		.join(" ");
	return runtime || lineage.companionVersion
		? [runtime || null, lineage.companionVersion ? `Companion ${lineage.companionVersion}` : null]
				.filter(Boolean)
				.join(" · ")
		: "—";
}

function reviewError(code: string | null): string | null {
	if (!code) return null;
	return {
		PUBLICATION_TARGET_PROVENANCE_UNAVAILABLE: "A origem original não está disponível. Restaure um backup completo; nenhum destino foi inferido.",
		PUBLICATION_TARGET_PROVENANCE_MISMATCH: "A origem e o run divergem. O reparo foi bloqueado e seus arquivos foram preservados.",
		PUBLICATION_TARGET_CONFLICT: "Existe um vínculo divergente. O reparo não troca a sessão de destino.",
		LOCAL_REVIEW_DRAFT_CONFLICT:
			"Este draft mudou em outra aba ou processo. Suas alterações continuam nesta tela. Compare com a versão mais recente para continuar sem descartar seu trabalho.",
		LOCAL_REVIEW_WRITE_UNCONFIRMED:
			"A gravação pode ter ocorrido, mas não foi possível confirmar sua persistência. Preserve o texto e confira a revisão salva antes de tentar novamente.",
		LOCAL_REVIEW_SNAPSHOT_CONTRACT_REQUIRED:
			"Atualize o Companion e a página para salvar revisões com verificação de conteúdo.",
		LOCAL_REVIEW_SEGMENT_TEXT_INVALID:
			"O texto contém caracteres inválidos ou excede o limite de 100.000 caracteres. Corrija antes de salvar.",
		LOCAL_REVIEW_SEGMENT_SPEAKER_INVALID:
			"O nome do participante contém caracteres inválidos ou excede o limite de 160 caracteres. Corrija antes de salvar.",
		LOCAL_REVIEW_LEGACY_STRING_REPAIR_REQUIRED:
			"Esta revisão antiga contém caracteres incompatíveis. O arquivo foi preservado e precisa de reparo local explícito; consulte o procedimento de reparo de revisão.",
		LOCAL_REVIEW_BASE_RUN_INVALID:
			"O run bruto não passou na verificação de integridade. Ele não foi alterado.",
		LOCAL_REVIEW_APPROVAL_REQUIRES_SAVED_DRAFT:
			"Salve primeiro as alterações desta revisão. A aprovação só pode ser aplicada ao draft exato já persistido.",
		LOCAL_REVIEW_RUN_NOT_VISIBLE:
			"Este run não está mais elegível para revisão.",
		LOCAL_REVIEW_REQUEST_TOO_LARGE:
			"O request da revisão excede o limite local de 32 MiB. Seu texto nesta tela foi preservado.",
		LOCAL_REVIEW_DRAFT_TOO_LARGE:
			"O draft serializado excede o limite local de 32 MiB. Reduza o conteúdo antes de salvar novamente.",
		payload_too_large:
			"O draft excede o limite local de 32 MiB.",
		timeout:
			"O Companion demorou demais para responder. Seu draft local nesta tela foi preservado.",
		unreachable:
			"O Companion ficou indisponível. Seu draft nesta tela foi preservado.",
		invalid_response:
			"O Companion respondeu com um contrato de revisão inválido.",
	}[code] ?? `Não foi possível concluir a revisão local · ${code}`;
}

function RunCard({
	run,
	busy,
	onOpen,
	onDelete,
}: Readonly<{
	run: LocalRunSummary;
	busy: boolean;
	onOpen: () => void;
	onDelete?: () => void;
}>) {
	const model = [run.engine, run.model].filter(Boolean).join(" · ") || "modelo desconhecido";
	const measured = run.stats.processingMetrics;
	const processingSeconds = measured?.totalProcessingSeconds ?? run.stats.processingSeconds;
	const measuredAudio = measured ? measured.freshAudioWorkSeconds + measured.reusedAudioWorkSeconds : 0;
	const rtf = measured ? (measuredAudio > 0 ? measured.totalProcessingSeconds / measuredAudio : null) : run.stats.rtf;
	const primaryFacts = [
		{ label: "Duração", value: run.stats.sessionDurationSeconds != null ? formatSeconds(run.stats.sessionDurationSeconds) : null },
		{ label: "Processamento", value: processingSeconds != null ? formatSeconds(processingSeconds) : null },
		{ label: "Velocidade", value: rtf != null ? formatRealtime(rtf) : null },
		{ label: "Palavras", value: run.stats.wordCount != null ? String(run.stats.wordCount) : null },
		{ label: "Turnos", value: run.stats.turnCount != null ? String(run.stats.turnCount) : null },
		{ label: "Warnings", value: run.stats.warningCount != null ? String(run.stats.warningCount) : null },
	].filter((item): item is { label: string; value: string } => item.value !== null);
	const secondaryFacts = [
		{ label: "Concluído", value: run.completedAt ? formatDate(run.completedAt) : null },
		{ label: "Trabalho de áudio", value: run.stats.audioWorkSeconds != null ? formatSeconds(run.stats.audioWorkSeconds) : null },
		{ label: "RTF", value: rtf != null ? rtf.toFixed(3) : null },
		{ label: "Segmentos", value: run.stats.segmentCount != null ? String(run.stats.segmentCount) : null },
		{ label: "Tracks", value: run.stats.trackCount != null ? String(run.stats.trackCount) : null },
		{ label: "Deduplicados", value: run.stats.deduplicatedSegmentCount != null ? String(run.stats.deduplicatedSegmentCount) : null },
		{ label: "Execução", value: formatRunExecution(run) },
	].filter((item): item is { label: string; value: string } => item.value !== null);
	return (
		<article className={styles.runCard}>
			<div className={styles.runHeader}>
				<div>
					<span className={styles.eyebrow}>Resultado local</span>
					<h3>{run.profileId}</h3>
				</div>
				<div className={styles.runHeaderActions}>
					<StatusPill tone="success">Concluído</StatusPill>
					<div className={styles.runCardActions}>
						<Button size="sm" variant="primary" disabled={busy} onClick={onOpen}>
							Revisar resultado
						</Button>
						{onDelete ? (
							<details className={styles.runOverflow}>
								<summary aria-label="Mais ações do resultado">•••</summary>
								<div>
									<Button size="sm" variant="tertiary" disabled={busy} onClick={onDelete}>
										Excluir resultado local…
									</Button>
								</div>
							</details>
						) : null}
					</div>
				</div>
			</div>
			<p className={styles.runModel}>
				{model}
				{run.modelRevision ? ` · rev ${run.modelRevision}` : ""}
			</p>
			{primaryFacts.length ? (
				<dl className={styles.runFacts} data-run-primary-facts="true">
					{primaryFacts.map((fact) => (
						<div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
					))}
				</dl>
			) : null}
			<details className={styles.runDisclosure}>
				<summary>Execução e métricas</summary>
				<dl className={styles.runFactsSecondary}>
					{secondaryFacts.map((fact) => (
						<div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
					))}
				</dl>
			</details>
			{measured ? (
				<details className={styles.runDisclosure}>
					<summary>Tempo comparável e reaproveitamento</summary>
					<p>Inclui validação, modelos, transcrição, alinhamento e consolidação dentro da engine. Não inclui preparação externa nem o tempo completo do job.</p>
					<p>{measured.freshAsrTracks} faixas com ASR novo · {measured.textCheckpointReusedTracks} com texto reaproveitado · {measured.completedCheckpointReusedTracks} concluídas reaproveitadas.</p>
					<p>{measured.freshCalibrationEligible ? "Amostra integral elegível para calibração compatível." : "Resultado com reaproveitamento ou sem áudio: não usar como throughput de ASR integral."}</p>
					<dl>{Object.entries(measured.stageSeconds).map(([stage, seconds]) => <div key={stage}><dt>{processingStageLabels[stage]}</dt><dd>{formatSeconds(seconds)}</dd></div>)}</dl>
					<small>Registro original: {formatSeconds(run.stats.processingSeconds)} · medição {measured.version}</small>
				</details>
			) : (
				<details className={styles.runDisclosure}>
					<summary>Medição</summary>
					<p>Tempo histórico sem medição comparável entre engines.</p>
				</details>
			)}
			<details className={styles.runDisclosure}>
				<summary>Integridade e IDs</summary>
				<div className={styles.runIdentity}>
					<span title={run.sourceId}>Fonte {run.sourceId}</span>
					<span title={run.runId}>Run {run.runId}</span>
					<span title={run.transcriptSha256}>SHA {run.transcriptSha256}</span>
					{run.publicationTarget ? (
						<span>Destino {run.publicationTarget.campaignSlug} · sessão {run.publicationTarget.sourceSessionId}</span>
					) : (
						<span>Sem destino cloud vinculado</span>
					)}
				</div>
			</details>
		</article>
	);
}

function ReviewEditor({
	review,
	busy,
	error,
	onSave,
	onClose,
	publicationEnabled,
	onPublish,
	onRepairTarget,
	onLoadLatest,
}: Readonly<{
	review: LocalReview;
	busy: boolean;
	error: string | null;
	onSave: Props["onSave"];
	onClose: () => void;
	publicationEnabled: boolean;
	onPublish: Props["onPublish"];
	onRepairTarget: Props["onRepairTarget"];
	onLoadLatest: Props["onLoadLatest"];
}>) {
	const scrollAnchor = useRef<{ key: string; top: number } | null>(null);
	const restoreAnchor = useRef(false);
	const lastServerReview = useRef(review);
	const confirmationRef = useRef<HTMLElement | null>(null);
	const [baseline, setBaseline] = useState(review);
	const [comparison, setComparison] = useState<ReviewRebase | null>(null);
	const [comparing, setComparing] = useState(false);
	const [comparisonError, setComparisonError] = useState<string | null>(null);
	const [segments, setSegments] = useState<LocalReviewSegment[]>(() =>
		review.segments.map((segment) => ({ ...segment })),
	);
	const [status, setStatus] = useState<LocalReviewStatus>(review.status);
	const [dirty, setDirty] = useState(false);
	const [query, setQuery] = useState("");
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const editingTextRef = useRef<HTMLTextAreaElement | null>(null);
	const [publicationRecovery, setPublicationRecovery] =
		useState<PublicationConfirmation | null>(null);
	const publicationCurrent = publicationRecovery?.current;
	const [publishConfirmation, setPublishConfirmation] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [publicationErrorCode, setPublicationErrorCode] = useState<string | null>(
		null,
	);
	const [publicationReceipt, setPublicationReceipt] =
		useState<PublicationReceiptView | null>(null);
	const canSave = review.snapshotContract === "tda_local_review_cas_v1";
	const ephemeral = review.persistence === "ephemeral_base";
	const persisted =
		review.persistence === "persisted" &&
		review.draftRevision !== null &&
		review.draftSha256 !== null;
	const currentApproval =
		review.status === "approved_local" && review.approvalCurrent && !dirty;
	const editingBlocked =
		busy ||
		comparing ||
		comparison !== null ||
		publishing ||
		publishConfirmation;

	useLayoutEffect(() => {
		if (!restoreAnchor.current || !scrollAnchor.current || segments.length === 0)
			return;
		restoreAnchor.current = false;
		const anchor = scrollAnchor.current;
		const row = Array.from(
			document.querySelectorAll<HTMLElement>("[data-review-segment]"),
		).find((node) => node.dataset.reviewSegment === anchor.key);
		if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
	}, [segments]);

	useEffect(() => {
		if (editingKey) editingTextRef.current?.focus();
	}, [editingKey]);

	useEffect(() => {
		if (!publishConfirmation) return;
		confirmationRef.current?.focus({ preventScroll: true });
	}, [publishConfirmation]);

	useEffect(() => {
		if (lastServerReview.current === review) return;
		lastServerReview.current = review;
		setBaseline(review);
		setSegments(review.segments.map((segment) => ({ ...segment })));
		setStatus(review.status);
		setDirty(false);
		setPublicationErrorCode(null);
		restoreAnchor.current = scrollAnchor.current !== null;
	}, [review]);

	const invalidStrings = segments.some(
		(segment) =>
			!isReviewStringV1(segment.text, "text") ||
			!isReviewStringV1(segment.speaker, "speaker"),
	);
	const publicationPreflight = useMemo(
		() =>
			publicationEnabled &&
			review.publicationTarget &&
			review.status === "approved_local" &&
			!dirty
				? preflightApprovedLocalReview(review)
				: null,
		[dirty, publicationEnabled, review],
	);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);

	useEffect(() => {
		if (
			!publicationEnabled ||
			!review.publicationTarget ||
			review.status !== "approved_local" ||
			dirty
		)
			return;
		const hasPendingIntent = browserHasPendingPublicationForRun(
			review.sourceId,
			review.runId,
		);
		// A deterministic local preflight failure must not perform current/readback
		// network work merely to rediscover the same invalid payload. The only
		// exception is a durable unresolved operation, which still deserves
		// reconciliation before the operator can safely move on.
		if (publicationPreflight?.eligible !== true && !hasPendingIntent) return;
		let cancelled = false;
		const invalidate = () => {
			setPublicationRecovery(null);
			setPublicationReceipt(null);
			setPublishConfirmation(false);
		};
		const recover = async () => {
			invalidate();
			setPublishing(true);
			try {
				const result = await browserPublicationRecovery().inspect(review);
				if (!cancelled) {
					setPublicationRecovery(result);
					setPublicationReceipt(result.receipt);
					setPublicationErrorCode(null);
				}
			} catch (cause) {
				if (!cancelled)
					setPublicationErrorCode(
						cause instanceof PublicationClientError ||
						cause instanceof PublicationRecoveryError
							? cause.code
							: "dependency_unavailable",
					);
			} finally {
				if (!cancelled) setPublishing(false);
			}
		};
		const focus = () => {
			void recover();
		};
		const visibility = () => {
			if (document.visibilityState === "hidden") invalidate();
		};
		void recover();
		window.addEventListener("focus", focus);
		window.addEventListener("storage", focus);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			cancelled = true;
			window.removeEventListener("focus", focus);
			window.removeEventListener("storage", focus);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [publicationEnabled, review, dirty, publicationPreflight?.eligible]);

	const visible = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase("pt-BR");
		return segments
			.map((segment, index) => ({ segment, index }))
			.filter(({ segment }) =>
				!normalized
					? true
					: [segment.speaker, segment.text, formatTimestamp(timelineStart(segment))]
							.join(" ")
							.toLocaleLowerCase("pt-BR")
							.includes(normalized),
			)
			.sort(
				(left, right) =>
					timelineStart(left.segment) - timelineStart(right.segment) ||
					timelineEnd(left.segment) - timelineEnd(right.segment) ||
					left.segment.trackNumber - right.segment.trackNumber ||
					left.segment.segmentId.localeCompare(right.segment.segmentId),
			);
	}, [query, segments]);
	const reviewed = segments.filter((segment) => segment.reviewed).length;
	const words = segments.reduce(
		(total, segment) => total + countWordsV1(segment.text),
		0,
	);
	const participants = new Set(segments.map((segment) => segment.speaker)).size;

	const journeyActiveIndex = publicationReceipt
		? 4
		: currentApproval
			? 3
			: persisted && !dirty
				? 2
				: dirty
					? 1
					: 0;
	const journeySteps = [
		{ label: "Revisar", description: "Conteúdo local" },
		{ label: "Salvar", description: "Snapshot exato" },
		{ label: "Aprovar", description: "Decisão humana" },
		{ label: "Preparar no Edit", description: "Handoff privado" },
	] as const;

	type Blocker = Readonly<{
		key: string;
		tone: "error" | "warning" | "info";
		title: string;
		detail: string;
		technical?: string;
	}>;
	const dominantBlocker: Blocker | null = (() => {
		if (!canSave)
			return {
				key: "agent-update",
				tone: "warning",
				title: "Atualize o Companion para continuar editando",
				detail:
					"A leitura permanece disponível, mas este Agent não oferece o contrato de snapshot necessário para salvar com segurança.",
			};
		if (invalidStrings)
			return {
				key: "invalid-strings",
				tone: "error",
				title: "Há campos editoriais inválidos",
				detail:
					"Corrija o texto ou participante destacado antes de salvar. O conteúdo desta tela foi preservado.",
			};
		const localFailure = reviewError(error);
		if (localFailure)
			return {
				key: error ?? "review-error",
				tone: "error",
				title:
					error === "LOCAL_REVIEW_DRAFT_CONFLICT"
						? "Esta revisão mudou em outro lugar"
						: "A revisão local precisa de atenção",
				detail: localFailure,
				technical: error ?? undefined,
			};
		if (publicationRecovery?.pending)
			return {
				key: "pending-handoff",
				tone: publicationRecovery.blocked ? "warning" : "info",
				title: publicationRecovery.blocked
					? "Existe um handoff anterior que precisa ser resolvido"
					: "O handoff anterior ainda não foi confirmado",
				detail:
					publicationRecovery.blocked === "mismatch"
						? "A operação pendente pertence a outra revisão. Reabra a revisão original para consultar o recibo ou abandone essa intenção explicitamente."
						: publicationRecovery.blocked === "expired"
							? "A recuperação ultrapassou 30 dias. O recibo ainda pode ser consultado, mas um novo envio permanece bloqueado."
							: "A consulta e qualquer repetição reutilizam a mesma identidade de operação; nenhum novo handoff será criado silenciosamente.",
			};
		if (
			currentApproval &&
			publicationPreflight &&
			!publicationPreflight.eligible
		)
			return publicationPreflight.reason === "too_large"
				? {
						key: "too-large",
						tone: "error",
						title: "A revisão excede o limite do handoff",
						detail: `O payload canônico possui ${publicationPreflight.payloadBytes?.toLocaleString("pt-BR") ?? "mais que o permitido"} bytes; o limite é ${publicationPreflight.maxPayloadBytes.toLocaleString("pt-BR")} bytes. Nenhuma operação cloud foi criada.`,
						technical: "too_large",
					}
				: {
						key: "invalid-preflight",
						tone: "error",
						title: "Esta revisão não é compatível com o contrato atual de handoff",
						detail:
							"O bloqueio aconteceu localmente, antes de qualquer envio mutável. Salvar ou reabrir não é recomendado como tentativa genérica; consulte os detalhes técnicos ou atualize o cliente quando houver uma versão corrigida.",
						technical: publicationPreflight.reason ?? "invalid_payload",
					};
		if (publicationErrorCode)
			return {
				key: publicationErrorCode,
				tone:
					publicationErrorCode === "dependency_unavailable" ||
					publicationErrorCode === "unconfirmed"
						? "warning"
						: "error",
				title:
					publicationErrorCode === "forbidden"
						? "Sua conta não pode preparar esta campanha"
						: publicationErrorCode === "not_found"
							? "A sessão privada ainda não foi resolvida"
							: publicationErrorCode === "stale_current"
								? "A revisão privada mudou desde a confirmação"
								: publicationErrorCode === "invalid_payload"
									? "O handoff recusou este snapshot"
									: "A preparação da sessão precisa de atenção",
				detail:
					publicationErrorCode === "not_found"
						? "A identidade vinculada ainda não corresponde a uma sessão privada disponível. Tente preparar novamente; se persistir, confira o vínculo original."
						: publicationErrorMessage(publicationErrorCode),
				technical: publicationErrorCode,
			};
		if (currentApproval && !publicationEnabled)
			return {
				key: "handoff-disabled",
				tone: "info",
				title: "O handoff privado está desativado neste ambiente",
				detail:
					"A revisão continua aprovada localmente. Nenhum envio será tentado até o boundary de Sessões do Edit estar habilitado.",
			};
		if (!review.publicationTarget && (onRepairTarget || currentApproval))
			return {
				key: "target-unavailable",
				tone: "warning",
				title:
					review.publicationTargetState === "invalid"
						? "O vínculo original precisa ser reparado"
						: "O destino privado ainda não está vinculado",
				detail: onRepairTarget
					? "O Companion só pode preparar a sessão usando provenance verificada. Repare o vínculo original; nenhum destino será inferido por nome ou contexto recente."
					: "A revisão está preservada, mas esta tela não possui prova suficiente para resolver o destino privado. Nenhum destino será inferido automaticamente.",
				technical: review.publicationTargetState ?? "unbound",
			};
		return null;
	})();

	function rememberVisibleAnchor() {
		const anchor = Array.from(
			document.querySelectorAll<HTMLElement>("[data-review-segment]"),
		).find((node) => {
			const rect = node.getBoundingClientRect();
			return rect.bottom > 0 && rect.top < window.innerHeight;
		});
		scrollAnchor.current = anchor
			? {
					key: anchor.dataset.reviewSegment ?? "",
					top: anchor.getBoundingClientRect().top,
				}
			: null;
	}

	function patch(index: number, value: Partial<LocalReviewSegment>) {
		if (status === "approved_local") setStatus("reviewed");
		setSegments((current) =>
			current.map((segment, candidate) =>
				candidate === index ? { ...segment, ...value } : segment,
			),
		);
		setDirty(true);
		setPublicationReceipt(null);
		setPublicationRecovery(null);
		setPublishConfirmation(false);
	}

	function attemptClose() {
		if (
			dirty &&
			!window.confirm(
				"Há alterações locais ainda não salvas. Fechar a revisão e descartá-las desta tela?",
			)
		)
			return;
		onClose();
	}

	function saveDraft() {
		if (editingBlocked || !canSave || invalidStrings) return;
		rememberVisibleAnchor();
		void onSave(
			baseline,
			status === "approved_local" ? "reviewed" : status,
			segments,
		);
	}

	function approveReview() {
		if (
			editingBlocked ||
			!canSave ||
			invalidStrings ||
			!persisted ||
			dirty
		)
			return;
		rememberVisibleAnchor();
		void onSave(baseline, "approved_local", segments);
	}

	async function preparePublicationConfirmation() {
		setPublishing(true);
		setPublicationErrorCode(null);
		setPublicationRecovery(null);
		setPublishConfirmation(false);
		try {
			const result = await browserPublicationRecovery().inspect(review);
			setPublicationRecovery(result);
			setPublicationReceipt(result.receipt);
			if (!result.receipt && !result.blocked) setPublishConfirmation(true);
		} catch (cause) {
			setPublicationErrorCode(
				cause instanceof PublicationClientError ||
				cause instanceof PublicationRecoveryError
					? cause.code
					: "dependency_unavailable",
			);
		} finally {
			setPublishing(false);
		}
	}

	async function confirmPublication() {
		if (
			publishing ||
			!publicationRecovery ||
			publicationRecovery.blocked ||
			dirty ||
			review.status !== "approved_local" ||
			publicationPreflight?.eligible !== true
		)
			return;
		setPublishing(true);
		setPublicationErrorCode(null);
		try {
			const receipt = await browserPublicationRecovery().execute(
				review,
				publicationRecovery,
				onPublish,
			);
			setPublicationReceipt(receipt);
			setPublicationRecovery(null);
		} catch (cause) {
			setPublicationRecovery(null);
			setPublicationErrorCode(
				cause instanceof PublicationClientError ||
				cause instanceof PublicationRecoveryError
					? cause.code
					: "dependency_unavailable",
			);
		} finally {
			setPublishConfirmation(false);
			setPublishing(false);
		}
	}

	async function abandonPublication() {
		if (
			!publicationRecovery?.pending ||
			!window.confirm(
				"O handoff privado anterior pode já ter sido concluído. Abandonar a recuperação não desfaz esse commit; apenas permite formar uma nova intenção editorial, que pode criar outra revisão privada. Nada é publicado no site por esta ação. Continuar?",
			)
		)
			return;
		setPublishing(true);
		setPublishConfirmation(false);
		try {
			await browserPublicationRecovery().abandon(review, publicationRecovery);
			setPublicationRecovery(null);
			setPublicationErrorCode(null);
		} catch (cause) {
			setPublicationRecovery(null);
			setPublicationErrorCode(
				cause instanceof PublicationClientError ||
				cause instanceof PublicationRecoveryError
					? cause.code
					: "dependency_unavailable",
			);
		} finally {
			setPublishing(false);
		}
	}

	const showPrepareAction =
		currentApproval &&
		publicationEnabled &&
		Boolean(review.publicationTarget) &&
		publicationPreflight?.eligible === true &&
		!publicationRecovery?.pending &&
		!publicationRecovery?.blocked &&
		!publicationErrorCode &&
		!publicationReceipt;

	return (
		<section className={styles.editor} aria-labelledby="local-review-title">
			<div className={styles.editorHeader}>
				<div className={styles.editorIdentity}>
					<span className={styles.eyebrow}>Revisão local derivada</span>
					<h2 id="local-review-title">{review.lineage.profileId}</h2>
					<p>
						{ephemeral
							? "Base imutável · nenhuma revisão salva"
							: `draft r${review.draftRevision}`}
						{" · "}
						{dirty
							? review.status === "approved_local"
								? "Alterado após aprovação"
								: "Alterações não salvas"
							: currentApproval
								? "Aprovado localmente"
								: "Snapshot salvo"}
					</p>
				</div>
				<div className={styles.headerActions}>
					<Button
						size="sm"
						variant="tertiary"
						disabled={busy || publishing}
						onClick={attemptClose}
					>
						Voltar aos resultados
					</Button>
					{publicationReceipt ? null : dirty ? (
						<Button
							size="sm"
							variant="primary"
							disabled={editingBlocked || !canSave || invalidStrings}
							onClick={saveDraft}
						>
							{busy ? "Salvando…" : "Salvar revisão"}
						</Button>
					) : ephemeral ? (
						<Button
							size="sm"
							variant="primary"
							disabled={editingBlocked || !canSave || invalidStrings}
							onClick={saveDraft}
						>
							{busy ? "Criando…" : "Criar revisão"}
						</Button>
					) : !currentApproval ? (
						<Button
							size="sm"
							variant="primary"
							disabled={editingBlocked || !canSave || invalidStrings}
							onClick={approveReview}
						>
							{busy ? "Aprovando…" : "Aprovar revisão"}
						</Button>
					) : publicationRecovery?.pending && !publicationRecovery.blocked ? (
						<Button
							size="sm"
							variant="primary"
							disabled={publishing || publishConfirmation}
							onClick={() => void preparePublicationConfirmation()}
						>
							{publishing ? "Consultando…" : "Reconciliar handoff"}
						</Button>
					) : showPrepareAction ? (
						<Button
							size="sm"
							variant="primary"
							disabled={publishing || publishConfirmation}
							onClick={() => void preparePublicationConfirmation()}
						>
							{publishing ? "Preparando…" : "Preparar sessão"}
						</Button>
					) : null}
				</div>
			</div>

			<nav className={styles.reviewJourney} aria-label="Etapas da revisão">
				<ol>
					{journeySteps.map((step, index) => {
						const state =
							index < journeyActiveIndex
								? "complete"
								: index === journeyActiveIndex
									? "current"
									: "upcoming";
						return (
							<li
								key={step.label}
								className={`${styles.journeyStep} ${state === "complete" ? styles.journeyStepComplete : state === "current" ? styles.journeyStepCurrent : styles.journeyStepUpcoming}`}
								aria-current={state === "current" ? "step" : undefined}
							>
								<span className={styles.journeyIndex} aria-hidden="true">
									{state === "complete" ? "✓" : index + 1}
								</span>
								<span>
									<strong>{step.label}</strong>
									<small>{step.description}</small>
								</span>
							</li>
						);
					})}
				</ol>
			</nav>

			<p className={styles.audienceHint}>
				<strong>Preparar sessão é um handoff privado.</strong>{" "}
				A transcrição vai para Sessões do Edit; nada fica público no site até
				a publicação editorial final.
				{review.publicationTarget
					? ` Destino: ${review.publicationTarget.campaignSlug} · sessão ${review.publicationTarget.sourceSessionId}.`
					: ""}
			</p>

			{dominantBlocker ? (
				<section
					className={`${styles.workflowBlocker} ${dominantBlocker.tone === "error" ? styles.workflowBlockerError : dominantBlocker.tone === "warning" ? styles.workflowBlockerWarning : styles.workflowBlockerInfo}`}
					role={dominantBlocker.tone === "error" ? "alert" : "status"}
					aria-labelledby="review-blocker-title"
				>
					<div>
						<strong id="review-blocker-title">{dominantBlocker.title}</strong>
						<p>{dominantBlocker.detail}</p>
						{dominantBlocker.technical ? (
							<details>
								<summary>Detalhes técnicos</summary>
								<code>{dominantBlocker.technical}</code>
								{publicationPreflight?.payloadBytes != null ? (
									<span>
										Payload: {publicationPreflight.payloadBytes.toLocaleString("pt-BR")} /{" "}
										{publicationPreflight.maxPayloadBytes.toLocaleString("pt-BR")} bytes
									</span>
								) : null}
							</details>
						) : null}
					</div>
					<div className={styles.blockerActions}>
						{dominantBlocker.key === "LOCAL_REVIEW_DRAFT_CONFLICT" &&
						onLoadLatest ? (
							<Button
								type="button"
								variant="secondary"
								disabled={editingBlocked || publishing}
								onClick={async () => {
									rememberVisibleAnchor();
									setComparing(true);
									setComparisonError(null);
									try {
										const latest = await onLoadLatest();
										setComparison(
											prepareReviewRebase(baseline, segments, status, latest),
										);
									} catch {
										setComparisonError(
											"Não foi possível comparar uma revisão compatível. Suas alterações continuam intactas.",
										);
									} finally {
										setComparing(false);
									}
								}}
							>
								Comparar com versão mais recente
							</Button>
						) : null}
						{dominantBlocker.key === "target-unavailable" && onRepairTarget ? (
							<Button
								type="button"
								variant="secondary"
								disabled={busy || dirty || publishing}
								onClick={() => void onRepairTarget()}
							>
								Reparar vínculo original
							</Button>
						) : null}
						{dominantBlocker.key === "pending-handoff" &&
						publicationRecovery?.pending ? (
							<Button
								variant="secondary"
								disabled={publishing}
								onClick={() => void abandonPublication()}
							>
								Abandonar handoff anterior
							</Button>
						) : null}
						{["dependency_unavailable", "not_found", "stale_current"].includes(
							dominantBlocker.key,
						) &&
						currentApproval &&
						review.publicationTarget ? (
							<Button
								variant="secondary"
								disabled={publishing}
								onClick={() => void preparePublicationConfirmation()}
							>
								Atualizar e tentar novamente
							</Button>
						) : null}
					</div>
				</section>
			) : null}

			{publishConfirmation && review.publicationTarget ? (
				<section
					ref={confirmationRef}
					className={styles.publishConfirmation}
					aria-live="polite"
					tabIndex={-1}
					data-publication-confirmation="true"
					aria-labelledby="publication-confirmation-title"
					aria-describedby="publication-confirmation-detail"
					onKeyDown={(event) => {
						if (event.key === "Escape" && !publishing) {
							event.preventDefault();
							setPublishConfirmation(false);
						}
					}}
				>
					<div>
						<span className={styles.eyebrow}>Confirmação do handoff privado</span>
						<h3 id="publication-confirmation-title">
							Preparar esta sessão no Edit?
						</h3>
						<p id="publication-confirmation-detail">
							Sessão <strong>{review.publicationTarget.sourceSessionId}</strong> ·
							draft local <strong>r{review.draftRevision}</strong> ·{" "}
							<strong>{review.segments.length} segmentos</strong> · destino{" "}
							<strong>{review.publicationTarget.campaignSlug}</strong>. A
							transcrição ficará disponível apenas para usuários autorizados do
							Edit. Isso não publica capa, resumo ou transcript no site público.
						</p>
						<p>
							Revisão privada atualmente vinculada:{" "}
							{publicationCurrent?.revisionId ?? "nenhuma"}. O handoff será recusado
							se esse estado mudar.
						</p>
						<small>
							Base SHA {review.baseTranscriptSha256.slice(0, 12)}… · draft SHA{" "}
							{review.draftSha256?.slice(0, 12)}…
						</small>
					</div>
					<div className={styles.publishActions}>
						<Button
							size="sm"
							variant="tertiary"
							disabled={publishing}
							onClick={() => setPublishConfirmation(false)}
						>
							Cancelar
						</Button>
						<Button
							size="sm"
							variant="primary"
							disabled={publishing}
							onClick={() => void confirmPublication()}
						>
							{publishing ? "Preparando…" : "Confirmar preparação"}
						</Button>
					</div>
				</section>
			) : null}

			{publicationReceipt && review.publicationTarget ? (
				<div className={styles.published} role="status">
					<span>
						<strong>Sessão preparada no Edit</strong> · revisão cloud{" "}
						{publicationReceipt.revisionNumber} · receipt{" "}
						{publicationReceipt.receiptId.slice(0, 12)}…
					</span>
					<a
						className={actionStyles({ size: "sm", variant: "primary" })}
						href={`/edit/sessoes/${encodeURIComponent(review.publicationTarget.sourceSessionId)}`}
					>
						Abrir sessão no Edit
					</a>
				</div>
			) : null}

			<dl className={styles.reviewFacts} aria-label="Resumo da revisão">
				<div>
					<dt>Revisão</dt>
					<dd>
						<strong>
							{reviewed} / {segments.length}
						</strong>
						<span>
							{segments.length
								? Math.round((reviewed / segments.length) * 100)
								: 100}
							%
						</span>
					</dd>
				</div>
				<div>
					<dt>Palavras</dt>
					<dd><strong>{words}</strong></dd>
				</div>
				<div>
					<dt>Participantes</dt>
					<dd><strong>{participants}</strong></dd>
				</div>
				<div>
					<dt>Duração</dt>
					<dd><strong>{formatSeconds(review.stats.sessionDurationSeconds)}</strong></dd>
				</div>
				<div data-attention={review.review.warningCount > 0 ? "true" : undefined}>
					<dt>Avisos</dt>
					<dd><strong>{review.review.warningCount}</strong></dd>
				</div>
			</dl>

			<div className={styles.reviewToolbar}>
				<label className={styles.search}>
					<span>Buscar na timeline</span>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Texto, participante ou HH:MM:SS…"
					/>
				</label>
				<span className={styles.timelineCount}>
					{visible.length} de {segments.length} falas · timeline contínua
				</span>
			</div>

			<div className={styles.reviewUtilities}>
				<ParticipantManager
					segments={segments}
					disabled={editingBlocked || publishing || !canSave}
					onApply={(intent) => {
						const next = applyParticipantRename(segments, intent);
						if (next === segments) return;
						setSegments([...next]);
						if (status === "approved_local") setStatus("reviewed");
						setDirty(true);
						setPublicationReceipt(null);
						setPublicationRecovery(null);
						setPublishConfirmation(false);
					}}
				/>
				<details className={styles.technicalDetails}>
					<summary>Detalhes técnicos</summary>
					<dl>
						<div><dt>Run</dt><dd>{review.runId}</dd></div>
						<div><dt>Base SHA</dt><dd>{review.baseTranscriptSha256}</dd></div>
						<div><dt>Draft SHA</dt><dd>{review.draftSha256 ?? "—"}</dd></div>
						<div>
							<dt>Processamento</dt>
							<dd>{formatSeconds(review.stats.processingMetrics?.totalProcessingSeconds ?? review.stats.processingSeconds)}</dd>
						</div>
						<div>
							<dt>Hardware</dt>
							<dd>{review.lineage.executionLineage?.gpu?.model ?? review.lineage.device ?? "—"}</dd>
						</div>
						<div>
							<dt>Runtime</dt>
							<dd>
								{[
									review.lineage.executionLineage?.runtimeFamily,
									review.lineage.executionLineage?.runtimeVersion,
									review.lineage.computeType,
									review.lineage.alignment,
								]
									.filter(Boolean)
									.join(" · ") || "desconhecido"}
							</dd>
						</div>
					</dl>
					{review.lineage.executionLineage?.runtimeArtifact ? (
						<div className={styles.runtimeIntegrity}>
							<strong>
								{review.lineage.executionLineage.runtimeArtifact.runtimeId} ·{" "}
								{review.lineage.executionLineage.runtimeArtifact.version}
							</strong>
							<span>
								Worker SHA-256:{" "}
								<code>{review.lineage.executionLineage.runtimeArtifact.workerSha256}</code>
							</span>
							{review.lineage.executionLineage.runtimeArtifact.archiveSha256 ? (
								<span>
									Arquivo SHA-256:{" "}
									<code>{review.lineage.executionLineage.runtimeArtifact.archiveSha256}</code>
								</span>
							) : null}
						</div>
					) : null}
				</details>
			</div>

			{review.warnings.length ? (
				<details className={styles.warnings}>
					<summary>
						{review.review.warningCount} avisos do pipeline · mostrando{" "}
						{Math.min(new Set(review.warnings).size, 50)} tipos
						{review.warningSummary?.truncated
							? ` dos primeiros ${review.warningSummary.displayedCount} avisos`
							: ""}
					{review.warningSummary ? "" : " · total histórico não verificado"}
					</summary>
					<ul>
						{Array.from(new Set(review.warnings))
							.slice(0, 50)
							.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
					</ul>
				</details>
			) : null}

			{comparisonError ? <p role="alert">{comparisonError}</p> : null}
			{comparison ? (
				<ReviewConflicts
					plan={comparison}
					onCancel={() => setComparison(null)}
					onApply={(choices) => {
						if (segments !== comparison.working) {
							setComparisonError(
								"O draft mudou durante a comparação. Compare novamente.",
							);
							setComparison(null);
							return;
						}
						const result = resolveReviewRebase(comparison, choices);
						restoreAnchor.current = true;
						setBaseline(comparison.latest);
						setSegments(result.segments);
						setStatus(result.status);
						setDirty(true);
						setPublicationReceipt(null);
						setPublicationRecovery(null);
						setPublishConfirmation(false);
						setComparison(null);
					}}
				/>
			) : null}
			{baseline !== review ? (
				<p className={styles.inlineStatus} role="status">
					Reconciliado sobre a revisão {baseline.draftRevision}. Alterações ainda
					não salvas; será necessário salvar e aprovar novamente.
				</p>
			) : null}

			<div className={styles.timelineList}>
				{visible.map(({ segment, index }) => {
					const key = `${segment.trackNumber}:${segment.segmentId}`;
					const editing = editingKey === key;
					return (
						<article
							className={styles.timelineRow}
							data-review-segment={JSON.stringify([
								segment.trackNumber,
								segment.segmentId,
							])}
							key={key}
						>
							<time>{formatTimestamp(timelineStart(segment))}</time>
							<div className={styles.timelineSpeaker}>
								{editing ? (
									<input
										value={segment.speaker}
										maxLength={320}
										aria-label={`Participante em ${formatTimestamp(timelineStart(segment))}`}
										aria-invalid={!isReviewStringV1(segment.speaker, "speaker")}
										disabled={editingBlocked || !canSave}
										onChange={(event) =>
											patch(index, { speaker: event.target.value })
										}
									/>
								) : (
									<strong>{segment.speaker}</strong>
								)}
								<small>Track {segment.trackNumber}</small>
							</div>
							<div className={styles.timelineText}>
								{editing ? (
									<textarea
										ref={editingTextRef}
										value={segment.text}
										maxLength={200_000}
										aria-label={`Texto em ${formatTimestamp(timelineStart(segment))}`}
										aria-invalid={!isReviewStringV1(segment.text, "text")}
										disabled={editingBlocked || !canSave}
										onChange={(event) =>
											patch(index, { text: event.target.value })
										}
									/>
								) : (
									<p>{segment.text}</p>
								)}
							</div>
							<div className={styles.timelineActions}>
								<label
									className={styles.reviewed}
									title={segment.reviewed ? "Revisado" : "Não revisado"}
								>
									<input
										type="checkbox"
										checked={segment.reviewed}
										aria-label={`${segment.reviewed ? "Marcar como não revisado" : "Marcar como revisado"} · ${segment.speaker} · ${formatTimestamp(timelineStart(segment))}`}
										disabled={editingBlocked || !canSave}
										onChange={(event) =>
											patch(index, { reviewed: event.target.checked })
										}
									/>
									<span aria-hidden="true">{segment.reviewed ? "✓" : "○"}</span>
								</label>
								<Button
									size="sm"
									variant="tertiary"
									disabled={editingBlocked || !canSave}
									aria-label={`${editing ? "Concluir edição" : "Editar"} ${segment.speaker} em ${formatTimestamp(timelineStart(segment))}`}
									onClick={() => setEditingKey(editing ? null : key)}
								>
									{editing ? "Concluir" : "Editar"}
								</Button>
							</div>
						</article>
					);
				})}
				{visible.length === 0 ? (
					<p className={styles.empty}>Nenhuma fala corresponde ao filtro.</p>
				) : null}
			</div>
		</section>
	);
}

export function LocalReviewWorkspace({
	runs,
	hasMore = false,
	onLoadMore,
	review,
	busy,
	error,
	publicationEnabled,
	comparisonEnabled = false,
	onOpen,
	onLoadSnapshot,
	onDeleteRun,
	onSave,
	onClose,
	onPublish,
	onRepairTarget,
	onLoadLatest,
}: Props) {
	const [libraryQuery, setLibraryQuery] = useState("");
	const [profileFilter, setProfileFilter] = useState("all");
	const [reviewFilter, setReviewFilter] = useState("all");
	const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "fastest">("newest");
	const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null);
	const [comparisonTargetKey, setComparisonTargetKey] = useState("");
	const [comparisonBusy, setComparisonBusy] = useState(false);
	const [comparisonError, setComparisonError] = useState<string | null>(null);
	const [comparisonPair, setComparisonPair] = useState<Readonly<{
		leftRun: LocalRunSummary;
		rightRun: LocalRunSummary;
		leftReview: LocalReview;
		rightReview: LocalReview;
	}> | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<LocalRunSummary | null>(null);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const deleteDialog = useRef<HTMLDialogElement>(null);
	const filteredRuns = useMemo(() => {
		const query = libraryQuery.trim().toLocaleLowerCase("pt-BR");
		const values = runs.filter((run) => {
			if (profileFilter !== "all" && run.profileId !== profileFilter) return false;
			const reviewStatus = run.review?.status ?? "unknown";
			if (reviewFilter !== "all" && reviewStatus !== reviewFilter) return false;
			if (!query) return true;
			return [
				run.profileId,
				run.engine,
				run.model,
				run.sourceId,
				run.runId,
				run.executionLineage?.gpu?.model,
				run.executionLineage?.runtimeVersion,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase("pt-BR")
				.includes(query);
		});
		return [...values].sort((left, right) => {
			if (sortOrder === "fastest") {
				const leftTime =
					left.stats.processingMetrics?.totalProcessingSeconds ??
					left.stats.processingSeconds ??
					Number.POSITIVE_INFINITY;
				const rightTime =
					right.stats.processingMetrics?.totalProcessingSeconds ??
					right.stats.processingSeconds ??
					Number.POSITIVE_INFINITY;
				return leftTime - rightTime;
			}
			const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
			const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
			return sortOrder === "oldest" ? leftTime - rightTime : rightTime - leftTime;
		});
	}, [libraryQuery, profileFilter, reviewFilter, runs, sortOrder]);
	const profiles = useMemo(
		() => [...new Set(runs.map((run) => run.profileId))].sort(),
		[runs],
	);
	const selectedRun =
		filteredRuns.find(
			(run) => serializeLocalRunKey(localRunKey(run)) === selectedRunKey,
		) ??
		filteredRuns[0] ??
		null;

	const comparisonCandidates = selectedRun && comparisonEnabled
		? runs.filter(
			(run) =>
				run.sourceId === selectedRun.sourceId &&
				run.runId !== selectedRun.runId,
		)
		: [];
	const comparisonTarget =
		comparisonCandidates.find(
			(run) => serializeLocalRunKey(localRunKey(run)) === comparisonTargetKey,
		) ??
		comparisonCandidates[0] ??
		null;
	const effectiveComparisonTargetKey = comparisonTarget
		? serializeLocalRunKey(localRunKey(comparisonTarget))
		: "";

	useEffect(() => {
		if (deleteTarget) deleteDialog.current?.showModal();
		else deleteDialog.current?.close();
	}, [deleteTarget]);

	useEffect(() => {
		if (!selectedRun) {
			if (selectedRunKey !== null) setSelectedRunKey(null);
			return;
		}
		const key = serializeLocalRunKey(localRunKey(selectedRun));
		if (selectedRunKey !== key) setSelectedRunKey(key);
	}, [selectedRun, selectedRunKey]);

	async function startComparison() {
		if (!selectedRun || !comparisonTarget || comparisonBusy) return;
		setComparisonBusy(true);
		setComparisonError(null);
		try {
			const [leftReview, rightReview] = await Promise.all([
				onLoadSnapshot(selectedRun.sourceId, selectedRun.runId),
				onLoadSnapshot(comparisonTarget.sourceId, comparisonTarget.runId),
			]);
			if (
				leftReview.sourceId !== selectedRun.sourceId ||
				rightReview.sourceId !== selectedRun.sourceId ||
				leftReview.runId !== selectedRun.runId ||
				rightReview.runId !== comparisonTarget.runId
			)
				throw new Error("RUN_COMPARISON_SNAPSHOT_MISMATCH");
			setComparisonPair({
				leftRun: selectedRun,
				rightRun: comparisonTarget,
				leftReview,
				rightReview,
			});
		} catch {
			setComparisonError("Não foi possível carregar os dois snapshots locais para comparação.");
		} finally {
			setComparisonBusy(false);
		}
	}

	if (review) {
		return (
			<ReviewEditor
				key={`${review.sourceId}:${review.runId}:${review.baseTranscriptSha256}`}
				review={review}
				busy={busy}
				error={error}
				onSave={onSave}
				onClose={onClose}
				publicationEnabled={publicationEnabled}
				onLoadLatest={onLoadLatest}
				onRepairTarget={onRepairTarget}
				onPublish={onPublish}
			/>
		);
	}

	if (comparisonPair) {
		return (
			<RunComparisonView
				leftRun={comparisonPair.leftRun}
				rightRun={comparisonPair.rightRun}
				leftReview={comparisonPair.leftReview}
				rightReview={comparisonPair.rightReview}
				onClose={() => setComparisonPair(null)}
				onUseRun={(run) => {
					setComparisonPair(null);
					return onOpen(run.sourceId, run.runId);
				}}
			/>
		);
	}

	async function confirmDelete() {
		const target = deleteTarget;
		if (!target || !onDeleteRun) return;
		setDeleteError(null);
		const deleted = await onDeleteRun(target.sourceId, target.runId, target.transcriptSha256);
		if (deleted) setDeleteTarget(null);
		else setDeleteError("O Companion não confirmou a exclusão. O resultado foi preservado.");
	}

	function requestDelete(run: LocalRunSummary) {
		setDeleteError(null);
		if (browserHasPendingPublicationForRun(run.sourceId, run.runId)) {
			setDeleteError("Existe uma publicação não reconciliada para este resultado. Reabra a revisão e reconcilie ou abandone a recuperação antes de excluir.");
			return;
		}
		setDeleteTarget(run);
	}

	return (
		<section
			className={`${styles.library} ${runs.length ? "" : styles.libraryCompact}`}
			aria-labelledby="local-results-title"
		>
			<div className={styles.libraryHeader}>
				<div>
					<span className={styles.eyebrow}>Biblioteca local</span>
					<h2 id="local-results-title">Resultados locais</h2>
				</div>
				<span>
					{filteredRuns.length}
					{filteredRuns.length !== runs.length ? ` de ${runs.length}` : ""}{" "}
					{runs.length === 1 ? "resultado" : "resultados"}
				</span>
			</div>
			{runs.length ? (
				<>
					<p className={styles.libraryIntro}>
						Navegue pelos metadados primeiro. O transcript só é carregado quando você abre uma revisão.
					</p>
					<div className={styles.libraryToolbar}>
						<label className={styles.librarySearch}>
							<span>Buscar</span>
							<input
								value={libraryQuery}
								onChange={(event) => setLibraryQuery(event.target.value)}
								placeholder="Perfil, modelo, GPU, runtime ou ID…"
							/>
						</label>
						<label>
							<span>Perfil</span>
							<select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}>
								<option value="all">Todos</option>
								{profiles.map((profile) => (
									<option key={profile} value={profile}>{profile}</option>
								))}
							</select>
						</label>
						<label>
							<span>Revisão</span>
							<select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)}>
								<option value="all">Todas</option>
								<option value="unknown">Sem revisão</option>
								<option value="draft">Draft</option>
								<option value="reviewed">Revisado</option>
								<option value="approved_local">Aprovado localmente</option>
							</select>
						</label>
						<label>
							<span>Ordenar</span>
							<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest" | "fastest")}>
								<option value="newest">Mais recentes</option>
								<option value="oldest">Mais antigos</option>
								<option value="fastest">Processamento mais rápido</option>
							</select>
						</label>
					</div>
					<div className={styles.libraryWorkspace}>
						<nav className={styles.runList} aria-label="Runs locais">
							{filteredRuns.map((run) => {
								const key = serializeLocalRunKey(localRunKey(run));
								const active = selectedRun
									? serializeLocalRunKey(localRunKey(selectedRun)) === key
									: false;
								return (
									<button
										key={key}
										type="button"
										className={styles.runListItem}
										data-active={active ? "true" : "false"}
										aria-current={active ? "true" : undefined}
										onClick={() => setSelectedRunKey(key)}
									>
										<span className={styles.runListTitle}>
											<strong>{run.profileId}</strong>
											<small>{formatDate(run.completedAt)}</small>
										</span>
										<span>{[run.engine, run.model].filter(Boolean).join(" · ") || "modelo desconhecido"}</span>
										<span>
											{formatSeconds(run.stats.processingMetrics?.totalProcessingSeconds ?? run.stats.processingSeconds)}
											{" · "}
											{run.review?.status === "approved_local"
												? "Aprovado"
												: run.review?.status === "reviewed"
													? "Revisado"
													: run.review?.status === "draft"
														? "Draft"
														: "Sem revisão"}
										</span>
									</button>
								);
							})}
							{filteredRuns.length === 0 ? (
								<p className={styles.emptyCompact}>Nenhum run corresponde aos filtros.</p>
							) : null}
							{hasMore && onLoadMore ? (
								<div className={styles.libraryMore}>
									<Button
										size="sm"
										variant="tertiary"
										disabled={busy}
										onClick={() => void onLoadMore()}
									>
										Carregar mais resultados
									</Button>
								</div>
							) : null}
						</nav>
						<div className={styles.runDetail}>
							{selectedRun ? (
								<>
									<RunCard
										run={selectedRun}
										busy={busy}
										onOpen={() => void onOpen(selectedRun.sourceId, selectedRun.runId)}
										onDelete={onDeleteRun ? () => requestDelete(selectedRun) : undefined}
									/>
									<details className={styles.runCompareDisclosure}>
										<summary>Comparar runs</summary>
										<div className={styles.runCompareActions}>
											<div>
												<span>Somente resultados da mesma fonte podem ser comparados.</span>
											</div>
											{!comparisonEnabled ? (
												<small>Comparação A/B requer um Companion compatível com leitura imutável do run.</small>
											) : comparisonCandidates.length ? (
												<>
													<select aria-label="Segundo run para comparação" value={effectiveComparisonTargetKey} onChange={(event) => setComparisonTargetKey(event.target.value)}>
														{comparisonCandidates.map((run) => {
															const key = serializeLocalRunKey(localRunKey(run));
															return <option key={key} value={key}>{run.profileId} · {formatDate(run.completedAt)}</option>;
														})}
													</select>
													<Button size="sm" variant="tertiary" disabled={comparisonBusy} onClick={() => void startComparison()}>
														{comparisonBusy ? "Carregando…" : "Comparar"}
													</Button>
												</>
											) : <small>Nenhum segundo run compatível nesta fonte.</small>}
											{comparisonError ? <p role="status">{comparisonError}</p> : null}
										</div>
									</details>
								</>
							) : (
								<p className={styles.emptyCompact}>Selecione um resultado para ver os detalhes.</p>
							)}
						</div>
					</div>
				</>
			) : (
				<p className={styles.emptyCompact}>
					Nenhum resultado local concluído ainda.
					<span> Runs concluídos aparecem aqui sem publicação automática.</span>
				</p>
			)}
			{deleteError ? <p className={styles.deleteError} role="alert">{deleteError}</p> : null}
			<dialog
				ref={deleteDialog}
				className={styles.deleteDialog}
				onCancel={(event) => {
					event.preventDefault();
					setDeleteTarget(null);
				}}
			>
				{deleteTarget ? (
					<>
						<h3>Excluir resultado local?</h3>
						<p><strong>{deleteTarget.profileId}</strong> · {formatDate(deleteTarget.completedAt)}</p>
						<p>Serão removidos deste computador o transcript, detalhes técnicos e a revisão local vinculada a este run.</p>
						<p>A source Craig e os outros resultados permanecem. Uma publicação já feita no TDA não será desfeita.</p>
						<div className={styles.deleteDialogActions}>
							<Button variant="tertiary" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
							<Button variant="primary" disabled={busy} onClick={() => void confirmDelete()}>
								{busy ? "Excluindo…" : "Excluir resultado local"}
							</Button>
						</div>
					</>
				) : null}
			</dialog>
		</section>
	);
}
