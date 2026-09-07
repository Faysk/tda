"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { updateTranscriptSegmentAction } from "./actions";
import styles from "../workbench.module.css";

type Segment = Readonly<{
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	speaker: string;
	reviewStatus: "pending" | "approved" | "needs_review" | "discarded";
}>;

type TranscriptEditorProps = Readonly<{
	sessionId: string;
	segments: readonly Segment[];
	batchOffset: number;
}>;

type SaveState = "idle" | "saving" | "saved" | "error";

const statusLabels = {
	pending: "Pendente",
	approved: "Aprovado",
	needs_review: "Revisar",
	discarded: "Descartado",
} as const;

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
	if (issues.includes("segment_not_found")) return "A fala não foi encontrada nesta sessão.";
	return "Não foi possível salvar esta fala.";
}

function SegmentEditor({
	segment: initial,
	sessionId,
	position,
}: Readonly<{
	segment: Segment;
	sessionId: string;
	position: number;
}>) {
	const [saved, setSaved] = useState(initial);
	const [text, setText] = useState(initial.text);
	const [speaker, setSpeaker] = useState(initial.speaker);
	const [reviewStatus, setReviewStatus] = useState(initial.reviewStatus);
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [errorMessage, setErrorMessage] = useState("");
	const dirty =
		text !== saved.text ||
		speaker !== saved.speaker ||
		reviewStatus !== saved.reviewStatus;

	async function save() {
		if (!dirty || saveState === "saving") return;
		setSaveState("saving");
		setErrorMessage("");
		const result = await updateTranscriptSegmentAction({
			sessionId,
			segmentId: saved.id,
			text,
			speaker,
			reviewStatus,
		});
		if (!result.ok) {
			setSaveState("error");
			setErrorMessage(issueMessage(result.issues));
			return;
		}
		const next: Segment = {
			...saved,
			text: result.segment.text,
			speaker: result.segment.speaker,
			reviewStatus: result.segment.reviewStatus,
		};
		setSaved(next);
		setText(next.text);
		setSpeaker(next.speaker);
		setReviewStatus(next.reviewStatus);
		setSaveState("saved");
	}

	const visibleState = saveState === "saving"
		? "saving"
		: saveState === "error"
			? "error"
			: dirty
				? "dirty"
				: saveState === "saved"
					? "saved"
					: "idle";
	const stateLabel = {
		idle: "Sem alterações",
		dirty: "Alterado",
		saving: "Salvando…",
		saved: "Salvo ✓",
		error: "Erro ao salvar",
	}[visibleState];

	return (
		<article
			className={styles.segment}
			data-dirty={dirty ? "true" : "false"}
			data-error={saveState === "error" ? "true" : "false"}
		>
			<div className={styles.segmentSide}>
				<div>
					<div className={styles.segmentNumber}>Fala {position}</div>
					<div className={styles.segmentTime}>
						{formatTimestamp(saved.startMs)} → {formatTimestamp(saved.endMs)}
					</div>
				</div>
				<label className={styles.fieldLabel}>
					Speaker
					<input
						className={styles.control}
						maxLength={160}
						onChange={(event) => {
							setSpeaker(event.target.value);
							setSaveState("idle");
						}}
						value={speaker}
					/>
				</label>
			</div>

			<div className={styles.segmentMain}>
				<label className={styles.fieldLabel}>
					Texto
					<textarea
						className={styles.textarea}
						maxLength={10_000}
						onChange={(event) => {
							setText(event.target.value);
							setSaveState("idle");
						}}
						onKeyDown={(event) => {
							if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
								event.preventDefault();
								void save();
							}
						}}
						value={text}
					/>
				</label>
				<div className={styles.segmentFooter}>
					<span>
						{text.trim() ? text.trim().split(/\s+/u).length : 0} palavras · {Array.from(text).length} caracteres
					</span>
					<span className={styles.saveState} data-state={visibleState} title={errorMessage || undefined}>
						{errorMessage || stateLabel}
					</span>
				</div>
			</div>

			<div className={styles.segmentSide}>
				<label className={styles.fieldLabel}>
					Revisão
					<select
						className={styles.control}
						onChange={(event) => {
							setReviewStatus(event.target.value as Segment["reviewStatus"]);
							setSaveState("idle");
						}}
						value={reviewStatus}
					>
						{Object.entries(statusLabels).map(([value, label]) => (
							<option key={value} value={value}>{label}</option>
						))}
					</select>
				</label>
				<Button disabled={!dirty || saveState === "saving"} onClick={() => void save()} variant="primary">
					{saveState === "saving" ? "Salvando…" : "Salvar fala"}
				</Button>
				<span className={styles.segmentNumber}>⌘/Ctrl + Enter salva</span>
			</div>
		</article>
	);
}

export function TranscriptEditor({ sessionId, segments, batchOffset }: TranscriptEditorProps) {
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
