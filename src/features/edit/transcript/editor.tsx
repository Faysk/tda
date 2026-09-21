"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
	reloadTranscriptSegmentAction,
	updateTranscriptSegmentAction,
} from "./actions";
import {
	acceptTranscriptConflictRemote,
	beginTranscriptSave,
	classifyTranscriptSaveFailure,
	completeTranscriptSaveFailure,
	completeTranscriptSaveSuccess,
	createTranscriptEditorState,
	editTranscriptDraft,
	isTranscriptEditorDirty,
	loadTranscriptConflictRemote,
	reapplyTranscriptConflictDraft,
	resetTranscriptDraft,
	resolveTranscriptShortcut,
	type TranscriptDraft,
	type TranscriptReviewStatus,
} from "./editor-state";
import styles from "../workbench.module.css";

type Segment = Readonly<{
	id: string;
	revision: number;
	startMs: number;
	endMs: number;
	text: string;
	speaker: string;
	reviewStatus: TranscriptReviewStatus;
}>;

type TranscriptEditorProps = Readonly<{
	sessionId: string;
	segments: readonly Segment[];
	batchOffset: number;
	editable: boolean;
}>;

const statusLabels = {
	pending: "Pendente",
	approved: "Aprovado",
	needs_review: "Revisar",
	discarded: "Descartado",
} as const;

const SEGMENT_FOCUS_SELECTOR = "[data-segment-focus-target='true']";

function formatTimestamp(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [hours, minutes, seconds]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
}

function issueMessage(issues: readonly string[]): string {
	if (issues.includes("text_required")) return "O texto não pode ficar vazio.";
	if (issues.includes("text_too_long")) return "O texto ultrapassa 10.000 caracteres.";
	if (issues.includes("speaker_required")) return "Informe o speaker.";
	if (issues.includes("speaker_too_long")) return "O speaker ultrapassa 160 caracteres.";
	if (issues.includes("not_found") || issues.includes("segment_not_found")) return "A fala não foi encontrada nesta sessão.";
	if (issues.includes("dependency_unavailable")) return "O serviço de edição está indisponível. Tente novamente.";
	if (issues.includes("forbidden")) return "Sua conta não tem permissão para editar esta fala.";
	if (issues.includes("unauthenticated")) return "Sua sessão expirou. Entre novamente para salvar.";
	return "Não foi possível salvar esta fala. Tente novamente.";
}

function toDraft(segment: Segment): TranscriptDraft {
	return {
		text: segment.text,
		speaker: segment.speaker,
		reviewStatus: segment.reviewStatus,
	};
}

function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.dataset.segmentFocusTarget === "true") return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target instanceof HTMLButtonElement
	);
}

function focusSegmentHandle(segment: HTMLElement) {
	segment.querySelector<HTMLElement>(SEGMENT_FOCUS_SELECTOR)?.focus();
}

function focusAdjacentSegment(current: HTMLElement, direction: -1 | 1) {
	const list = current.parentElement;
	if (!list) return;
	const segments = Array.from(
		list.querySelectorAll<HTMLElement>("[data-transcript-segment='true']"),
	);
	const currentIndex = segments.indexOf(current);
	const next = segments[currentIndex + direction];
	if (next) focusSegmentHandle(next);
}

function SegmentEditor({
	segment: initial,
	sessionId,
	position,
	editable,
}: Readonly<{
	segment: Segment;
	sessionId: string;
	position: number;
	editable: boolean;
}>) {
	const [editor, setEditor] = useState(() =>
		createTranscriptEditorState(toDraft(initial)),
	);
	const [revision, setRevision] = useState(initial.revision);
	const [reloadingCurrent, setReloadingCurrent] = useState(false);
	const [reconciliationError, setReconciliationError] = useState<string | null>(null);
	const textRef = useRef<HTMLTextAreaElement>(null);
	const speakerRef = useRef<HTMLInputElement>(null);
	const dirty = isTranscriptEditorDirty(editor);
	const { draft } = editor;

	async function loadCurrentVersion() {
		if (!editable || editor.phase !== "conflict" || reloadingCurrent) return;
		setReloadingCurrent(true);
		setReconciliationError(null);
		try {
			const result = await reloadTranscriptSegmentAction({
				sessionId,
				segmentId: initial.id,
			});
			if (!result.ok) {
				setReconciliationError(issueMessage(result.issues));
				return;
			}
			const remote: TranscriptDraft = {
				text: result.segment.text,
				speaker: result.segment.speaker,
				reviewStatus: result.segment.reviewStatus,
			};
			setRevision(result.revision);
			setEditor((current) => loadTranscriptConflictRemote(current, remote));
		} finally {
			setReloadingCurrent(false);
		}
	}

	async function save() {
		if (!editable) return;
		const started = beginTranscriptSave(editor);
		if (!started.submission) return;
		const submission = started.submission;
		setEditor(started.state);
		const result = await updateTranscriptSegmentAction({
			sessionId,
			segmentId: initial.id,
			expectedRevision: revision,
			text: submission.text,
			speaker: submission.speaker,
			reviewStatus: submission.reviewStatus,
		});
		if (!result.ok) {
			const failure = classifyTranscriptSaveFailure(result);
			setReconciliationError(null);
			const message =
				failure === "conflict"
					? "Conflito: existe uma versão mais nova desta fala. Seu rascunho foi preservado; recarregue os dados antes de salvar novamente."
					: issueMessage(result.issues);
			setEditor((current) =>
				completeTranscriptSaveFailure(current, submission, failure, message),
			);
			return;
		}
		setRevision(result.revision);
		setReconciliationError(null);
		const persisted: TranscriptDraft = {
			text: result.segment.text,
			speaker: result.segment.speaker,
			reviewStatus: result.segment.reviewStatus,
		};
		setEditor((current) =>
			completeTranscriptSaveSuccess(current, submission, persisted),
		);
	}

	const stateLabel = {
		clean: "Sem alterações",
		dirty: "Alterado",
		saving: "Salvando…",
		saved: "Salvo ✓",
		error: editor.message ?? "Erro ao salvar",
		conflict: editor.message ?? "Conflito de edição",
	}[editor.phase];

	return (
		<article
			aria-label={`Fala ${position}`}
			className={styles.segment}
			data-conflict={editor.phase === "conflict" ? "true" : "false"}
			data-dirty={dirty ? "true" : "false"}
			data-error={editor.phase === "error" ? "true" : "false"}
			data-transcript-segment="true"
			onKeyDown={(event) => {
				const shortcut = resolveTranscriptShortcut({
					key: event.key,
					ctrlKey: event.ctrlKey,
					metaKey: event.metaKey,
					shiftKey: event.shiftKey,
					editableTarget: isEditableTarget(event.target),
				});
				if (!shortcut) return;
				if (!editable && shortcut !== "previous" && shortcut !== "next") return;
				event.preventDefault();
				switch (shortcut) {
					case "previous":
						focusAdjacentSegment(event.currentTarget, -1);
						break;
					case "next":
						focusAdjacentSegment(event.currentTarget, 1);
						break;
					case "edit_text":
						textRef.current?.focus();
						break;
					case "edit_speaker":
						speakerRef.current?.focus();
						break;
					case "mark_needs_review":
						setEditor((current) =>
							editTranscriptDraft(current, { reviewStatus: "needs_review" }),
						);
						break;
					case "save":
						void save();
						break;
					case "cancel":
						setEditor((current) => resetTranscriptDraft(current));
						focusSegmentHandle(event.currentTarget);
						break;
				}
			}}
		>
			<div className={styles.segmentSide}>
				<div>
					<button
						aria-label={`Selecionar fala ${position} para navegação por teclado`}
						className={styles.segmentFocusTarget}
						data-segment-focus-target="true"
						type="button"
					>
						Fala {position}
					</button>
					<div className={styles.segmentTime}>
						{formatTimestamp(initial.startMs)} → {formatTimestamp(initial.endMs)}
					</div>
				</div>
				<label className={styles.fieldLabel}>
					Speaker
					<input
						className={styles.control}
						maxLength={160}
						onChange={(event) =>
							setEditor((current) =>
								editTranscriptDraft(current, { speaker: event.target.value }),
							)
						}
						readOnly={!editable}
						ref={speakerRef}
						value={draft.speaker}
					/>
				</label>
			</div>

			<div className={styles.segmentMain}>
				<label className={styles.fieldLabel}>
					Texto
					<textarea
						className={styles.textarea}
						maxLength={10_000}
						onChange={(event) =>
							setEditor((current) =>
								editTranscriptDraft(current, { text: event.target.value }),
							)
						}
						readOnly={!editable}
						ref={textRef}
						value={draft.text}
					/>
				</label>
				<div className={styles.segmentFooter}>
					<span>
						{draft.text.trim() ? draft.text.trim().split(/\s+/u).length : 0} palavras · {Array.from(draft.text).length} caracteres
					</span>
					{editable ? (
						<span
							aria-live="polite"
							className={styles.saveState}
							data-state={editor.phase}
							title={editor.message ?? undefined}
						>
							{stateLabel}
						</span>
					) : (
						<span className={styles.muted}>Somente leitura</span>
					)}
				</div>
				{editor.phase === "conflict" ? (
					<div className={styles.conflictPanel} role="alert">
						<div>
							<strong>Conflito de edição</strong>
							<p>
								Seu rascunho local continua preservado. Carregue a versão atual
								antes de decidir como reconciliar; salvar continua bloqueado.
							</p>
						</div>
						{editor.conflictRemote ? (
							<>
								<div className={styles.conflictSnapshot}>
									<div>
										<strong>Versão atual no servidor · revision {revision}</strong>
										<span>
											{editor.conflictRemote.speaker} · {statusLabels[editor.conflictRemote.reviewStatus]}
										</span>
									</div>
									<p>{editor.conflictRemote.text}</p>
								</div>
								<div className={styles.conflictActions}>
									<Button
										onClick={() => {
											setReconciliationError(null);
											setEditor((current) => reapplyTranscriptConflictDraft(current));
										}}
										variant="primary"
									>
										Reaplicar meu rascunho
									</Button>
									<Button
										onClick={() => {
											if (
												!window.confirm(
													"Descartar seu rascunho local e usar a versão atual do servidor?",
												)
											) return;
											setReconciliationError(null);
											setEditor((current) => acceptTranscriptConflictRemote(current));
										}}
										variant="tertiary"
									>
										Descartar meu rascunho
									</Button>
								</div>
							</>
						) : (
							<Button
								disabled={reloadingCurrent}
								onClick={() => void loadCurrentVersion()}
								variant="primary"
							>
								{reloadingCurrent ? "Carregando versão atual…" : "Carregar versão atual"}
							</Button>
						)}
						{reconciliationError ? (
							<p className={styles.conflictError}>{reconciliationError}</p>
						) : null}
					</div>
				) : null}
			</div>

			<div className={styles.segmentSide}>
				<label className={styles.fieldLabel}>
					Revisão
					<select
						className={styles.control}
						disabled={!editable}
						onChange={(event) =>
							setEditor((current) =>
								editTranscriptDraft(current, {
									reviewStatus: event.target.value as TranscriptReviewStatus,
								}),
							)
						}
						value={draft.reviewStatus}
					>
						{Object.entries(statusLabels).map(([value, label]) => (
							<option key={value} value={value}>{label}</option>
						))}
					</select>
				</label>
				{editable ? (
					<Button
						disabled={!dirty || editor.phase === "saving" || editor.phase === "conflict"}
						onClick={() => void save()}
						variant="primary"
					>
						{editor.phase === "saving"
							? "Salvando…"
							: editor.phase === "error"
								? "Tentar novamente"
								: "Salvar fala"}
					</Button>
				) : null}
				<span className={styles.keyboardHint}>
					{editable
						? "↑/↓ navega · Enter texto · S speaker · Shift+Enter revisar · ⌘/Ctrl+Enter salva · Esc desfaz"
						: "↑/↓ navega · esta conta tem acesso somente de leitura"}
				</span>
			</div>
		</article>
	);
}

export function TranscriptEditor({ sessionId, segments, batchOffset, editable }: TranscriptEditorProps) {
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
	const visible = useMemo(() => {
		if (!normalizedQuery) return segments;
		return segments.filter((segment) =>
			`${segment.speaker} ${segment.text}`
				.toLocaleLowerCase("pt-BR")
				.includes(normalizedQuery),
		);
	}, [normalizedQuery, segments]);

	return (
		<>
			<div className={styles.toolbar}>
				<input
					aria-label="Filtrar falas deste lote"
					className={styles.search}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Filtrar speaker ou texto neste lote…"
					value={query}
				/>
				<span className={styles.muted}>{visible.length} de {segments.length} falas neste lote</span>
			</div>
			<div className={styles.segmentList}>
				{visible.length ? visible.map((segment) => {
					const originalIndex = segments.findIndex((item) => item.id === segment.id);
					return (
						<SegmentEditor
							editable={editable}
							key={segment.id}
							position={batchOffset + originalIndex + 1}
							segment={segment}
							sessionId={sessionId}
						/>
					);
				}) : <div className={styles.empty}>Nenhuma fala corresponde ao filtro.</div>}
			</div>
		</>
	);
}
