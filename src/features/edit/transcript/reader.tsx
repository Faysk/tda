"use client";

import { useRouter } from "next/navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui";
import { saveTranscriptRevisionEditAction } from "./revision-edit-actions";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;

type WorkingChange = Readonly<{
	speaker: string;
	text: string;
}>;

type SavePhase = "idle" | "saving" | "saved" | "error" | "conflict";

function normalizeSearch(value: string): string {
	return value.trim().toLocaleLowerCase("pt-BR");
}

function highlighted(text: string, query: string) {
	if (!query) return text;
	const lower = text.toLocaleLowerCase("pt-BR");
	const index = lower.indexOf(query);
	if (index < 0) return text;
	return (
		<>
			{text.slice(0, index)}
			<mark>{text.slice(index, index + query.length)}</mark>
			{text.slice(index + query.length)}
		</>
	);
}

function canonicalChange(change: WorkingChange): WorkingChange {
	return {
		speaker: change.speaker.trim(),
		text: change.text.trim(),
	};
}

function ActiveSegmentEditor({
	segment,
	onApply,
	onCancel,
	onSave,
}: Readonly<{
	segment: TranscriptReaderSegment & WorkingChange;
	onApply: (change: WorkingChange) => void;
	onCancel: () => void;
	onSave: (change: WorkingChange) => void;
}>) {
	const [speaker, setSpeaker] = useState(segment.speaker);
	const [text, setText] = useState(segment.text);
	const speakerRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		speakerRef.current?.focus();
	}, []);

	const draft = { speaker, text };
	const valid = Boolean(speaker.trim() && text.trim());

	return (
		<div
			aria-label="Editar fala da transcrição"
			className={styles.inlineEditor}
			role="group"
			onKeyDown={(event) => {
				if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("en") === "s") {
					event.preventDefault();
					if (valid) onSave(draft);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
				}
			}}
		>
			<label>
				<span>Speaker</span>
				<input
					ref={speakerRef}
					maxLength={160}
					value={speaker}
					onChange={(event) => setSpeaker(event.currentTarget.value)}
				/>
			</label>
			<label>
				<span>Texto</span>
				<textarea
					maxLength={100_000}
					rows={4}
					value={text}
					onChange={(event) => setText(event.currentTarget.value)}
				/>
			</label>
			<div className={styles.inlineEditorActions}>
				<Button size="sm" variant="primary" disabled={!valid} onClick={() => onApply(draft)}>
					Concluir fala
				</Button>
				<Button size="sm" variant="tertiary" onClick={onCancel}>
					Cancelar
				</Button>
				<span>⌘/Ctrl+S conclui e salva · Esc cancela</span>
			</div>
		</div>
	);
}

export function TranscriptReader({
	segments,
	sourceLabel,
	downloadHref,
	sessionId,
	revisionId,
	revisionNumber,
	editable = false,
}: Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	sessionId?: string;
	revisionId?: string | null;
	revisionNumber?: number | null;
	editable?: boolean;
}>) {
	const router = useRouter();
	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const [editMode, setEditMode] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [working, setWorking] = useState<Record<string, WorkingChange>>({});
	const [committed, setCommitted] = useState<Record<string, WorkingChange>>({});
	const [currentRevisionId, setCurrentRevisionId] = useState(revisionId ?? null);
	const [currentRevisionNumber, setCurrentRevisionNumber] = useState(
		revisionNumber ?? null,
	);
	const [savePhase, setSavePhase] = useState<SavePhase>("idle");
	const [saveMessage, setSaveMessage] = useState<string | null>(null);
	const [conflictCurrentRevisionId, setConflictCurrentRevisionId] = useState<
		string | null
	>(null);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);
	const canEdit = Boolean(editable && sessionId && currentRevisionId);
	const dirtyCount = Object.keys(working).length;
	const hasUnsavedWork = dirtyCount > 0 || editingId !== null;
	const normalizedQuery = normalizeSearch(query);

	const effectiveSegment = useCallback(
		(segment: TranscriptReaderSegment): TranscriptReaderSegment & WorkingChange => {
			const overlay = working[segment.id] ?? committed[segment.id];
			return overlay ? { ...segment, ...overlay } : segment;
		},
		[committed, working],
	);

	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < segments.length; index += 1) {
			const segment = effectiveSegment(segments[index]);
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [effectiveSegment, normalizedQuery, segments]);

	function revealAndScroll(index: number) {
		if (index < 0) return;
		setVisibleCount((current) =>
			Math.max(current, Math.min(segments.length, index + 30)),
		);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				segmentRefs.current.get(index)?.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			});
		});
	}

	function moveMatch(delta: number) {
		if (!matches.length) return;
		const next = (matchCursor + delta + matches.length) % matches.length;
		setMatchCursor(next);
		revealAndScroll(matches[next]);
	}

	function jump() {
		const milliseconds = parseTranscriptTimestamp(jumpValue);
		if (milliseconds === null) return;
		revealAndScroll(findTranscriptJumpIndex(segments, milliseconds));
	}

	async function copyReference(index: number) {
		const segment = effectiveSegment(segments[index]);
		const reference = `${formatTranscriptTimestamp(segment.startMs)} · ${segment.speaker}`;
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
	}

	const workingWithDraft = useCallback(
		(segment: TranscriptReaderSegment, draft: WorkingChange) => {
			const canonical = canonicalChange(draft);
			const baseline = committed[segment.id] ?? {
				speaker: segment.speaker,
				text: segment.text,
			};
			const next = { ...working };
			if (
				canonical.speaker === baseline.speaker &&
				canonical.text === baseline.text
			) {
				delete next[segment.id];
			} else {
				next[segment.id] = canonical;
			}
			return next;
		},
		[committed, working],
	);

	const saveChanges = useCallback(
		async (changesBySegment: Record<string, WorkingChange>) => {
			if (
				!canEdit ||
				!sessionId ||
				!currentRevisionId ||
				savePhase === "saving" ||
				savePhase === "conflict"
			)
				return;
			const changes = Object.entries(changesBySegment).map(
				([segmentKey, change]) => ({
					segmentKey,
					speaker: change.speaker,
					text: change.text,
				}),
			);
			if (!changes.length) return;

			setSavePhase("saving");
			setSaveMessage(null);
			try {
				const result = await saveTranscriptRevisionEditAction({
					sessionId,
					expectedCurrentTranscriptRevisionId: currentRevisionId,
					operationId: crypto.randomUUID(),
					changes,
				});
				if (!result.ok) {
					if (result.reason === "stale_current") {
						setSavePhase("conflict");
						setConflictCurrentRevisionId(result.currentRevisionId ?? null);
						setSaveMessage(
							"Existe uma revisão mais nova. Sua working copy continua nesta aba e não foi sobrescrita.",
						);
						return;
					}
					setSavePhase("error");
					setSaveMessage(
						result.reason === "forbidden"
							? "Sua conta não pode editar esta transcrição."
							: result.reason === "validation"
								? "Há uma alteração inválida. Revise speaker e texto."
								: "Não foi possível salvar a nova revisão. Sua working copy foi preservada.",
					);
					return;
				}

				setCommitted((current) => ({ ...current, ...changesBySegment }));
				setWorking({});
				setCurrentRevisionId(result.revisionId);
				setCurrentRevisionNumber(result.revisionNumber);
				setSavePhase("saved");
				setSaveMessage(
					result.status === "no_change"
						? "Nenhuma diferença material para salvar."
						: `Revisão r${result.revisionNumber} salva. A revisão anterior continua no histórico.`,
				);
				setConflictCurrentRevisionId(null);
				router.refresh();
			} catch {
				setSavePhase("error");
				setSaveMessage(
					"Falha de conexão ao salvar. Sua working copy continua nesta aba.",
				);
			}
		},
		[canEdit, currentRevisionId, router, savePhase, sessionId],
	);

	function applyDraft(segment: TranscriptReaderSegment, draft: WorkingChange) {
		setWorking(workingWithDraft(segment, draft));
		setEditingId(null);
		setSavePhase("idle");
		setSaveMessage(null);
	}

	function applyAndSave(segment: TranscriptReaderSegment, draft: WorkingChange) {
		const next = workingWithDraft(segment, draft);
		setWorking(next);
		setEditingId(null);
		setSavePhase("idle");
		setSaveMessage(null);
		void saveChanges(next);
	}

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || visibleCount >= segments.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisibleCount((count) =>
					Math.min(segments.length, count + VISIBLE_STEP),
				);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [segments.length, visibleCount]);

	useEffect(() => {
		if (!hasUnsavedWork) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		const captureNavigation = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest<HTMLAnchorElement>("a[href]");
			if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download"))
				return;
			if (!window.confirm("Há alterações não salvas na transcrição. Sair mesmo assim?")) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("click", captureNavigation, true);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("click", captureNavigation, true);
		};
	}, [hasUnsavedWork]);

	useEffect(() => {
		if (!editMode || editingId) return;
		const shortcut = (event: KeyboardEvent) => {
			if (
				(event.ctrlKey || event.metaKey) &&
				event.key.toLocaleLowerCase("en") === "s"
			) {
				event.preventDefault();
				void saveChanges(working);
			}
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	}, [editMode, editingId, saveChanges, working]);

	const visible = segments.slice(0, visibleCount);

	return (
		<div className={styles.reader}>
			<div className={styles.toolbar}>
				<div className={styles.source}>
					<strong>Fonte da leitura</strong>
					<span>
						{currentRevisionNumber
							? `Revisão privada atual · r${currentRevisionNumber}`
							: sourceLabel}
					</span>
				</div>
				<label className={styles.search}>
					<span>Buscar fala ou speaker</span>
					<input
						type="search"
						value={query}
						onChange={(event) => {
							setQuery(event.currentTarget.value);
							setMatchCursor(-1);
						}}
						placeholder="Ex.: Alya ou floresta"
					/>
				</label>
				<div className={styles.searchNav} aria-live="polite">
					<span>
						{normalizedQuery
							? `${matches.length.toLocaleString("pt-BR")} resultado(s)`
							: "Busca em toda a sessão"}
					</span>
					<Button
						size="sm"
						variant="tertiary"
						disabled={!matches.length}
						onClick={() => moveMatch(-1)}
					>
						Anterior
					</Button>
					<Button
						size="sm"
						variant="tertiary"
						disabled={!matches.length}
						onClick={() => moveMatch(1)}
					>
						Próximo
					</Button>
				</div>
				<div className={styles.jump}>
					<label>
						<span>Ir para timestamp</span>
						<input
							value={jumpValue}
							onChange={(event) => setJumpValue(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") jump();
							}}
							placeholder="01:32:10"
							inputMode="numeric"
						/>
					</label>
					<Button size="sm" onClick={jump}>
						Ir
					</Button>
				</div>
				<a className={styles.download} href={downloadHref}>
					Baixar transcrição (.md)
				</a>
			</div>

			{canEdit ? (
				<div className={styles.editorBar}>
					<div>
						<strong>{editMode ? "Modo de edição" : "Transcrição em leitura"}</strong>
						<span>
							{editMode
								? `${dirtyCount} fala(s) alterada(s) · timestamps permanecem somente leitura`
								: "Editar cria uma nova revisão privada; a revisão atual nunca é sobrescrita."}
						</span>
					</div>
					<div className={styles.editorBarActions}>
						{editMode ? (
							<>
								<Button
									size="sm"
									variant="primary"
									disabled={
										dirtyCount === 0 ||
										editingId !== null ||
										savePhase === "saving" ||
										savePhase === "conflict"
									}
									onClick={() => void saveChanges(working)}
								>
									{savePhase === "saving" ? "Salvando…" : "Salvar nova revisão"}
								</Button>
								<Button
									size="sm"
									variant="tertiary"
									disabled={
										dirtyCount === 0 || editingId !== null || savePhase === "saving"
									}
									onClick={() => {
										if (
											!window.confirm(
												"Descartar todas as alterações não salvas desta working copy?",
											)
										)
											return;
										setWorking({});
										setSavePhase("idle");
										setSaveMessage(null);
									}}
								>
									Descartar alterações
								</Button>
								<Button
									size="sm"
									variant="tertiary"
									disabled={savePhase === "saving"}
									onClick={() => {
										if (
											hasUnsavedWork &&
											!window.confirm(
												"Sair e descartar as alterações não salvas desta working copy?",
											)
										)
											return;
										setWorking({});
										setEditingId(null);
										setEditMode(false);
										setSavePhase("idle");
										setSaveMessage(null);
									}}
								>
									Sair da edição
								</Button>
							</>
						) : (
							<Button
								size="sm"
								variant="primary"
								onClick={() => {
									setEditMode(true);
									setSavePhase("idle");
									setSaveMessage(null);
								}}
							>
								Editar transcrição
							</Button>
						)}
					</div>
				</div>
			) : null}

			{saveMessage ? (
				<div
					className={styles.saveNotice}
					data-state={savePhase}
					role={savePhase === "error" || savePhase === "conflict" ? "alert" : "status"}
				>
					<span>{saveMessage}</span>
					{savePhase === "conflict" ? (
						<div className={styles.conflictActions}>
							<Button
								size="sm"
								variant="tertiary"
								onClick={() =>
									window.open(window.location.href, "_blank", "noopener,noreferrer")
								}
							>
								Abrir versão atual em nova aba
							</Button>
							<Button
								size="sm"
								variant="tertiary"
								onClick={() => {
									if (
										!window.confirm(
											"Recarregar a versão atual e descartar a working copy desta aba?",
										)
									)
										return;
									window.location.reload();
								}}
							>
								Recarregar e descartar
							</Button>
							{conflictCurrentRevisionId ? (
								<code title={conflictCurrentRevisionId}>
									current {conflictCurrentRevisionId.slice(0, 8)}…
								</code>
							) : null}
						</div>
					) : null}
				</div>
			) : null}

			<section className={styles.timeline} aria-label="Transcrição completa">
				{visible.map((baseSegment, index) => {
					const segment = effectiveSegment(baseSegment);
					const changed = Boolean(working[baseSegment.id]);
					const editing = editingId === baseSegment.id;
					return (
						<article
							id={`segment-${encodeURIComponent(baseSegment.id)}`}
							className={styles.segment}
							key={baseSegment.id}
							ref={(node) => {
								if (node) segmentRefs.current.set(index, node);
								else segmentRefs.current.delete(index);
							}}
							data-dirty={changed ? "true" : "false"}
							data-transcript-segment
						>
							<button
								type="button"
								className={styles.timestamp}
								title={`Copiar referência deste timestamp · ${formatTranscriptTimestamp(
									baseSegment.startMs,
								)} → ${formatTranscriptTimestamp(baseSegment.endMs)}`}
								onClick={() => void copyReference(index)}
							>
								{formatTranscriptTimestamp(baseSegment.startMs, false)}
							</button>
							<div className={styles.speakerCell}>
								<strong className={styles.speaker}>
									{highlighted(segment.speaker, normalizedQuery)}
								</strong>
								{editMode && !editing ? (
									<div className={styles.segmentActions}>
										<Button
											size="sm"
											variant="tertiary"
											disabled={
												Boolean(editingId) ||
												savePhase === "saving" ||
												savePhase === "conflict"
											}
											onClick={() => setEditingId(baseSegment.id)}
										>
											Editar fala
										</Button>
										{changed ? (
											<>
												<span className={styles.editedBadge}>Editada</span>
												<Button
													size="sm"
													variant="tertiary"
													onClick={() => {
														setWorking((current) => {
															const next = { ...current };
															delete next[baseSegment.id];
															return next;
														});
														setSavePhase("idle");
														setSaveMessage(null);
													}}
												>
													Reverter fala
												</Button>
											</>
										) : null}
									</div>
								) : null}
							</div>
							{editing ? (
								<ActiveSegmentEditor
									segment={{ ...baseSegment, ...segment }}
									onApply={(draft) => applyDraft(baseSegment, draft)}
									onCancel={() => setEditingId(null)}
									onSave={(draft) => applyAndSave(baseSegment, draft)}
								/>
							) : (
								<p className={styles.text}>
									{highlighted(segment.text, normalizedQuery)}
								</p>
							)}
						</article>
					);
				})}
				{visibleCount < segments.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!segments.length ? (
					<p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p>
				) : null}
			</section>
		</div>
	);
}
