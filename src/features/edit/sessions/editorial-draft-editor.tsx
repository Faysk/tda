"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import styles from "@/features/edit/workbench.module.css";
import draftStyles from "./editorial-draft.module.css";
import { saveSessionEditorialDraftAction } from "./editorial-draft-actions";
import { publishSessionEditorialDraftAction } from "./session-publication-actions";
import {
	type SessionPublicationState,
	shortPublicationId,
} from "./session-publication-model";
import { SessionCoverEditor } from "./session-cover-editor";
import {
	isExistingPublishedSessionCoverReference,
	sessionCoverPreviewUrl,
} from "./session-cover-media";
import {
	SESSION_DRAFT_LIMITS,
	type SessionEditorialDraft,
	sessionDraftReadiness,
	sessionDraftScalarLength,
	validateSessionEditorialDraftInput,
} from "./editorial-draft-model";

type Props = Readonly<{
	sessionId: string;
	initial: SessionEditorialDraft;
	initialPublication: SessionPublicationState;
	editable: boolean;
	publishable: boolean;
}>;

type Fields = Readonly<{
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
}>;

function fieldsFromDraft(draft: SessionEditorialDraft): Fields {
	return {
		coverAssetId: draft.coverAssetId,
		arc: draft.arc,
		title: draft.title,
		shortDescription: draft.shortDescription,
		fullSummary: draft.fullSummary,
	};
}

function sameFields(left: Fields, right: Fields) {
	return (
		left.coverAssetId === right.coverAssetId &&
		left.arc === right.arc &&
		left.title === right.title &&
		left.shortDescription === right.shortDescription &&
		left.fullSummary === right.fullSummary
	);
}

function previewableCoverUrl(value: string): string | null {
	const raw = value.trim();
	return isExistingPublishedSessionCoverReference(raw) ? raw : null;
}

function fieldCount(value: string): number {
	return sessionDraftScalarLength(value) ?? Number.POSITIVE_INFINITY;
}

export function SessionEditorialDraftEditor({
	sessionId,
	initial,
	initialPublication,
	editable,
	publishable,
}: Props) {
	const [fields, setFields] = useState<Fields>(() => fieldsFromDraft(initial));
	const [baseline, setBaseline] = useState<Fields>(() => fieldsFromDraft(initial));
	const [draftId, setDraftId] = useState(initial.draftId);
	const [revision, setRevision] = useState(initial.revision);
	const [publication, setPublication] =
		useState<SessionPublicationState>(initialPublication);
	const [publishPhase, setPublishPhase] = useState<
		"idle" | "publishing" | "published" | "error"
	>("idle");
	const [publishMessage, setPublishMessage] = useState<string | null>(null);
	const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);
	const [publishConfirmation, setPublishConfirmation] = useState<{
		expectedCurrentPublicationId: string | null;
		expectedVersion: number | null;
	} | null>(null);
	const [baseTranscriptRevisionId, setBaseTranscriptRevisionId] = useState(
		initial.baseTranscriptRevisionId,
	);
	const [currentTranscriptRevisionId, setCurrentTranscriptRevisionId] = useState(
		initial.currentTranscriptRevisionId,
	);
	const [mode, setMode] = useState<"edit" | "preview">("edit");
	const [phase, setPhase] = useState<
		"idle" | "saving" | "saved" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [remote, setRemote] = useState<SessionEditorialDraft | null>(null);
	const dirty = !sameFields(fields, baseline);
	const missing = useMemo(
		() =>
			sessionDraftReadiness({
				coverAssetId: fields.coverAssetId,
				title: fields.title,
				shortDescription: fields.shortDescription,
				fullSummary: fields.fullSummary,
			}),
		[fields],
	);
	const transcriptChanged =
		baseTranscriptRevisionId !== currentTranscriptRevisionId;

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
		const result = await saveSessionEditorialDraftAction(input);
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
		setDraftId(result.draft.draftId);
		setRevision(result.draft.revision);
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
		setDraftId(remote.draftId);
		setRevision(remote.revision);
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

	const publicationBlocked =
		!publishable ||
		!draftId ||
		dirty ||
		missing.length > 0 ||
		transcriptChanged ||
		phase === "saving" ||
		phase === "conflict" ||
		publication.sourceDraftId === draftId;

	function openPublishConfirmation() {
		if (publicationBlocked) return;
		setPublishMessage(null);
		setPublishPhase("idle");
		setPendingOperationId(null);
		setPublishConfirmation({
			expectedCurrentPublicationId: publication.currentPublicationId,
			expectedVersion: publication.version,
		});
	}

	async function publish() {
		if (!draftId || !publishConfirmation || publishPhase === "publishing") return;
		const operationId = pendingOperationId ?? crypto.randomUUID();
		setPendingOperationId(operationId);
		setPublishPhase("publishing");
		setPublishMessage(null);
		const result = await publishSessionEditorialDraftAction({
			sessionId,
			draftId,
			expectedCurrentPublicationId:
				publishConfirmation.expectedCurrentPublicationId,
			operationId,
		});
		if (!result.ok) {
			if (result.state) setPublication(result.state);
			setPublishPhase("error");
			const messages: Record<string, string> = {
				conflict:
					"A versão pública mudou depois da confirmação. Reabra a confirmação com o estado atual.",
				draft_stale:
					"O draft salvo mudou. Recarregue ou salve novamente antes de publicar.",
				transcript_stale:
					"A transcrição mudou desde a base deste draft. Revise antes de publicar.",
				draft_incomplete: "O draft salvo ainda está incompleto.",
				cover_not_verified:
					"A capa não pôde ser promovida e verificada. A versão pública anterior foi preservada.",
				forbidden: "Sua conta não possui permissão editorial para publicar.",
				not_production: "Publicação real só é permitida no ambiente Production.",
				operation_conflict:
					"A identidade desta operação já foi usada com outro payload. Gere uma nova confirmação.",
				dependency_unavailable:
					"A resposta ficou inconclusiva. Tente novamente: a mesma operação será reconciliada sem duplicar publicação.",
			};
			setPublishMessage(
				messages[result.reason] ??
					"Não foi possível publicar. A versão pública anterior foi preservada.",
			);
			if (result.reason !== "dependency_unavailable") setPendingOperationId(null);
			return;
		}
		setPublication(result.state);
		setPublishPhase("published");
		setPublishMessage(
			"Versão pública v" +
				result.version +
				(result.replayed ? " reconciliada por receipt." : " publicada."),
		);
		setPendingOperationId(null);
		setPublishConfirmation(null);
	}

	const privateCoverPreviewUrl = sessionCoverPreviewUrl(
		sessionId,
		fields.coverAssetId,
	);
	const coverPreviewUrl =
		privateCoverPreviewUrl ?? previewableCoverUrl(fields.coverAssetId);

	return (
		<section className={draftStyles.editorialPanel} aria-label="Publicação da sessão">
			<header className={draftStyles.editorialHeader}>
				<div>
					<span className={styles.muted}>PUBLICAÇÃO DA SESSÃO</span>
					<h2>Draft editorial</h2>
				</div>
				<span className={styles.muted}>r{revision}</span>
			</header>

			{initial.seededFromPublished && revision === 0 ? (
				<p className={draftStyles.editorialNotice}>
					Os campos começaram com a versão pública atual. Nada muda no site até
					uma publicação explícita.
				</p>
			) : null}
			{transcriptChanged ? (
				<p className={draftStyles.editorialWarning} role="status">
					A transcrição foi atualizada desde a base deste draft. O texto foi
					preservado; revise a diferença antes de publicar.
				</p>
			) : null}

			<div className={draftStyles.editorialTabs} role="tablist" aria-label="Modo do draft">
				<button
					aria-selected={mode === "edit"}
					className={
						mode === "edit" ? draftStyles.editorialTabActive : draftStyles.editorialTab
					}
					onClick={() => setMode("edit")}
					role="tab"
					type="button"
				>
					Editar
				</button>
				<button
					aria-selected={mode === "preview"}
					className={
						mode === "preview"
							? draftStyles.editorialTabActive
							: draftStyles.editorialTab
					}
					onClick={() => setMode("preview")}
					role="tab"
					type="button"
				>
					Preview
				</button>
			</div>

			{mode === "edit" ? (
				<div className={draftStyles.editorialFields}>
					<div className={draftStyles.coverField}>
						<span className={styles.fieldLabel}>Capa</span>
						<SessionCoverEditor
							disabled={!editable}
							onChange={(coverAssetId) =>
								setFields((current) => ({ ...current, coverAssetId }))
							}
							sessionId={sessionId}
							value={fields.coverAssetId}
						/>
					</div>

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
						Descrição curta · conteúdo público
						<textarea
							className={styles.textarea}
							disabled={!editable}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									shortDescription: event.target.value,
								}))
							}
							rows={5}
							value={fields.shortDescription}
						/>
						<small>
							{fieldCount(fields.shortDescription)} /{" "}
							{SESSION_DRAFT_LIMITS.shortDescription}
						</small>
					</label>

					<label className={styles.fieldLabel}>
						Resumo completo · Markdown
						<textarea
							className={[styles.textarea, draftStyles.summaryEditor].join(" ")}
							disabled={!editable}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									fullSummary: event.target.value,
								}))
							}
							value={fields.fullSummary}
						/>
						<small>
							{fieldCount(fields.fullSummary).toLocaleString("pt-BR")} /{" "}
							{SESSION_DRAFT_LIMITS.fullSummary.toLocaleString("pt-BR")}
						</small>
					</label>
				</div>
			) : (
				<div className={draftStyles.editorialPreview}>
					<div className={draftStyles.previewCard}>
						<span>{fields.arc.trim() || "Memória da campanha"}</span>
						<strong>{fields.title.trim() || "Título ainda não definido"}</strong>
						<p>
							{fields.shortDescription.trim() ||
								"Descrição curta ainda não definida."}
						</p>
					</div>
					<article className={draftStyles.previewStory}>
						<div className={draftStyles.coverPreview}>
							{coverPreviewUrl ? (
								<Image
									src={coverPreviewUrl}
									alt=""
									fill
									sizes="(max-width: 1180px) 100vw, 40vw"
									unoptimized={Boolean(privateCoverPreviewUrl)}
								/>
							) : (
								<span>Preview sem capa finalizada</span>
							)}
						</div>
						<h3>{fields.title.trim() || "Título ainda não definido"}</h3>
						<StoryMarkdown
							source={fields.fullSummary}
							title={fields.title.trim() || "Sessão"}
						/>
					</article>
				</div>
			)}

			<div className={draftStyles.readinessPanel}>
				<strong>
					{missing.length
						? "Draft incompleto"
						: "Campos editoriais preenchidos"}
				</strong>
				<span className={styles.muted}>
					{missing.length
						? "Faltando: " + missing.join(", ") + "."
						: "A publicação ainda fará validação autoritativa e da capa finalizada."}
				</span>
			</div>

			{publishConfirmation ? (
				<div className={draftStyles.publishConfirm} role="alertdialog" aria-label="Confirmar publicação">
					<div>
						<span className={styles.muted}>PUBLICAÇÃO PÚBLICA</span>
						<h3>Publicar esta sessão no site?</h3>
					</div>
					<dl className={draftStyles.publishFacts}>
						<div><dt>Capa</dt><dd>pronta</dd></div>
						<div><dt>Arco</dt><dd>{fields.arc.trim() || "—"}</dd></div>
						<div><dt>Título</dt><dd>{fields.title.trim()}</dd></div>
						<div><dt>Descrição</dt><dd>{fieldCount(fields.shortDescription).toLocaleString("pt-BR")} caracteres</dd></div>
						<div><dt>Resumo completo</dt><dd>{fieldCount(fields.fullSummary).toLocaleString("pt-BR")} caracteres · Markdown</dd></div>
						<div><dt>Versão pública atual</dt><dd>{publishConfirmation.expectedVersion === null ? "nenhuma" : "v" + publishConfirmation.expectedVersion}</dd></div>
						<div><dt>Draft salvo</dt><dd>r{revision} · {shortPublicationId(draftId)}</dd></div>
						<div><dt>Transcript base</dt><dd>{shortPublicationId(baseTranscriptRevisionId)}</dd></div>
					</dl>
					<p className={draftStyles.editorialWarning}>
						A transcrição completa continuará privada no Edit.
					</p>
					{publishMessage ? (
						<p className={draftStyles.editorialWarning} role="status">{publishMessage}</p>
					) : null}
					<div className={draftStyles.editorialActions}>
						<button
							className={draftStyles.controlButton}
							disabled={publishPhase === "publishing"}
							onClick={() => {
								setPublishConfirmation(null);
								setPendingOperationId(null);
								setPublishMessage(null);
							}}
							type="button"
						>
							Cancelar
						</button>
						<button
							className={draftStyles.primaryButton}
							disabled={publishPhase === "publishing"}
							onClick={() => void publish()}
							type="button"
						>
							{publishPhase === "publishing"
								? "Publicando…"
								: publication.currentPublicationId
									? "Publicar nova versão"
									: "Publicar no site"}
						</button>
					</div>
				</div>
			) : null}

			{phase === "conflict" && remote ? (
				<div className={styles.conflictPanel} role="alert">
					<strong>Conflito de edição</strong>
					<p>{message}</p>
					<p className={styles.muted}>
						Remoto r{remote.revision}:{" "}
						{remote.title.trim() || "sem título"}.
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

			<footer className={draftStyles.editorialFooter}>
				<div>
					<span
						className={styles.saveState}
						data-state={
							phase === "saved" ? "saved" : dirty ? "dirty" : phase
						}
						aria-live="polite"
					>
						{phase === "saving"
							? "Salvando…"
							: message ||
								(dirty
									? "Alterações não salvas"
									: "Draft r" + revision + " sincronizado")}
					</span>
					<small className={styles.muted}>
						{" "}
						· Ctrl/⌘+S salva; nenhum atalho publica.
					</small>
				</div>
				<div className={draftStyles.editorialActions}>
					<button
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
						Salvar draft
					</button>
					<button
						className={draftStyles.controlButton}
						disabled={publicationBlocked}
						title={
							!publishable
								? "Publicação exige Production e capability editorial."
								: dirty
									? "Salve o draft antes de publicar."
									: publication.sourceDraftId === draftId
										? "Este draft já é a versão pública atual."
										: "Abrir confirmação da publicação pública."
						}
						onClick={openPublishConfirmation}
						type="button"
					>
						{publication.currentPublicationId
							? "Publicar nova versão"
							: "Publicar no site"}
					</button>
				</div>
			</footer>
		</section>
	);
}
