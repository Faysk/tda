"use client";

import { useEffect, useMemo, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import styles from "@/features/edit/workbench.module.css";
import { saveSessionEditorialDraftAction } from "./editorial-draft-actions";
import { SessionCoverEditor } from "./session-cover-editor";
import {
	isSessionCoverUuid,
	sessionCoverPreviewUrl,
} from "./session-cover-media";
import {
	SESSION_DRAFT_LIMITS,
	type SessionEditorialDraft,
	sessionDraftReadiness,
} from "./editorial-draft-model";

type Props = Readonly<{
	sessionId: string;
	initial: SessionEditorialDraft;
	editable: boolean;
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

export function SessionEditorialDraftEditor({
	sessionId,
	initial,
	editable,
}: Props) {
	const [fields, setFields] = useState<Fields>(() => fieldsFromDraft(initial));
	const [baseline, setBaseline] = useState<Fields>(() => fieldsFromDraft(initial));
	const [revision, setRevision] = useState(initial.revision);
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
		const result = await saveSessionEditorialDraftAction({
			sessionId,
			expectedRevision: revision,
			baseTranscriptRevisionId,
			...fields,
		});
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

	const coverPreviewUrl =
		sessionCoverPreviewUrl(sessionId, fields.coverAssetId) ??
		(/^https:\/\//iu.test(fields.coverAssetId.trim())
			? fields.coverAssetId
			: undefined);

	return (
		<section className={styles.editorialPanel} aria-label="Publicação da sessão">
			<header className={styles.editorialHeader}>
				<div>
					<span className={styles.muted}>PUBLICAÇÃO DA SESSÃO</span>
					<h2>Draft editorial</h2>
				</div>
				<span className={styles.muted}>r{revision}</span>
			</header>

			{initial.seededFromPublished && revision === 0 ? (
				<p className={styles.editorialNotice}>
					Os campos começaram com a versão pública atual. Nada muda no site até
					uma publicação explícita.
				</p>
			) : null}
			{transcriptChanged ? (
				<p className={styles.editorialWarning} role="status">
					A transcrição foi atualizada desde a base deste draft. O texto foi
					preservado; revise a diferença antes de publicar.
				</p>
			) : null}

			<div className={styles.editorialTabs} role="tablist" aria-label="Modo do draft">
				<button
					aria-selected={mode === "edit"}
					className={
						mode === "edit" ? styles.editorialTabActive : styles.editorialTab
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
							? styles.editorialTabActive
							: styles.editorialTab
					}
					onClick={() => setMode("preview")}
					role="tab"
					type="button"
				>
					Preview
				</button>
			</div>

			{mode === "edit" ? (
				<div className={styles.editorialFields}>
					<div className={styles.coverField}>
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
							maxLength={SESSION_DRAFT_LIMITS.arc}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									arc: event.target.value,
								}))
							}
							value={fields.arc}
						/>
						<small>
							{fields.arc.length} / {SESSION_DRAFT_LIMITS.arc}
						</small>
					</label>

					<label className={styles.fieldLabel}>
						Título
						<input
							className={styles.control}
							disabled={!editable}
							maxLength={SESSION_DRAFT_LIMITS.title}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									title: event.target.value,
								}))
							}
							value={fields.title}
						/>
						<small>
							{fields.title.length} / {SESSION_DRAFT_LIMITS.title}
						</small>
					</label>

					<label className={styles.fieldLabel}>
						Descrição curta · conteúdo público
						<textarea
							className={styles.textarea}
							disabled={!editable}
							maxLength={SESSION_DRAFT_LIMITS.shortDescription}
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
							{fields.shortDescription.length} /{" "}
							{SESSION_DRAFT_LIMITS.shortDescription}
						</small>
					</label>

					<label className={styles.fieldLabel}>
						Resumo completo · Markdown
						<textarea
							className={[styles.textarea, styles.summaryEditor].join(" ")}
							disabled={!editable}
							maxLength={SESSION_DRAFT_LIMITS.fullSummary}
							onChange={(event) =>
								setFields((current) => ({
									...current,
									fullSummary: event.target.value,
								}))
							}
							value={fields.fullSummary}
						/>
						<small>
							{fields.fullSummary.length.toLocaleString("pt-BR")} /{" "}
							{SESSION_DRAFT_LIMITS.fullSummary.toLocaleString("pt-BR")}
						</small>
					</label>
				</div>
			) : (
				<div className={styles.editorialPreview}>
					<div className={styles.previewCard}>
						<span>{fields.arc.trim() || "Memória da campanha"}</span>
						<strong>{fields.title.trim() || "Título ainda não definido"}</strong>
						<p>
							{fields.shortDescription.trim() ||
								"Descrição curta ainda não definida."}
						</p>
					</div>
					<article className={styles.previewStory}>
						<div className={styles.coverPreview}>
							{coverPreviewUrl ? (
								<img src={coverPreviewUrl} alt="" />
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

			<div className={styles.readinessPanel}>
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
							className={styles.filterButton}
							onClick={() => reconcileRemote("local")}
							type="button"
						>
							Manter minha working copy sobre r{remote.revision}
						</button>
						<button
							className={styles.controlButton}
							onClick={() => reconcileRemote("remote")}
							type="button"
						>
							Usar versão remota
						</button>
					</div>
				</div>
			) : null}

			<footer className={styles.editorialFooter}>
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
				<div className={styles.editorialActions}>
					<button
						className={styles.filterButton}
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
						className={styles.controlButton}
						disabled
						title="A publicação pública é uma etapa separada do fluxo."
						type="button"
					>
						{initial.sessionStatus === "published"
							? "Publicar nova versão"
							: "Publicar no site"}
					</button>
				</div>
			</footer>
		</section>
	);
}
