"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { saveTranscriptRevisionEditsAction } from "./edit-actions";
import {
	type TranscriptEditRequest,
	validateTranscriptEditRequest,
} from "./edit-model";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import { wallClockPresentation } from "../../transcript-review/time-contract";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;
const SEARCH_VISIBLE_LIMIT = 240;

type WorkingEdit = Readonly<{
	speaker: string;
	text: string;
}>;

type SavePhase = "idle" | "saving" | "saved" | "conflict" | "error";

export type TranscriptReaderSaveAction = typeof saveTranscriptRevisionEditsAction;

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

function applyWorkingEdit(
	segment: TranscriptReaderSegment,
	edit: WorkingEdit | undefined,
): TranscriptReaderSegment {
	return edit ? { ...segment, speaker: edit.speaker, text: edit.text } : segment;
}

export function TranscriptReader({
	segments,
	sourceLabel,
	downloadHref,
	editable = false,
	sessionId = null,
	revisionId = null,
	revisionNumber = null,
	saveAction = saveTranscriptRevisionEditsAction,
	active = true,
}: Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	editable?: boolean;
	sessionId?: string | null;
	revisionId?: string | null;
	revisionNumber?: number | null;
	saveAction?: TranscriptReaderSaveAction;
	active?: boolean;
}>) {
	const router = useRouter();
	const [baseline, setBaseline] = useState<readonly TranscriptReaderSegment[]>(() => [
		...segments,
	]);
	const [working, setWorking] = useState<Record<string, WorkingEdit>>({});
	const [editMode, setEditMode] = useState(false);
	const [activeEditId, setActiveEditId] = useState<string | null>(null);
	const [currentRevisionId, setCurrentRevisionId] = useState(revisionId);
	const [currentRevisionNumber, setCurrentRevisionNumber] = useState(revisionNumber);
	const [localSourceLabel, setLocalSourceLabel] = useState(sourceLabel);
	const [savePhase, setSavePhase] = useState<SavePhase>("idle");
	const [saveMessage, setSaveMessage] = useState("");
	const [remoteRevisionNumber, setRemoteRevisionNumber] = useState<number | null>(null);
	const pendingOperation = useRef<{ id: string; signature: string } | null>(null);

	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);
	const activeSpeakerRef = useRef<HTMLInputElement>(null);
	const normalizedQuery = normalizeSearch(query);
	const dirtyCount = Object.keys(working).length;
	const dirty = dirtyCount > 0;
	const canEdit =
		editable &&
		Boolean(sessionId) &&
		Boolean(currentRevisionId) &&
		baseline.every((segment) => Boolean(segment.sourceSegmentId));

	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < baseline.length; index += 1) {
			const segment = applyWorkingEdit(baseline[index], working[baseline[index].id]);
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [baseline, normalizedQuery, working]);

	useEffect(() => {
		if (!normalizedQuery || !matches.length) return;
		const firstMatch = matches[0];
		setMatchCursor(0);
		const firstFrame = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				segmentRefs.current.get(firstMatch)?.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			});
		});
		return () => cancelAnimationFrame(firstFrame);
	}, [matches, normalizedQuery]);

	function revealAndScroll(index: number) {
		if (index < 0) return;
		if (!normalizedQuery) {
			setVisibleCount((current) =>
				Math.max(current, Math.min(baseline.length, index + 30)),
			);
		}
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
		const index = findTranscriptJumpIndex(baseline, milliseconds);
		if (index < 0) return;
		if (normalizedQuery) {
			setQuery("");
			setMatchCursor(-1);
		}
		setVisibleCount((current) =>
			Math.max(current, Math.min(baseline.length, index + 30)),
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

	async function copyReference(index: number) {
		const baseSegment = baseline[index];
		const segment = applyWorkingEdit(baseSegment, working[baseSegment.id]);
		const wall = baseSegment.absoluteTime
			? wallClockPresentation(baseSegment.absoluteTime.startIso)
			: null;
		const reference = [
			formatTranscriptTimestamp(baseSegment.startMs),
			wall ? `${wall.date} ${wall.clock} ${wall.offset === "Z" ? "UTC" : wall.offset}` : null,
			segment.speaker,
		]
			.filter(Boolean)
			.join(" · ");
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
	}

	function updateWorking(
		segment: TranscriptReaderSegment,
		patch: Partial<WorkingEdit>,
	) {
		if (savePhase === "saving") return;
		setWorking((current) => {
			const previous = current[segment.id] ?? {
				speaker: segment.speaker,
				text: segment.text,
			};
			const next = { ...previous, ...patch };
			const updated = { ...current };
			if (next.speaker === segment.speaker && next.text === segment.text)
				delete updated[segment.id];
			else updated[segment.id] = next;
			return updated;
		});
		setSavePhase("idle");
		setSaveMessage("");
	}

	function revertSegment(segmentId: string) {
		setWorking((current) => {
			const updated = { ...current };
			delete updated[segmentId];
			return updated;
		});
		if (activeEditId === segmentId) setActiveEditId(null);
		setSavePhase("idle");
		setSaveMessage("");
	}

	function discardAll() {
		if (dirty && !window.confirm("Descartar todas as alterações não salvas da transcrição?"))
			return;
		setWorking({});
		setActiveEditId(null);
		setSavePhase("idle");
		setSaveMessage("");
		pendingOperation.current = null;
	}

	function buildRequest(): TranscriptEditRequest | null {
		if (!sessionId || !currentRevisionId) return null;
		const edits = baseline.flatMap((segment) => {
			const edit = working[segment.id];
			if (!edit || !segment.sourceSegmentId) return [];
			return [
				{
					trackNumber: segment.trackNumber,
					segmentId: segment.sourceSegmentId,
					speaker: edit.speaker,
					text: edit.text,
				},
			];
		});
		if (!edits.length) return null;
		const signature = JSON.stringify(edits);
		if (!pendingOperation.current || pendingOperation.current.signature !== signature) {
			pendingOperation.current = {
				id: crypto.randomUUID(),
				signature,
			};
		}
		return {
			sessionId,
			expectedCurrentTranscriptRevisionId: currentRevisionId,
			operationId: pendingOperation.current.id,
			edits,
		};
	}

	async function save() {
		if (!canEdit || savePhase === "saving") return;
		const request = buildRequest();
		if (!request) return;
		const issues = validateTranscriptEditRequest(request);
		if (issues.length) {
			setSavePhase("error");
			setSaveMessage(
				"Revise speaker e texto: campos vazios, muito longos ou inválidos não podem ser salvos.",
			);
			return;
		}

		setSavePhase("saving");
		setSaveMessage("Salvando nova revisão privada…");
		try {
			const result = await saveAction(request);
			if (result.ok) {
				setBaseline((current) =>
					current.map((segment) =>
						applyWorkingEdit(segment, working[segment.id]),
					),
				);
				setWorking({});
				setActiveEditId(null);
				setCurrentRevisionId(result.revisionId);
				setCurrentRevisionNumber(result.revisionNumber);
				setLocalSourceLabel(
					`Revisão privada atual · r${result.revisionNumber}`,
				);
				setSavePhase("saved");
				setSaveMessage(
					result.status === "no_change"
						? "Nenhuma mudança efetiva para criar nova revisão."
						: `Revisão privada r${result.revisionNumber} salva.`,
				);
				setRemoteRevisionNumber(null);
				router.refresh();
				pendingOperation.current = null;
				return;
			}

			if (result.reason === "stale_current") {
				setSavePhase("conflict");
				setRemoteRevisionNumber(result.currentRevisionNumber ?? null);
				setSaveMessage(
					"Outra edição avançou a transcrição. Sua working copy foi preservada nesta aba; não houve retry automático.",
				);
				pendingOperation.current = null;
				return;
			}

			setSavePhase("error");
			setSaveMessage(
				result.reason === "forbidden" || result.reason === "profile_unresolved"
					? "Sua permissão de edição não está mais válida. Nada foi salvo."
					: result.reason === "invalid_edit_target"
						? "A revisão mudou ou uma fala não pertence mais à base atual. Nada foi salvo."
						: "Não foi possível salvar a transcrição. Sua working copy continua nesta aba.",
			);
			if (result.reason !== "dependency_unavailable")
				pendingOperation.current = null;
		} catch {
			setSavePhase("error");
			setSaveMessage(
				"Não foi possível confirmar o save. A working copy e a identidade da tentativa foram preservadas para retry.",
			);
		}
	}

	useEffect(() => {
		if (!activeEditId) return;
		activeSpeakerRef.current?.focus();
	}, [activeEditId]);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (normalizedQuery || !sentinel || visibleCount >= baseline.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisibleCount((count) =>
					Math.min(baseline.length, count + VISIBLE_STEP),
				);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [baseline.length, normalizedQuery, visibleCount]);

	useEffect(() => {
		const handleKeyboardShortcut = (event: KeyboardEvent) => {
			if (
				active &&
				editMode &&
				dirty &&
				(event.ctrlKey || event.metaKey) &&
				event.key.toLocaleLowerCase() === "s"
			) {
				event.preventDefault();
				void save();
			}
			if (event.key === "Escape" && activeEditId) setActiveEditId(null);
		};
		document.addEventListener("keydown", handleKeyboardShortcut);
		return () => document.removeEventListener("keydown", handleKeyboardShortcut);
	});

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		const protectInternalNavigation = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest("a");
			if (!anchor || anchor.dataset.transcriptSafeNavigation === "true") return;
			if (anchor.target === "_blank" || anchor.href === window.location.href) return;
			if (!window.confirm("Você tem alterações não salvas na transcrição. Sair mesmo assim?")) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("click", protectInternalNavigation, true);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("click", protectInternalNavigation, true);
		};
	}, [dirty]);

	const visibleEntries = useMemo(() => {
		if (!normalizedQuery) {
			return baseline
				.slice(0, visibleCount)
				.map((baseSegment, index) => ({ baseSegment, index }));
		}
		if (!matches.length) return [] as Array<{
			baseSegment: TranscriptReaderSegment;
			index: number;
		}>;
		const cursor = Math.max(0, Math.min(matchCursor, matches.length - 1));
		const anchorIndex = matches[cursor];
		const halfWindow = Math.floor(SEARCH_VISIBLE_LIMIT / 2);
		const start = Math.max(
			0,
			Math.min(
				anchorIndex - halfWindow,
				Math.max(0, baseline.length - SEARCH_VISIBLE_LIMIT),
			),
		);
		return baseline
			.slice(start, start + SEARCH_VISIBLE_LIMIT)
			.map((baseSegment, offset) => ({
				baseSegment,
				index: start + offset,
			}));
	}, [baseline, matchCursor, matches, normalizedQuery, visibleCount]);

	return (
		<section
			className={styles.reader}
			aria-label="Leitor e editor de transcrição"
		>
			<div className={styles.toolbar}>
				<div className={styles.source}>
					<strong>Fonte da leitura</strong>
					<span>{localSourceLabel}</span>
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
				<a
					className={styles.download}
					href={downloadHref}
					data-transcript-safe-navigation="true"
				>
					Baixar transcrição (.md)
				</a>

				{canEdit ? (
					<div className={styles.editControls}>
						<Button
							size="sm"
							variant={editMode ? "secondary" : "tertiary"}
							disabled={savePhase === "saving"}
							onClick={() => {
								setEditMode((current) => !current);
								setActiveEditId(null);
							}}
						>
							{editMode ? "Sair do modo de edição" : "Editar transcrição"}
						</Button>
						{editMode ? (
							<>
								<span className={styles.dirtyState} aria-live="polite">
									{dirtyCount
										? `${dirtyCount.toLocaleString("pt-BR")} alteração(ões) não salvas`
										: "Nenhuma alteração"}
								</span>
								<Button
									size="sm"
									disabled={!dirty || savePhase === "saving"}
									onClick={() => void save()}
								>
									{savePhase === "saving"
										? "Salvando…"
										: "Salvar alterações da transcrição"}
								</Button>
								<Button
									size="sm"
									variant="tertiary"
									disabled={!dirty || savePhase === "saving"}
									onClick={discardAll}
								>
									Descartar alterações
								</Button>
							</>
						) : null}
					</div>
				) : null}

				{saveMessage ? (
					<div
						className={styles.saveMessage}
						data-state={savePhase}
						role={savePhase === "error" || savePhase === "conflict" ? "alert" : "status"}
					>
						<span>{saveMessage}</span>
						{savePhase === "conflict" ? (
							<div className={styles.conflictActions}>
								{remoteRevisionNumber ? (
									<span>Remoto: r{remoteRevisionNumber}</span>
								) : null}
								<Button
									size="sm"
									variant="tertiary"
									onClick={() => {
										if (
											!dirty ||
											window.confirm(
												"Recarregar a revisão mais recente e descartar esta working copy?",
											)
										)
											window.location.reload();
									}}
								>
									Recarregar versão mais recente
								</Button>
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<section className={styles.timeline} aria-label="Transcrição completa">
				{visibleEntries.map(({ baseSegment, index }) => {
					const edit = working[baseSegment.id];
					const segment = applyWorkingEdit(baseSegment, edit);
					const isActive = editMode && activeEditId === baseSegment.id;
					const wallClock = baseSegment.absoluteTime
						? wallClockPresentation(baseSegment.absoluteTime.startIso)
						: null;
					return (
						<article
							id={`segment-${encodeURIComponent(baseSegment.id)}`}
							className={styles.segment}
							key={baseSegment.id}
							ref={(node) => {
								if (node) segmentRefs.current.set(index, node);
								else segmentRefs.current.delete(index);
							}}
							data-transcript-segment
							data-edited={edit ? "true" : undefined}
						>
							<button
								type="button"
								className={styles.timestamp}
								title="Copiar referência deste timestamp"
								onClick={() => void copyReference(index)}
							>
								<span className={styles.elapsedTime}>
									{formatTranscriptTimestamp(baseSegment.startMs, false)}
								</span>
								{wallClock && baseSegment.absoluteTime ? (
									<span className={styles.wallClock} title={wallClock.accessible}>
										{wallClock.clock}
										<small>{wallClock.date} · {wallClock.offset === "Z" ? "UTC" : wallClock.offset}</small>
									</span>
								) : null}
							</button>

							{isActive ? (
								<label className={styles.inlineField}>
									<span>Speaker</span>
									<input
										ref={activeSpeakerRef}
										disabled={savePhase === "saving"}
										value={segment.speaker}
										onChange={(event) =>
											updateWorking(baseSegment, {
												speaker: event.currentTarget.value,
											})
										}
									/>
								</label>
							) : (
								<strong className={styles.speaker}>
									{highlighted(segment.speaker, normalizedQuery)}
								</strong>
							)}

							{isActive ? (
								<div className={styles.inlineEditor}>
									<label className={styles.inlineField}>
										<span>Texto da fala</span>
										<textarea
											disabled={savePhase === "saving"}
											rows={4}
											value={segment.text}
											onChange={(event) =>
												updateWorking(baseSegment, {
													text: event.currentTarget.value,
												})
											}
										/>
									</label>
									<div className={styles.inlineActions}>
										<Button
											size="sm"
											variant="tertiary"
											disabled={savePhase === "saving"}
											onClick={() => setActiveEditId(null)}
										>
											Concluir edição da fala
										</Button>
										{edit ? (
											<Button
												size="sm"
												variant="tertiary"
												disabled={savePhase === "saving"}
												onClick={() => revertSegment(baseSegment.id)}
											>
												Reverter fala
											</Button>
										) : null}
									</div>
								</div>
							) : (
								<div className={styles.textBlock}>
									<p className={styles.text}>
										{highlighted(segment.text, normalizedQuery)}
									</p>
									<details className={styles.technical}>
										<summary>Detalhes técnicos</summary>
										<small>Track {baseSegment.trackNumber}</small>
										{baseSegment.sourceSegmentId ? <small>Segmento {baseSegment.sourceSegmentId}</small> : null}
										{baseSegment.absoluteTime ? <small>Relógio comprovado pela fonte {baseSegment.absoluteTime.source}</small> : <small>Relógio civil indisponível para esta fonte.</small>}
									</details>
								</div>
							)}

							{editMode && !isActive ? (
								<div className={styles.segmentActions}>
									{edit ? <span className={styles.editedBadge}>Editada</span> : null}
									<Button
										size="sm"
										variant="tertiary"
										disabled={savePhase === "saving"}
										onClick={() => setActiveEditId(baseSegment.id)}
									>
										Editar fala
									</Button>
									{edit ? (
										<Button
											size="sm"
											variant="tertiary"
											onClick={() => revertSegment(baseSegment.id)}
										>
											Reverter
										</Button>
									) : null}
								</div>
							) : null}
						</article>
					);
				})}
				{!normalizedQuery && visibleCount < baseline.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!baseline.length ? (
					<p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p>
				) : null}
			</section>

			{editMode && currentRevisionNumber ? (
				<p className={styles.editHint}>
					Modo de edição · base r{currentRevisionNumber}. Timestamps permanecem
					somente leitura. Ctrl/⌘+S salva a working copy inteira.
				</p>
			) : null}
		</section>
	);
}
