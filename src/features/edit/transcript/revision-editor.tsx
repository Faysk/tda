"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { saveTranscriptRevisionEditsAction } from "./revision-edit-actions";
import {
	prepareTranscriptRevisionEdits,
	toRevisionEdit,
	type TranscriptRevisionEdit,
} from "./revision-edit-contract";
import {
	formatTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import { TranscriptReader } from "./reader";
import styles from "./revision-editor.module.css";

const EDIT_VISIBLE_STEP = 300;

type Draft = Readonly<{ speaker: string; text: string }>;

type WorkspaceProps = Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	editable: boolean;
	sessionId: string;
	revisionId: string | null;
}>;

function normalizedDraft(draft: Draft): Draft {
	return { speaker: draft.speaker.trim(), text: draft.text.trim() };
}

function ActiveSegmentFields({
	segment,
	value,
	disabled,
	onCommit,
	onSave,
}: Readonly<{
	segment: TranscriptReaderSegment;
	value: Draft;
	disabled: boolean;
	onCommit: (draft: Draft) => void;
	onSave: (draft: Draft) => void;
}>) {
	const [speaker, setSpeaker] = useState(value.speaker);
	const [text, setText] = useState(value.text);

	useEffect(() => {
		setSpeaker(value.speaker);
		setText(value.text);
	}, [segment.id, value.speaker, value.text]);

	function draft(): Draft {
		return { speaker, text };
	}

	return (
		<div className={styles.activeFields}>
			<label>
				<span>Speaker</span>
				<input
					autoFocus
					disabled={disabled}
					maxLength={160}
					onBlur={() => onCommit(draft())}
					onChange={(event) => setSpeaker(event.currentTarget.value)}
					value={speaker}
				/>
			</label>
			<label>
				<span>Texto</span>
				<textarea
					disabled={disabled}
					maxLength={100_000}
					onBlur={() => onCommit(draft())}
					onChange={(event) => setText(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (
							(event.ctrlKey || event.metaKey) &&
							event.key.toLocaleLowerCase("pt-BR") === "s"
						) {
							event.preventDefault();
							onSave(draft());
						}
					}}
					rows={4}
					value={text}
				/>
			</label>
		</div>
	);
}

function issueMessage(reason: string): string {
	switch (reason) {
		case "validation":
			return "Alguma alteração não atende ao contrato. Confira speaker e texto antes de salvar.";
		case "not_found":
			return "A sessão ou a revisão atual não está mais disponível.";
		case "forbidden":
			return "Seu acesso de edição mudou. O rascunho continua nesta aba.";
		case "unauthenticated":
			return "Sua sessão expirou. O rascunho continua nesta aba.";
		default:
			return "Não foi possível confirmar o save. Seu rascunho foi preservado para tentar novamente.";
	}
}

export function TranscriptRevisionWorkspace({
	segments,
	sourceLabel,
	downloadHref,
	editable,
	sessionId,
	revisionId,
}: WorkspaceProps) {
	const router = useRouter();
	const [editing, setEditing] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [edits, setEdits] = useState<Record<string, Draft>>({});
	const [query, setQuery] = useState("");
	const [visibleCount, setVisibleCount] = useState(EDIT_VISIBLE_STEP);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [conflict, setConflict] = useState(false);
	const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);

	const canEditRevision = editable && Boolean(revisionId);
	const dirtyCount = Object.keys(edits).length;
	const dirty = dirtyCount > 0;

	const segmentById = useMemo(
		() => new Map(segments.map((segment) => [segment.id, segment])),
		[segments],
	);

	const working = useMemo(
		() =>
			segments.map((segment) => {
				const edit = edits[segment.id];
				return edit ? { ...segment, ...edit } : segment;
			}),
		[edits, segments],
	);

	const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
	const filtered = useMemo(() => {
		if (!normalizedQuery) return working;
		return working.filter((segment) =>
			`${segment.speaker} ${segment.text}`
				.toLocaleLowerCase("pt-BR")
				.includes(normalizedQuery),
		);
	}, [normalizedQuery, working]);
	const visible = filtered.slice(0, visibleCount);

	useEffect(() => {
		setVisibleCount(EDIT_VISIBLE_STEP);
	}, [normalizedQuery]);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		const anchorGuard = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest<HTMLAnchorElement>("a[href]");
			if (!anchor || anchor.target === "_blank") return;
			if (
				!window.confirm(
					"Há alterações não salvas na transcrição. Sair desta página e descartá-las?",
				)
			) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("click", anchorGuard, true);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("click", anchorGuard, true);
		};
	}, [dirty]);

	function commitEdit(segment: TranscriptReaderSegment, next: Draft) {
		const normalized = normalizedDraft(next);
		setEdits((current) => {
			const copy = { ...current };
			if (
				normalized.speaker === segment.speaker &&
				normalized.text === segment.text
			) {
				delete copy[segment.id];
			} else {
				copy[segment.id] = normalized;
			}
			return copy;
		});
		setPendingOperationId(null);
		setConflict(false);
		setMessage(null);
	}

	function discardAll() {
		setEdits({});
		setActiveId(null);
		setPendingOperationId(null);
		setConflict(false);
		setMessage(null);
	}

	function buildPayload(
		override?: Readonly<{ segment: TranscriptReaderSegment; draft: Draft }>,
	): readonly TranscriptRevisionEdit[] | null {
		const effective = { ...edits };
		if (override) {
			const normalized = normalizedDraft(override.draft);
			if (
				normalized.speaker === override.segment.speaker &&
				normalized.text === override.segment.text
			) {
				delete effective[override.segment.id];
			} else {
				effective[override.segment.id] = normalized;
			}
		}

		const payload: TranscriptRevisionEdit[] = [];
		for (const [id, draft] of Object.entries(effective)) {
			const segment = segmentById.get(id);
			if (!segment) return null;
			const edit = toRevisionEdit(segment, draft.speaker, draft.text);
			if (!edit) return null;
			payload.push(edit);
		}
		const prepared = prepareTranscriptRevisionEdits(payload);
		return prepared.ok ? prepared.value : null;
	}

	async function save(
		override?: Readonly<{ segment: TranscriptReaderSegment; draft: Draft }>,
	) {
		if (!canEditRevision || !revisionId || saving || conflict) return;
		const payload = buildPayload(override);
		if (!payload) {
			setMessage("Há uma alteração inválida. Revise speaker e texto.");
			return;
		}
		if (!payload.length) {
			discardAll();
			setEditing(false);
			setMessage("Nenhuma alteração para salvar.");
			return;
		}

		const operationId = pendingOperationId ?? crypto.randomUUID();
		setPendingOperationId(operationId);
		setSaving(true);
		setMessage(null);
		const result = await saveTranscriptRevisionEditsAction({
			sessionId,
			expectedCurrentRevisionId: revisionId,
			operationId,
			edits: payload,
		});
		setSaving(false);

		if (!result.ok) {
			if (result.reason === "conflict") {
				setConflict(true);
				setPendingOperationId(null);
				setMessage(
					"Existe uma revisão mais nova. Seu rascunho foi mantido nesta aba; nenhum retry automático foi feito.",
				);
				return;
			}
			if (result.reason === "validation" || result.reason === "not_found") {
				setPendingOperationId(null);
			}
			setMessage(issueMessage(result.reason));
			return;
		}

		discardAll();
		setEditing(false);
		setMessage(
			result.status === "replay"
				? `Save confirmado por replay · revisão r${result.revisionNumber}.`
				: result.status === "unchanged"
					? "Nenhuma mudança material; a revisão atual foi preservada."
					: `Transcrição salva como revisão privada r${result.revisionNumber}.`,
		);
		router.refresh();
	}

	function leaveEditMode() {
		if (
			dirty &&
			!window.confirm("Descartar as alterações não salvas e sair do modo de edição?")
		)
			return;
		discardAll();
		setEditing(false);
	}

	if (!editing) {
		return (
			<div className={styles.workspace}>
				{canEditRevision ? (
					<div className={styles.readActions}>
						<div>
							<strong>Correções da transcrição</strong>
							<span>
								Speaker e texto geram uma nova revisão privada. Timestamps ficam
								bloqueados.
							</span>
						</div>
						<Button onClick={() => setEditing(true)} variant="secondary">
							Editar transcrição
						</Button>
					</div>
				) : null}
				{message ? (
					<p className={styles.notice} role="status">
						{message}
					</p>
				) : null}
				<TranscriptReader
					downloadHref={downloadHref}
					segments={segments}
					sourceLabel={sourceLabel}
				/>
			</div>
		);
	}

	return (
		<div className={styles.workspace}>
			<div className={styles.editToolbar}>
				<div className={styles.mode}>
					<strong>Modo de edição</strong>
					<span>{sourceLabel}</span>
					<span>
						{dirtyCount
							? `${dirtyCount.toLocaleString("pt-BR")} fala(s) alterada(s)`
							: "Nenhuma alteração não salva"}
					</span>
				</div>
				<label className={styles.search}>
					<span>Buscar na working copy</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Speaker ou texto"
					/>
				</label>
				<div className={styles.actions}>
					<Button
						disabled={!dirty || saving || conflict}
						onClick={() => void save()}
						variant="primary"
					>
						{saving ? "Salvando…" : "Salvar alterações da transcrição"}
					</Button>
					<Button
						disabled={!dirty || saving}
						onClick={() => {
							if (
								!dirty ||
								window.confirm("Descartar todas as alterações não salvas?")
							)
								discardAll();
						}}
						variant="tertiary"
					>
						Descartar alterações
					</Button>
					<Button disabled={saving} onClick={leaveEditMode} variant="tertiary">
						Sair do modo de edição
					</Button>
				</div>
			</div>

			{message ? (
				<div
					className={conflict ? styles.conflict : styles.notice}
					role={conflict ? "alert" : "status"}
				>
					<p>{message}</p>
					{conflict ? (
						<div className={styles.conflictActions}>
							<span>
								Continue nesta aba para copiar/comparar seu rascunho. Recarregar
								é sempre explícito.
							</span>
							<Button
								onClick={() => {
									if (
										!window.confirm(
											"Descartar o rascunho local e carregar a revisão mais recente?",
										)
									)
										return;
									discardAll();
									setEditing(false);
									router.refresh();
								}}
								variant="tertiary"
							>
								Descartar e carregar revisão atual
							</Button>
						</div>
					) : null}
				</div>
			) : null}

			<div className={styles.resultLine} aria-live="polite">
				{normalizedQuery
					? `${filtered.length.toLocaleString("pt-BR")} resultado(s) na working copy`
					: `${segments.length.toLocaleString("pt-BR")} fala(s) · timestamps somente leitura`}
			</div>

			<section className={styles.timeline} aria-label="Edição privada da transcrição">
				{visible.map((segment) => {
					const original = segmentById.get(segment.id) ?? segment;
					const changed = Boolean(edits[segment.id]);
					const active = activeId === segment.id;
					return (
						<article
							className={styles.segment}
							data-changed={changed ? "true" : "false"}
							key={segment.id}
							onKeyDown={(event) => {
								if (
									event.key === "Enter" &&
									!(event.target instanceof HTMLInputElement) &&
									!(event.target instanceof HTMLTextAreaElement)
								) {
									event.preventDefault();
									setActiveId(segment.id);
								}
							}}
							tabIndex={0}
						>
							<span
								className={styles.timestamp}
								title={formatTranscriptTimestamp(segment.startMs)}
							>
								{formatTranscriptTimestamp(segment.startMs, false)}
							</span>
							<div className={styles.content}>
								{active ? (
									<ActiveSegmentFields
										disabled={saving}
										onCommit={(draft) => commitEdit(original, draft)}
										onSave={(draft) =>
											void save({ segment: original, draft })
										}
										segment={original}
										value={{
											speaker: segment.speaker,
											text: segment.text,
										}}
									/>
								) : (
									<>
										<strong>{segment.speaker}</strong>
										<p>{segment.text}</p>
									</>
								)}
							</div>
							<div className={styles.segmentActions}>
								{changed ? <span className={styles.changed}>Editada</span> : null}
								<Button
									disabled={saving}
									onClick={() =>
										setActiveId(active ? null : segment.id)
									}
									size="sm"
									variant="tertiary"
								>
									{active ? "Fechar fala" : "Editar fala"}
								</Button>
								{changed ? (
									<Button
										disabled={saving}
										onClick={() => {
											setEdits((current) => {
												const copy = { ...current };
												delete copy[segment.id];
												return copy;
											});
											setPendingOperationId(null);
											setConflict(false);
											setMessage(null);
										}}
										size="sm"
										variant="tertiary"
									>
										Reverter fala
									</Button>
								) : null}
							</div>
						</article>
					);
				})}
				{!visible.length ? (
					<p className={styles.empty}>Nenhuma fala corresponde à busca.</p>
				) : null}
			</section>
			{visibleCount < filtered.length ? (
				<div className={styles.loadMore}>
					<Button
						onClick={() =>
							setVisibleCount((current) =>
								Math.min(filtered.length, current + EDIT_VISIBLE_STEP),
							)
						}
						variant="tertiary"
					>
						Carregar mais falas
					</Button>
				</div>
			) : null}
		</div>
	);
}
