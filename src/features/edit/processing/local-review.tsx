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
	return (
		<article className={styles.runCard}>
			<div className={styles.runHeader}>
				<div>
					<span className={styles.eyebrow}>Resultado local</span>
					<h3>{run.profileId}</h3>
				</div>
				<StatusPill tone="success">Concluído</StatusPill>
			</div>
			<p className={styles.runModel}>
				{model}
				{run.modelRevision ? ` · rev ${run.modelRevision}` : ""}
				{" · "}
				{formatRunExecution(run)}
			</p>
			<dl className={styles.runFacts}>
				<div><dt>Concluído</dt><dd>{formatDate(run.completedAt)}</dd></div>
				<div><dt>Duração da sessão</dt><dd>{formatSeconds(run.stats.sessionDurationSeconds)}</dd></div>
				<div><dt>Trabalho de áudio</dt><dd>{formatSeconds(run.stats.audioWorkSeconds)}</dd></div>
				<div><dt>Processamento</dt><dd>{formatSeconds(processingSeconds)}</dd></div>
				<div><dt>Velocidade</dt><dd>{formatRealtime(rtf)}</dd></div>
				<div><dt>RTF</dt><dd>{rtf === null ? "—" : rtf.toFixed(3)}</dd></div>
				<div><dt>Palavras</dt><dd>{run.stats.wordCount ?? "—"}</dd></div>
				<div><dt>Segmentos</dt><dd>{run.stats.segmentCount ?? "—"}</dd></div>
				<div><dt>Turnos</dt><dd>{run.stats.turnCount ?? "—"}</dd></div>
				<div><dt>Tracks</dt><dd>{run.stats.trackCount ?? "—"}</dd></div>
				<div><dt>Deduplicados</dt><dd>{run.stats.deduplicatedSegmentCount ?? "—"}</dd></div>
				<div><dt>Warnings</dt><dd>{run.stats.warningCount ?? "—"}</dd></div>
				<div><dt>GPU</dt><dd>{run.executionLineage?.gpu?.model ?? "—"}</dd></div>
				<div><dt>VRAM</dt><dd>{formatVram(run.executionLineage?.gpu?.vramTotalBytes)}</dd></div>
				<div><dt>Runtime</dt><dd>{formatRuntime(run)}</dd></div>
				<div><dt>Compute capability</dt><dd>{run.executionLineage?.gpu?.computeCapability ?? "—"}</dd></div>
			</dl>
			{measured ? (
				<details>
					<summary>Tempo comparável e reaproveitamento</summary>
					<p>Inclui validação, modelos, transcrição, alinhamento e consolidação dentro da engine. Não inclui preparação externa nem o tempo completo do job.</p>
					<p>{measured.freshAsrTracks} faixas com ASR novo · {measured.textCheckpointReusedTracks} com texto reaproveitado · {measured.completedCheckpointReusedTracks} concluídas reaproveitadas.</p>
					<p>{measured.freshCalibrationEligible ? "Amostra integral elegível para calibração compatível." : "Resultado com reaproveitamento ou sem áudio: não usar como throughput de ASR integral."}</p>
					<dl>{Object.entries(measured.stageSeconds).map(([stage, seconds]) => <div key={stage}><dt>{processingStageLabels[stage]}</dt><dd>{formatSeconds(seconds)}</dd></div>)}</dl>
					<small>Registro original: {formatSeconds(run.stats.processingSeconds)} · medição {measured.version}</small>
				</details>
			) : <p>Tempo histórico sem medição comparável entre engines.</p>}
			<div className={styles.runIdentity}>
				<span title={run.sourceId}>Fonte {run.sourceId.slice(0, 22)}…</span>
				<span title={run.transcriptSha256}>SHA {run.transcriptSha256.slice(0, 12)}…</span>
				{run.publicationTarget ? (
					<span>
						Destino {run.publicationTarget.campaignSlug} · sessão{" "}
						{run.publicationTarget.sourceSessionId}
					</span>
				) : (
					<span>Sem destino cloud vinculado</span>
				)}
			</div>
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
    const [baseline, setBaseline] = useState(review);
    const [comparison, setComparison] = useState<ReviewRebase | null>(null);
    const [comparing, setComparing] = useState(false);
    const [comparisonError, setComparisonError] = useState<string | null>(null);
	const [segments, setSegments] = useState<LocalReviewSegment[]>(() =>
		review.segments.map((segment) => ({ ...segment })),
	);
    useLayoutEffect(() => {
        if (!restoreAnchor.current || !scrollAnchor.current || segments.length === 0) return;
        restoreAnchor.current = false;
        const anchor = scrollAnchor.current;
        const row = Array.from(document.querySelectorAll<HTMLElement>("[data-review-segment]")).find((node) => node.dataset.reviewSegment === anchor.key);
        if (row) window.scrollBy(0, row.getBoundingClientRect().top - anchor.top);
    }, [segments]);
	const [status, setStatus] = useState<LocalReviewStatus>(review.status);
	const [dirty, setDirty] = useState(false);
	const [query, setQuery] = useState("");
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const editingTextRef = useRef<HTMLTextAreaElement | null>(null);
	const [publicationRecovery, setPublicationRecovery] = useState<PublicationConfirmation | null>(null);
    const publicationCurrent = publicationRecovery?.current;
	const [publishConfirmation, setPublishConfirmation] = useState(false);
	const [publishing, setPublishing] = useState(false);
    const editingBlocked = busy || comparing || comparison !== null || publishing;
	const [publicationError, setPublicationError] = useState<string | null>(null);
	const [publicationReceipt, setPublicationReceipt] =
		useState<PublicationReceiptView | null>(null);
	const canSave = review.snapshotContract === "tda_local_review_cas_v1";
	const ephemeral = review.persistence === "ephemeral_base";

	useEffect(() => {
		if (editingKey) editingTextRef.current?.focus();
	}, [editingKey]);

	useEffect(() => {
		if (lastServerReview.current === review) return;
		lastServerReview.current = review;
		setBaseline(review);
		setSegments(review.segments.map((segment) => ({ ...segment })));
		setStatus(review.status);
		setDirty(false);
		restoreAnchor.current = scrollAnchor.current !== null;
	}, [review]);
	const invalidStrings = segments.some((segment) => !isReviewStringV1(segment.text, "text") || !isReviewStringV1(segment.speaker, "speaker"));
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
        if (!publicationEnabled || !review.publicationTarget || review.status !== "approved_local" || dirty) return;
        let cancelled = false;
        const invalidate = () => { setPublicationRecovery(null); setPublicationReceipt(null); setPublishConfirmation(false); };
        const recover = async () => {
            invalidate(); setPublishing(true);
            try {
                const result = await browserPublicationRecovery().inspect(review);
                if (!cancelled) { setPublicationRecovery(result); setPublicationReceipt(result.receipt); setPublicationError(null); }
            } catch (cause) {
                if (!cancelled) setPublicationError(publicationErrorMessage(cause instanceof PublicationClientError || cause instanceof PublicationRecoveryError ? cause.code : "dependency_unavailable"));
            } finally { if (!cancelled) setPublishing(false); }
        };
        const focus = () => { void recover(); };
        const visibility = () => { if (document.visibilityState === "hidden") invalidate(); };
        void recover();
        window.addEventListener("focus", focus);
        window.addEventListener("storage", focus);
        document.addEventListener("visibilitychange", visibility);
        return () => { cancelled = true; window.removeEventListener("focus", focus); window.removeEventListener("storage", focus); document.removeEventListener("visibilitychange", visibility); };
    }, [publicationEnabled, review, dirty]);

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
			.sort((left, right) =>
				timelineStart(left.segment) - timelineStart(right.segment) ||
				timelineEnd(left.segment) - timelineEnd(right.segment) ||
				left.segment.trackNumber - right.segment.trackNumber ||
				left.segment.segmentId.localeCompare(right.segment.segmentId),
			);
	}, [query, segments]);
	const reviewed = segments.filter((segment) => segment.reviewed).length;
	const words = segments.reduce(
		(total, segment) =>
			total + countWordsV1(segment.text),
		0,
	);
	const participants = new Set(segments.map((segment) => segment.speaker)).size;

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

    function recoveryError(cause: unknown) {
        return publicationErrorMessage(cause instanceof PublicationClientError || cause instanceof PublicationRecoveryError ? cause.code : "dependency_unavailable");
    }
    async function preparePublicationConfirmation() {
        setPublishing(true); setPublicationError(null); setPublicationRecovery(null); setPublishConfirmation(false);
        try {
            const result = await browserPublicationRecovery().inspect(review);
            setPublicationRecovery(result); setPublicationReceipt(result.receipt);
            if (!result.receipt && !result.blocked) setPublishConfirmation(true);
        } catch (cause) { setPublicationError(recoveryError(cause)); }
        finally { setPublishing(false); }
    }
    async function confirmPublication() {
        if (publishing || !publicationRecovery || publicationRecovery.blocked || dirty || review.status !== "approved_local" || publicationPreflight?.eligible !== true) return;
        setPublishing(true); setPublicationError(null);
        try {
            const receipt = await browserPublicationRecovery().execute(review, publicationRecovery, onPublish);
            setPublicationReceipt(receipt); setPublicationRecovery(null);
        } catch (cause) {
            setPublicationRecovery(null); setPublicationError(recoveryError(cause));
        } finally { setPublishConfirmation(false); setPublishing(false); }
    }
    async function abandonPublication() {
        if (!publicationRecovery?.pending || !window.confirm("A publicação anterior pode ter sido concluída. Abandonar a recuperação permite criar outra revisão. Continuar?")) return;
        setPublishing(true); setPublishConfirmation(false);
        try { await browserPublicationRecovery().abandon(review, publicationRecovery); setPublicationRecovery(null); setPublicationError(null); }
        catch (cause) { setPublicationRecovery(null); setPublicationError(recoveryError(cause)); }
        finally { setPublishing(false); }
    }

	return (
		<section className={styles.editor} aria-labelledby="local-review-title">
			<div className={styles.editorHeader}>
				<div>
					<span className={styles.eyebrow}>Revisão local derivada</span>
					<h2 id="local-review-title">{review.lineage.profileId}</h2>
					<p>
						Run bruto imutável · {ephemeral ? "Sem revisão salva" : `draft r${review.draftRevision}`} · SHA{" "}
						{review.baseTranscriptSha256.slice(0, 12)}…
					</p>
				</div>
				<div className={styles.headerActions}>
					<Button size="sm" variant="tertiary" disabled={busy || publishing} onClick={attemptClose}>
						Voltar aos resultados
					</Button>
					<Button
						size="sm"
						variant="primary"
						disabled={editingBlocked || !dirty || !canSave || invalidStrings}
						onClick={() => {
							rememberVisibleAnchor();
							void onSave(baseline, status, segments);
						}}
					>
						{busy ? "Salvando…" : "Salvar revisão"}
					</Button>
					{publicationEnabled && review.publicationTarget ? (
						<Button
							size="sm"
							variant="primary"
							disabled={
								editingBlocked || error === "LOCAL_REVIEW_DRAFT_CONFLICT" ||
								publishing ||
								dirty ||
								review.status !== "approved_local" ||
								Boolean(publicationReceipt)
							}
							onClick={() => void preparePublicationConfirmation()}
						>
							{publicationReceipt
								? `Preparado · r${publicationReceipt.revisionNumber}`
								: publishing
									? "Preparando…"
									: "Preparar sessão"}
						</Button>
					) : null}
				</div>
			</div>

			{!canSave ? <p role="status">Atualize o Companion para salvar revisões com verificação de conteúdo. A leitura continua disponível.</p> : null}
			<div className={styles.reviewNotice}>
				<strong>Nada ficará público automaticamente.</strong>
				<span>
					{review.publicationTarget
						? `A transcrição será enviada para a área privada de Sessões do Edit. Nada ficará público no site até a publicação editorial final. Destino: ${review.publicationTarget.campaignSlug} · sessão ${review.publicationTarget.sourceSessionId}. ${publicationEnabled ? "Somente a confirmação explícita abaixo prepara este snapshot salvo." : "O handoff cloud continua desativado neste ambiente."}`
						: "O destino privado do Edit está indisponível. A revisão continua local e só pode ser preparada com um vínculo verificado."}
				</span>
			</div>

			{publicationPreflight && !publicationPreflight.eligible ? (
				<p className={styles.error} role="status">
					{publicationPreflight.reason === "too_large"
						? `Aprovado localmente, mas o handoff privado está indisponível: payload canônico ${publicationPreflight.payloadBytes?.toLocaleString("pt-BR") ?? "acima do limite"} bytes / ${publicationPreflight.maxPayloadBytes.toLocaleString("pt-BR")} bytes.`
						: "Aprovado localmente, mas este snapshot não passa no contrato atual de handoff. Salve/reabra a revisão antes de preparar a sessão."}
				</p>
			) : publicationPreflight?.eligible ? (
				<p className={styles.saved} role="status">
					Handoff privado compatível · payload canônico {publicationPreflight.payloadBytes?.toLocaleString("pt-BR")} / {publicationPreflight.maxPayloadBytes.toLocaleString("pt-BR")} bytes.
				</p>
			) : null}

            {!review.publicationTarget && onRepairTarget ? (
                <div className={styles.notice}>
                    <p>{review.publicationTargetState === "invalid" ? "O vínculo do handoff privado está danificado." : "O destino privado do Edit não está disponível."} O reparo usa somente a origem verificada. Sem essa prova, o Companion mantém o handoff bloqueado.</p>
                    <Button type="button" variant="secondary" disabled={busy || dirty || publishing} onClick={() => void onRepairTarget()}>Reparar vínculo original</Button>
                    {dirty ? <p>Salve suas alterações antes de reparar o vínculo.</p> : null}
                </div>
            ) : null}
			{publishConfirmation && review.publicationTarget ? (
				<section
					className={styles.publishConfirmation}
					role="alertdialog"
					aria-labelledby="publication-confirmation-title"
					aria-describedby="publication-confirmation-detail"
				>
					<div>
						<span className={styles.eyebrow}>Handoff privado</span>
						<h3 id="publication-confirmation-title">Preparar esta sessão no Edit?</h3>
						<p id="publication-confirmation-detail">
							Sessão <strong>{review.publicationTarget.sourceSessionId}</strong> · draft local{" "}
							<strong>r{review.draftRevision}</strong> ·{" "}
							<strong>{review.segments.length} segmentos</strong> · destino{" "}
							<strong>{review.publicationTarget.campaignSlug}</strong>.
							A transcrição ficará disponível apenas para usuários autorizados do Edit.
							Isso não publica capa, resumo ou transcript no site público. O run bruto continuará imutável.
						</p>
						<p>Revisão privada atualmente vinculada: {publicationCurrent?.revisionId ?? "nenhuma"}. O handoff será recusado se esse estado mudar.</p>
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
							{publishing ? "Preparando…" : "Confirmar publicação"}
						</Button>
					</div>
				</section>
			) : null}

            {publicationRecovery?.pending ? <div className={styles.notice} role="status">
                <p>{publicationRecovery.blocked === "mismatch" ? "Existe um handoff anterior de outra revisão ainda não reconciliado nesta campanha. Reabra a revisão original para consultar o recibo." : publicationRecovery.blocked === "expired" ? "Este handoff não resolvido ultrapassou 30 dias. O recibo ainda pode ser consultado; novos envios estão bloqueados." : "Handoff anterior ainda não confirmado. A consulta e a repetição preservam a mesma operação, inclusive após recarregar."}</p>
                <Button variant="secondary" disabled={publishing} onClick={() => void abandonPublication()}>Abandonar handoff anterior</Button>
            </div> : null}
			{publicationError ? (
				<p className={styles.error} role="alert">{publicationError}</p>
			) : null}
			{publicationReceipt && review.publicationTarget ? (
				<div className={styles.published} role="status">
					<span>
						Sessão preparada no Edit · revisão cloud {publicationReceipt.revisionNumber} · receipt{" "}
						{publicationReceipt.receiptId.slice(0, 12)}…
					</span>
					<a
						className={actionStyles({ size: "sm", variant: "secondary" })}
						href={`/edit/sessoes/${encodeURIComponent(review.publicationTarget.sourceSessionId)}`}
					>
						Abrir sessão no Edit
					</a>
				</div>
			) : null}

			<div className={styles.summaryGrid}>
				<div><span>Revisão</span><strong>{reviewed} / {segments.length}</strong><small>{segments.length ? Math.round((reviewed / segments.length) * 100) : 100}%</small></div>
				<div><span>Palavras</span><strong>{words}</strong><small>{review.review.editedSegments} segmentos alterados no último save</small></div>
				<div><span>Participantes</span><strong>{participants}</strong><small>{review.stats.trackCount ?? "—"} tracks</small></div>
				<div><span>Duração</span><strong>{formatSeconds(review.stats.sessionDurationSeconds)}</strong><small>Processamento {formatSeconds(review.stats.processingMetrics?.totalProcessingSeconds ?? review.stats.processingSeconds)}</small></div>
				<div><span>Avisos</span><strong>{review.review.warningCount}</strong><small>{review.warningSummary ? "atalhos de atenção, não veredictos" : "total histórico não verificado"}</small></div>
				<div>
					<span>Hardware</span>
					<strong>{review.lineage.executionLineage?.gpu?.model ?? review.lineage.device ?? "—"}</strong>
					{review.lineage.executionLineage?.gpu && !review.lineage.executionLineage.executionDevice ? <small>Identidade física histórica não verificada</small> : null}
					<small>
						{[
							review.lineage.executionLineage?.runtimeFamily,
							review.lineage.executionLineage?.runtimeVersion,
							review.lineage.computeType,
							review.lineage.alignment,
						]
							.filter(Boolean)
							.join(" · ") || "desconhecido"}
					</small>
				</div>
			</div>

			{review.lineage.executionLineage?.runtimeArtifact ? (
				<details className={styles.warnings}>
					<summary>Integridade do runtime usado</summary>
					<p>
						{review.lineage.executionLineage.runtimeArtifact.runtimeId} ·{" "}
						{review.lineage.executionLineage.runtimeArtifact.version}
					</p>
					<p>
						Worker SHA-256:{" "}
						<code className={styles.artifactHash}>
							{review.lineage.executionLineage.runtimeArtifact.workerSha256}
						</code>
					</p>
					{review.lineage.executionLineage.runtimeArtifact.archiveSha256 ? (
						<p>
							Arquivo SHA-256:{" "}
							<code className={styles.artifactHash}>
								{review.lineage.executionLineage.runtimeArtifact.archiveSha256}
							</code>
						</p>
					) : null}
				</details>
			) : null}

			{review.warnings.length ? (
				<details className={styles.warnings}>
					<summary>{review.review.warningCount} avisos do pipeline · mostrando {Math.min(new Set(review.warnings).size, 50)} tipos{review.warningSummary?.truncated ? ` dos primeiros ${review.warningSummary.displayedCount} avisos` : ""}</summary>
					<ul>
						{Array.from(new Set(review.warnings)).slice(0, 50).map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</details>
			) : null}

            <ParticipantManager segments={segments} disabled={editingBlocked || publishing || !canSave} onApply={(intent) => {
                const next = applyParticipantRename(segments, intent);
                if (next === segments) return;
                setSegments([...next]);
                if (status === "approved_local") setStatus("reviewed");
                setDirty(true);
                setPublishConfirmation(false);
            }} />
            <div className={styles.reviewToolbar}>
				<label>
					<span>Estado do draft</span>
					<select
						value={status}
						disabled={editingBlocked || !canSave}
						onChange={(event) => {
							setStatus(event.target.value as LocalReviewStatus);
							setDirty(true);
						}}
					>
						<option value="draft">Draft</option>
						<option value="reviewed">Revisado</option>
						<option value="approved_local">Aprovado localmente</option>
					</select>
				</label>
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

            {error === "LOCAL_REVIEW_DRAFT_CONFLICT" && onLoadLatest ? <Button type="button" disabled={editingBlocked || publishing} onClick={async () => {
                rememberVisibleAnchor();
                setComparing(true); setComparisonError(null);
                try {
                    const latest = await onLoadLatest();
                    setComparison(prepareReviewRebase(baseline, segments, status, latest));
                } catch {
                    setComparisonError("Não foi possível comparar uma revisão compatível. Suas alterações continuam intactas.");
                } finally { setComparing(false); }
            }}>Comparar com versão mais recente</Button> : null}
            {comparisonError ? <p role="alert">{comparisonError}</p> : null}
            {comparison ? <ReviewConflicts plan={comparison} onCancel={() => setComparison(null)} onApply={(choices) => {
                if (segments !== comparison.working) { setComparisonError("O draft mudou durante a comparação. Compare novamente."); setComparison(null); return; }
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
            }} /> : null}
            {baseline !== review ? <p role="status">Reconciliado sobre a revisão {baseline.draftRevision}. Alterações ainda não salvas; aprovação nova necessária após salvar.</p> : null}
			{reviewError(error) ? (
				<p className={styles.error} role="alert">{reviewError(error)}</p>
			) : null}
			{invalidStrings ? <p className={styles.error} role="alert">Corrija os campos destacados: texto com até 100.000 caracteres e participante com até 160, sem controles incompatíveis.</p> : null}
			{dirty ? (
				<p className={styles.unsaved} role="status">Alterações não salvas neste draft.</p>
			) : (
				<p className={styles.saved} role="status">{ephemeral ? "Visualização da base. Nenhuma revisão foi salva." : "Draft salvo localmente."}</p>
			)}

			<div className={styles.timelineList}>
				{visible.map(({ segment, index }) => {
					const key = `${segment.trackNumber}:${segment.segmentId}`;
					const editing = editingKey === key;
					return (
						<article
							className={styles.timelineRow}
							data-review-segment={JSON.stringify([segment.trackNumber, segment.segmentId])}
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
										onChange={(event) => patch(index, { speaker: event.target.value })}
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
										onChange={(event) => patch(index, { text: event.target.value })}
									/>
								) : (
									<p>{segment.text}</p>
								)}
							</div>
							<div className={styles.timelineActions}>
								<label className={styles.reviewed} title={segment.reviewed ? "Revisado" : "Não revisado"}>
									<input
										type="checkbox"
										checked={segment.reviewed}
										aria-label={`${segment.reviewed ? "Marcar como não revisado" : "Marcar como revisado"} · ${segment.speaker} · ${formatTimestamp(timelineStart(segment))}`}
										disabled={editingBlocked || !canSave}
										onChange={(event) => patch(index, { reviewed: event.target.checked })}
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
									<div className={styles.runCompareActions}>
										<div>
											<strong>Comparar runs</strong>
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
