"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import styles from "@/features/edit/workbench.module.css";
import draftStyles from "./editorial-draft.module.css";
import { saveSessionEditorialDraftAction } from "./editorial-draft-actions";
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

function previewableCoverUrl(value: string): string | null {
	const raw = value.trim();
	if (!raw) return null;
	if (raw.startsWith("/assets/sessions/")) return raw;
	try {
		const url = new URL(raw);
		if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
		if (url.hostname === "media.dnd.faysk.dev" && !url.search && !url.hash) return url.toString();
		if (url.hostname === "dnd.faysk.dev" && url.pathname.startsWith("/assets/sessions/") && !url.search && !url.hash)
			return url.toString();
		return null;
	} catch {
		return null;
	}
}

function fieldCount(value: string): number {
	return sessionDraftScalarLength(value) ?? Number.POSITIVE_INFINITY;
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

	const coverPreviewUrl = previewableCoverUrl(fields.coverAssetId);

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
						<div className={draftStyles.coverPreview}>
							{coverPreviewUrl ? (
								<Image src={coverPreviewUrl} alt="" fill sizes="(max-width: 1180px) 100vw, 40vw" />
							) : (
								<span>
									{fields.coverAssetId
										? "Referência de capa salva"
										: "Sem capa"}
								</span>
							)}
						</div>
						<label className={styles.fieldLabel}>
							Referência/intent da capa
							<input
								className={styles.control}
								disabled={!editable}
								maxLength={SESSION_DRAFT_LIMITS.coverAssetId}
								onChange={(event) =>
									setFields((current) => ({
										...current,
										coverAssetId: event.target.value,
									}))
								}
								placeholder="A finalização física entra na etapa de upload"
								value={fields.coverAssetId}
							/>
						</label>
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
							{fieldCount(fields.shortDescription)} /{" "}\n\t\t\t\t\t\t\t{SESSION_DRAFT_LIMITS.shortDescription}
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
							{fields.fullSummary.length.toLocaleString("pt-BR")} /{" "}
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
								<Image src={coverPreviewUrl} alt="" fill sizes="(max-width: 1180px) 100vw, 40vw" />
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
