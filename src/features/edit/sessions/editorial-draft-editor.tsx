"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import { formatSessionDate } from "@/features/sessions/model";
import styles from "@/features/edit/workbench.module.css";
import draftStyles from "./editorial-draft.module.css";
import { saveSessionEditorialDraftAction } from "./editorial-draft-actions";
import { publishSessionEditorialDraftAction } from "./session-publication-actions";
import type { SessionPublicationState } from "./session-publication-model";
import { SessionCoverEditor } from "./session-cover-editor";
import {
	isExistingPublishedSessionCoverReference,
	sessionCoverPreviewUrl,
} from "./session-cover-media";
import {
	SESSION_DRAFT_LIMITS,
	isCanonicalSessionDate,
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
	publicationAvailable: boolean;
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
	publicationAvailable,
}: Props) {
	const router = useRouter();
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
	const [mode, setMode] = useState<"edit" | "preview">("edit");
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
		phase !== "saving" &&
		phase !== "conflict" &&
		publishPhase !== "publishing";

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
			dirty ||
			draftId !== intent.draftId ||
			revision !== intent.draftRevision ||
			baseTranscriptRevisionId !== intent.baseTranscriptRevisionId
		) {
			setPublishIntent(null);
			setPublishPhase("error");
			setPublishMessage(
				"O draft mudou depois da confirmação. Abra a confirmação novamente.",
			);
			return;
		}

		setPublishPhase("publishing");
		setPublishMessage("Publicando versão confirmada…");
		const result = await publishSessionEditorialDraftAction({
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
						Data da sessão
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
						<small>{formatSessionDate(fields.sessionDate) || "Data ainda não definida"}</small>
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
						<p className={styles.muted}>{formatSessionDate(fields.sessionDate) || "Data ainda não definida"}</p>
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

			{publishIntent ? (
				<div
					className={draftStyles.publicationConfirm}
					role="dialog"
					aria-label="Confirmar publicação da sessão"
				>
					<strong>Publicar esta sessão no site?</strong>
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
							<dd>{fieldCount(publishIntent.fields.shortDescription).toLocaleString("pt-BR")} caracteres</dd>
						</div>
						<div>
							<dt>Resumo completo</dt>
							<dd>{fieldCount(publishIntent.fields.fullSummary).toLocaleString("pt-BR")} caracteres · Markdown</dd>
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
					{dirty ? (
						<p role="alert">
							O draft foi alterado depois desta confirmação. Salve e abra a
							confirmação novamente.
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
							className={draftStyles.primaryButton}
							disabled={publishPhase === "publishing" || dirty}
							onClick={() => void publish()}
							type="button"
						>
							{publishPhase === "publishing"
								? "Publicando…"
								: currentPublicationId || initial.sessionStatus === "published"
									? "Publicar nova versão"
									: "Publicar no site"}
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
				{publishMessage ? (
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
						disabled={!publishReady}
						title={
							!publicationAvailable
								? "Autoridade de publicação indisponível."
								: !publishable
									? "Sua conta não tem a capability de publicação."
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
