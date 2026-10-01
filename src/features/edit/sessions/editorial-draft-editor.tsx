"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import { formatSessionDate } from "@/features/sessions/model";
import styles from "@/features/edit/workbench.module.css";
import draftStyles from "./editorial-draft.module.css";
import { saveSessionEditorialDraftAction } from "./editorial-draft-actions";
import { publishSessionEditorialDraftAction } from "./session-publication-actions";
import type { SessionPublicationState } from "./session-publication-model";
import {
	SessionCoverEditor,
	type SessionCoverUploadState,
} from "./session-cover-editor";
import {
	SESSION_DRAFT_LIMITS,
	isCanonicalSessionDate,
	type SessionEditorialDraft,
	sessionDraftReadiness,
	sessionDraftScalarLength,
	validateSessionEditorialDraftInput,
} from "./editorial-draft-model";

export type SessionEditorialDraftEditorTransport = Readonly<{
	saveDraft: typeof saveSessionEditorialDraftAction;
	publishDraft: typeof publishSessionEditorialDraftAction;
	CoverEditor: typeof SessionCoverEditor;
}>;

type Props = Readonly<{
	campaignSlug: string;
	sessionId: string;
	initial: SessionEditorialDraft;
	initialPublication: SessionPublicationState;
	editable: boolean;
	publishable: boolean;
	publicationAvailable: boolean;
	surface?: "session" | "summary";
	active?: boolean;
	onPreview?: () => void;
	transport?: SessionEditorialDraftEditorTransport;
}>;

type Fields = Readonly<{
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
	sessionDate: string;
}>;

type PublishIntent = Readonly<{
	operationId: string;
	draftId: string;
	draftRevision: number;
	baseTranscriptRevisionId: string;
	expectedCurrentPublicationId: string | null;
	fields: Fields;
}>;

function fieldsFromDraft(draft: SessionEditorialDraft): Fields {
	return {
		coverAssetId: draft.coverAssetId,
		arc: draft.arc,
		title: draft.title,
		shortDescription: draft.shortDescription,
		fullSummary: draft.fullSummary,
		sessionDate: draft.sessionDate ?? "",
	};
}

function sameFields(left: Fields, right: Fields) {
	return (
		left.coverAssetId === right.coverAssetId &&
		left.arc === right.arc &&
		left.title === right.title &&
		left.shortDescription === right.shortDescription &&
		left.fullSummary === right.fullSummary &&
		left.sessionDate === right.sessionDate
	);
}

function fieldCount(value: string): number {
	return sessionDraftScalarLength(value) ?? Number.POSITIVE_INFINITY;
}

export function SessionEditorialDraftEditor({
	campaignSlug,
	sessionId,
	initial,
	initialPublication,
	editable,
	publishable,
	publicationAvailable,
	surface = "session",
	active = true,
	onPreview,
	transport,
}: Props) {
	const router = useRouter();
	const saveDraft = transport?.saveDraft ?? saveSessionEditorialDraftAction;
	const publishDraft = transport?.publishDraft ?? publishSessionEditorialDraftAction;
	const CoverEditor = transport?.CoverEditor ?? SessionCoverEditor;
	const [fields, setFields] = useState<Fields>(() => fieldsFromDraft(initial));
	const [baseline, setBaseline] = useState<Fields>(() => fieldsFromDraft(initial));
	const [revision, setRevision] = useState(initial.revision);
	const [draftId, setDraftId] = useState<string | null>(initial.draftId);
	const [baseTranscriptRevisionId, setBaseTranscriptRevisionId] = useState(
		initial.baseTranscriptRevisionId,
	);
	const [currentTranscriptRevisionId, setCurrentTranscriptRevisionId] = useState(
		initial.currentTranscriptRevisionId,
	);
	const [phase, setPhase] = useState<
		"idle" | "saving" | "saved" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [remote, setRemote] = useState<SessionEditorialDraft | null>(null);
	const [currentPublicationId, setCurrentPublicationId] = useState<string | null>(
		initialPublication.currentPublicationId,
	);
	const [currentPublicationVersion, setCurrentPublicationVersion] = useState(
		initialPublication.currentVersion,
	);
	const [publishIntent, setPublishIntent] = useState<PublishIntent | null>(null);
	const [publishPhase, setPublishPhase] = useState<
		"idle" | "publishing" | "published" | "error"
	>("idle");
	const [publishMessage, setPublishMessage] = useState<string | null>(null);
	const [coverUploadState, setCoverUploadState] = useState<SessionCoverUploadState>({
		phase: "idle",
		progress: null,
	});
	const coverUploadPending =
		coverUploadState.phase === "hashing" ||
		coverUploadState.phase === "uploading" ||
		coverUploadState.phase === "finalizing";
	const publicationDialogRef = useRef<HTMLDialogElement>(null);
	const publicationDialogTitleRef = useRef<HTMLElement>(null);
	const publicationTriggerRef = useRef<HTMLButtonElement>(null);
	const dirty = !sameFields(fields, baseline);
	const missing = useMemo(
		() =>
			sessionDraftReadiness({
				coverAssetId: fields.coverAssetId,
				title: fields.title,
				shortDescription: fields.shortDescription,
				fullSummary: fields.fullSummary,
				sessionDate: fields.sessionDate,
			}),
		[fields],
	);
	const transcriptChanged =
		baseTranscriptRevisionId !== currentTranscriptRevisionId;
	const publishReady =
		publicationAvailable &&
		publishable &&
		Boolean(draftId) &&
		revision > 0 &&
		!dirty &&
		!missing.length &&
		!transcriptChanged &&
		!coverUploadPending &&
		phase !== "saving" &&
		phase !== "conflict" &&
		publishPhase !== "publishing";

	useEffect(() => {
		const dialog = publicationDialogRef.current;
		if (!dialog) return;
		if (publishIntent) {
			if (!dialog.open) dialog.showModal();
			window.requestAnimationFrame(() => publicationDialogTitleRef.current?.focus());
			return;
		}
		if (dialog.open) {
			dialog.close();
			window.requestAnimationFrame(() => publicationTriggerRef.current?.focus());
		}
	}, [publishIntent]);

	useEffect(() => {
		setCurrentTranscriptRevisionId(initial.currentTranscriptRevisionId);
	}, [initial.currentTranscriptRevisionId]);

	useEffect(() => {
		setCurrentPublicationId(initialPublication.currentPublicationId);
		setCurrentPublicationVersion(initialPublication.currentVersion);
	}, [
		initialPublication.currentPublicationId,
		initialPublication.currentVersion,
	]);

	useEffect(() => {
		if (!dirty) return;
		const guard = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty]);

	async function save() {
		if (!editable || !dirty || phase === "saving") return;
		setPhase("saving");
		setMessage(null);
		setRemote(null);
		const input = {
			campaignSlug,
			sessionId,
			expectedRevision: revision,
			baseTranscriptRevisionId,
			...fields,
		};
		const validationIssues = validateSessionEditorialDraftInput(input);
		if (validationIssues.length) {
			setPhase("error");
			setMessage("Há um campo fora dos limites do contrato. Nada foi truncado nem salvo.");
			return;
		}
		const result = await saveDraft(input);
		if (!result.ok) {
			if (result.reason === "conflict" && result.remote) {
				setPhase("conflict");
				setRemote(result.remote);
				setMessage(
					"Outra edição já salvou uma versão mais nova (r" +
						result.remote.revision +
						"). Sua working copy continua intacta.",
				);
				return;
			}
			setPhase("error");
			setMessage(
				result.reason === "validation"
					? "Há um campo fora dos limites do contrato. Nada foi truncado nem salvo."
					: "Não foi possível salvar o draft. Sua working copy continua nesta tela.",
			);
			return;
		}
		setRevision(result.draft.revision);
		setDraftId(result.draft.draftId);
		setBaseTranscriptRevisionId(result.draft.baseTranscriptRevisionId);
		setCurrentTranscriptRevisionId(result.draft.currentTranscriptRevisionId);
		const savedFields = fieldsFromDraft(result.draft);
		setFields(savedFields);
		setBaseline(savedFields);
		setPhase("saved");
		setMessage("Draft r" + result.draft.revision + " salvo.");
	}

	useEffect(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (
				active &&
				(event.ctrlKey || event.metaKey) &&
				event.key.toLocaleLowerCase() === "s"
			) {
				event.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	});

	function reconcileRemote(reconcileMode: "remote" | "local") {
		if (!remote) return;
		setRevision(remote.revision);
		setDraftId(remote.draftId);
		setBaseTranscriptRevisionId(remote.baseTranscriptRevisionId);
		setCurrentTranscriptRevisionId(remote.currentTranscriptRevisionId);
		const remoteFields = fieldsFromDraft(remote);
		setBaseline(remoteFields);
		if (reconcileMode === "remote") setFields(remoteFields);
		setRemote(null);
		setPhase("idle");
		setMessage(
			reconcileMode === "local"
				? "Working copy mantida sobre a baseline remota r" +
						remote.revision +
						". Revise e salve novamente."
				: "Versão remota r" + remote.revision + " carregada.",
		);
	}

	function openPublicationConfirmation() {
		if (!publishReady || !draftId) {
			setPublishPhase("error");
			setPublishMessage(
				!publicationAvailable
					? "A autoridade de publicação está indisponível agora."
					: !publishable
						? "Sua conta não tem a capability de publicação desta campanha."
						: coverUploadPending
							? "Aguarde a nova capa terminar de enviar e validar."
							: dirty
								? "Salve o draft antes de publicar."
								: transcriptChanged
								? "A transcrição mudou. Revise e salve um novo draft antes de publicar."
								: missing.length
									? "Complete os campos editoriais obrigatórios antes de publicar."
									: "O draft ainda não está pronto para publicação.",
			);
			return;
		}
		setPublishMessage(null);
		setPublishPhase("idle");
		setPublishIntent({
			operationId: crypto.randomUUID(),
			draftId,
			draftRevision: revision,
			baseTranscriptRevisionId,
			expectedCurrentPublicationId: currentPublicationId,
			fields: { ...fields },
		});
	}

	function cancelPublication() {
		if (publishPhase === "publishing") return;
		setPublishIntent(null);
		setPublishMessage(null);
		setPublishPhase("idle");
	}

	async function publish() {
		const intent = publishIntent;
		if (!intent || publishPhase === "publishing") return;
		if (
			coverUploadPending ||
			dirty ||
			draftId !== intent.draftId ||
			revision !== intent.draftRevision ||
			baseTranscriptRevisionId !== intent.baseTranscriptRevisionId
		) {
			setPublishPhase("error");
			setPublishMessage(
				coverUploadPending
					? "A nova capa ainda está sendo enviada ou validada. Aguarde a conclusão antes de publicar."
					: "O draft mudou depois da confirmação. Abra a confirmação novamente.",
			);
			if (!coverUploadPending) setPublishIntent(null);
			return;
		}

		setPublishPhase("publishing");
		setPublishMessage("Publicando versão confirmada…");
		const result = await publishDraft({
			campaignSlug,
			sessionId,
			draftId: intent.draftId,
			expectedCurrentPublicationId: intent.expectedCurrentPublicationId,
			operationId: intent.operationId,
		});
		if (!result.ok) {
			setPublishPhase("error");
			if (
				result.reason === "stale_current" ||
				result.reason === "draft_changed" ||
				result.reason === "transcript_changed" ||
				result.reason === "operation_conflict"
			) {
				setPublishIntent(null);
			}
			setPublishMessage(
				result.reason === "stale_current"
					? "A versão pública mudou desde a confirmação. Atualize a página e confirme novamente."
					: result.reason === "draft_changed"
						? "O draft autoritativo mudou. Revise a versão atual antes de publicar."
						: result.reason === "transcript_changed"
							? "A transcrição mudou desde a base do draft. Revise e salve antes de publicar."
							: result.reason === "not_ready"
								? "O draft não passou pela validação autoritativa de publicação."
								: result.reason === "cover_unverified"
									? "A capa não pôde ser promovida e verificada publicamente. A versão anterior continua ativa."
									: result.reason === "operation_conflict"
										? "Esta operação de publicação já existe com outro payload. Nada foi alterado."
										: result.reason === "forbidden"
											? "Sua conta não tem autorização para publicar esta sessão."
											: result.reason === "readback_unavailable"
												? "O commit pode ter ocorrido, mas o read-back não confirmou. Tente novamente: a mesma operação será reutilizada sem duplicar versão."
												: "Não foi possível confirmar a publicação. Tente novamente; a mesma operação será reutilizada.",
			);
			if (result.reason === "stale_current") router.refresh();
			return;
		}

		if (result.receipt.currentlyActive) {
			setCurrentPublicationId(result.receipt.publicationId);
			setCurrentPublicationVersion(result.receipt.version);
		}
		setPublishIntent(null);
		setPublishPhase("published");
		setPublishMessage(
			result.receipt.replayed && !result.receipt.currentlyActive
				? "Publicação v" +
						result.receipt.version +
						" recuperada pelo receipt; uma versão pública mais nova já está ativa."
				: (result.receipt.replayed
						? "Publicação recuperada"
						: "Publicação concluída") +
						" · versão pública v" +
						result.receipt.version +
						(result.receipt.cachePending
							? " · propagação de cache pendente."
							: "."),
		);
		router.refresh();
	}

	return (
		<section className={draftStyles.editorialPanel} aria-label="Edição da sessão">
			<header className={draftStyles.editorialHeader}>
				<div>
					<span className={styles.muted}>
						{surface === "summary" ? "RESUMO COMPLETO" : "DADOS DA SESSÃO"}
					</span>
					<h2>{surface === "summary" ? "Resumo detalhado" : "Sessão"}</h2>
				</div>
				<span className={styles.muted}>Draft r{revision}</span>
			</header>

			{initial.seededFromPublished && revision === 0 ? (
				<p className={draftStyles.editorialNotice}>
					Os campos começaram com a versão pública atual. Nada muda no site até
					uma publicação explícita.
				</p>
			) : null}
			{transcriptChanged ? (
				<p className={draftStyles.editorialWarning} role="status">
					A transcrição foi atualizada desde a base deste draft. O conteúdo
					editorial foi preservado; revise a diferença antes de publicar.
				</p>
			) : null}

			{surface === "session" ? (
				<div className={draftStyles.sessionEditor}>
					<div className={draftStyles.coverField}>
						<span className={styles.fieldLabel}>Capa</span>
						<CoverEditor
							disabled={!editable}
							onChange={(coverAssetId) =>
								setFields((current) => ({ ...current, coverAssetId }))
							}
							onUploadStateChange={setCoverUploadState}
							campaignSlug={campaignSlug}
							sessionId={sessionId}
							value={fields.coverAssetId}
						/>
					</div>

					<div className={draftStyles.sessionMetadataFields}>
						<label className={styles.fieldLabel}>
							Título
							<input
								className={styles.control}
								disabled={!editable}
								onChange={(event) =>
									setFields((current) => ({
										...current,
										title: event.target.value,
									}))
								}
								value={fields.title}
							/>
							<small>
								{fieldCount(fields.title)} / {SESSION_DRAFT_LIMITS.title}
							</small>
						</label>

						<label className={styles.fieldLabel}>
							Arco
							<input
								className={styles.control}
								disabled={!editable}
								onChange={(event) =>
									setFields((current) => ({
										...current,
										arc: event.target.value,
									}))
								}
								value={fields.arc}
							/>
							<small>
								{fieldCount(fields.arc)} / {SESSION_DRAFT_LIMITS.arc}
							</small>
						</label>

						<label className={styles.fieldLabel}>
							Data
							<input
								className={styles.control}
								disabled={!editable}
								type="date"
								onChange={(event) =>
									setFields((current) => ({
										...current,
										sessionDate: event.target.value,
									}))
								}
								value={fields.sessionDate}
							/>
							{fields.sessionDate && !isCanonicalSessionDate(fields.sessionDate) ? (
								<small role="alert">Use uma data válida no formato AAAA-MM-DD.</small>
							) : (
								<small>Data canônica sem horário ou timezone.</small>
							)}
						</label>

						<label className={styles.fieldLabel}>
							Descrição
							<textarea
								className={styles.textarea}
								disabled={!editable}
								onChange={(event) =>
									setFields((current) => ({
										...current,
										shortDescription: event.target.value,
									}))
								}
								rows={7}
								value={fields.shortDescription}
							/>
							<small>
								{fieldCount(fields.shortDescription)} /{" "}
								{SESSION_DRAFT_LIMITS.shortDescription}
							</small>
						</label>
					</div>
				</div>
			) : (
				<div className={draftStyles.summaryWorkspace}>
					<section className={draftStyles.summaryPane} aria-label="Markdown bruto">
						<header className={draftStyles.summaryPaneHeader}>
							<div>
								<strong>Markdown RAW</strong>
								<span>Edite o resumo completo detalhado.</span>
							</div>
							<small>
								{fieldCount(fields.fullSummary).toLocaleString("pt-BR")} /{" "}
								{SESSION_DRAFT_LIMITS.fullSummary.toLocaleString("pt-BR")}
							</small>
						</header>
						<textarea
							aria-label="Resumo completo em Markdown"
							className={[styles.textarea, draftStyles.summaryEditor].join(" ")}
							disabled={!editable}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									fullSummary: event.target.value,
								}))
							}
							spellCheck
							value={fields.fullSummary}
						/>
					</section>

					<section className={draftStyles.summaryPane} aria-label="Preview do Markdown">
						<header className={draftStyles.summaryPaneHeader}>
							<div>
								<strong>Preview</strong>
								<span>Renderização igual à superfície pública.</span>
							</div>
						</header>
						<article className={draftStyles.summaryPreview}>
							{fields.fullSummary.trim() ? (
								<StoryMarkdown
									source={fields.fullSummary}
									title={fields.title.trim() || "Sessão"}
								/>
							) : (
								<p className={styles.muted}>
									O preview aparece aqui assim que você começar a escrever o resumo.
								</p>
							)}
						</article>
					</section>
				</div>
			)}

			{surface === "session" ? (
				<div className={draftStyles.readinessPanel}>
					<strong>
						{coverUploadPending
							? "Capa em preparação"
							: missing.length
								? "Sessão ainda incompleta"
								: "Campos editoriais preenchidos"}
					</strong>
					<span className={styles.muted}>
						{coverUploadPending
							? "Capa: envio ou validação em andamento. A publicação fica bloqueada até concluir."
							: missing.length
								? "Faltando: " + missing.join(", ") + "."
								: "A publicação ainda fará validação autoritativa e da capa finalizada."}
					</span>
				</div>
			) : null}

			{phase === "conflict" && remote ? (
				<div className={styles.conflictPanel} role="alert">
					<strong>Conflito de edição</strong>
					<p>{message}</p>
					<p className={styles.muted}>
						Remoto r{remote.revision}: {remote.title.trim() || "sem título"}.
					</p>
					<div className={styles.conflictActions}>
						<button
							className={draftStyles.primaryButton}
							onClick={() => reconcileRemote("local")}
							type="button"
						>
							Manter minha working copy sobre r{remote.revision}
						</button>
						<button
							className={draftStyles.controlButton}
							onClick={() => reconcileRemote("remote")}
							type="button"
						>
							Usar versão remota
						</button>
					</div>
				</div>
			) : null}

			<dialog
				className={draftStyles.publicationConfirm}
				ref={publicationDialogRef}
				aria-label="Confirmar publicação da sessão"
				onCancel={(event) => {
					event.preventDefault();
					cancelPublication();
				}}
			>
				{publishIntent ? (
					<>
						<strong ref={publicationDialogTitleRef} tabIndex={-1}>
							Publicar esta sessão no site?
						</strong>
						<dl className={draftStyles.publicationSummary}>
							<div>
								<dt>Capa</dt>
								<dd>pronta para verificação pública</dd>
							</div>
							<div>
								<dt>Arco</dt>
								<dd>{publishIntent.fields.arc.trim() || "sem arco"}</dd>
							</div>
							<div>
								<dt>Título</dt>
								<dd>{publishIntent.fields.title.trim()}</dd>
							</div>
							<div>
								<dt>Data</dt>
								<dd>{formatSessionDate(publishIntent.fields.sessionDate)}</dd>
							</div>
							<div>
								<dt>Descrição</dt>
								<dd>
									{fieldCount(
										publishIntent.fields.shortDescription,
									).toLocaleString("pt-BR")}{" "}
									caracteres
								</dd>
							</div>
							<div>
								<dt>Resumo completo</dt>
								<dd>
									{fieldCount(publishIntent.fields.fullSummary).toLocaleString(
										"pt-BR",
									)}{" "}
									caracteres · Markdown
								</dd>
							</div>
							<div>
								<dt>Versão pública atual</dt>
								<dd>
									{currentPublicationId
										? "v" + currentPublicationVersion
										: initial.sessionStatus === "published"
											? "legada · pré-versionamento"
											: "nenhuma"}
								</dd>
							</div>
							<div>
								<dt>Base do draft</dt>
								<dd>r{publishIntent.draftRevision}</dd>
							</div>
						</dl>
						<p className={styles.muted}>
							A transcrição completa continuará privada. Somente capa, arco, título,
							descrição curta e resumo completo serão promovidos.
						</p>
						{coverUploadPending ? (
							<p role="alert">
								A nova capa está sendo enviada ou validada. Aguarde a conclusão antes
								de publicar.
							</p>
						) : dirty ? (
							<p role="alert">
								O draft foi alterado depois desta confirmação. Salve e abra a
								confirmação novamente.
							</p>
						) : null}
						{publishMessage ? (
							<p
								className={styles.saveState}
								data-state={publishPhase === "published" ? "saved" : publishPhase}
								role={publishPhase === "error" ? "alert" : "status"}
							>
								{publishMessage}
							</p>
						) : null}
						<div className={draftStyles.editorialActions}>
							<button
								className={draftStyles.controlButton}
								disabled={publishPhase === "publishing"}
								onClick={cancelPublication}
								type="button"
							>
								Cancelar
							</button>
							<button
								aria-busy={publishPhase === "publishing" || undefined}
								className={draftStyles.primaryButton}
								disabled={
									publishPhase === "publishing" || coverUploadPending || dirty
								}
								onClick={() => void publish()}
								type="button"
							>
								{publishPhase === "publishing"
									? "Publicando…"
									: currentPublicationId || initial.sessionStatus === "published"
										? "Confirmar nova versão"
										: "Confirmar e publicar"}
							</button>
						</div>
					</>
				) : null}
			</dialog>

			<footer className={draftStyles.editorialFooter}>
				<div>
					<span
						className={styles.saveState}
						data-state={phase === "saved" ? "saved" : dirty ? "dirty" : phase}
						aria-live="polite"
					>
						{phase === "saving"
							? "Salvando…"
							: dirty
								? "Alterações não salvas"
								: message || "Draft r" + revision + " sincronizado"}
					</span>
					<small className={styles.muted}>
						{" "}
						· Ctrl/⌘+S salva; nenhum atalho publica.
					</small>
				</div>

				{publishMessage && !publishIntent ? (
					<span
						className={styles.saveState}
						data-state={publishPhase === "published" ? "saved" : publishPhase}
						role={publishPhase === "error" ? "alert" : "status"}
					>
						{publishMessage}
					</span>
				) : null}

				<div className={draftStyles.editorialActions}>
					<button
						aria-busy={phase === "saving" || undefined}
						className={draftStyles.primaryButton}
						disabled={
							!editable ||
							!dirty ||
							phase === "saving" ||
							phase === "conflict"
						}
						onClick={() => void save()}
						type="button"
					>
						{phase === "saving" ? "Salvando…" : "Salvar draft"}
					</button>
					<button
						className={draftStyles.controlButton}
						disabled={!onPreview}
						onClick={onPreview}
						type="button"
					>
						Preview
					</button>
					<button
						className={draftStyles.controlButton}
						disabled={!publishReady}
						ref={publicationTriggerRef}
						title={
							!publicationAvailable
								? "Autoridade de publicação indisponível."
								: !publishable
									? "Sua conta não tem a capability de publicação."
									: coverUploadPending
										? "Aguarde a nova capa terminar de enviar e validar."
										: dirty
											? "Salve o draft antes de publicar."
											: transcriptChanged
											? "Revise a transcrição atual antes de publicar."
											: missing.length
												? "Complete os campos editoriais obrigatórios."
												: "Publicação pública explícita."
						}
						onClick={openPublicationConfirmation}
						type="button"
					>
						{currentPublicationId || initial.sessionStatus === "published"
							? "Publicar nova versão"
							: "Publicar no site"}
					</button>
				</div>
			</footer>
		</section>
	);
}
