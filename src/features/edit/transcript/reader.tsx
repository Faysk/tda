"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { saveTranscriptRevisionEditsAction } from "./revision-edit-actions";
import {
	revisionSegmentId,
	type TranscriptRevisionEdit,
} from "./revision-edit-contract";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;

type LocalEdit = Readonly<{ speaker: string; text: string }>;

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

function effectiveValue(
	segment: TranscriptReaderSegment,
	edits: ReadonlyMap<string, LocalEdit>,
): LocalEdit {
	return edits.get(segment.id) ?? {
		speaker: segment.speaker,
		text: segment.text,
	};
}

export function TranscriptReader({
	segments,
	sourceLabel,
	downloadHref,
	editable = false,
	sessionId = null,
	revisionId = null,
}: Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	editable?: boolean;
	sessionId?: string | null;
	revisionId?: string | null;
}>) {
	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const [editing, setEditing] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [edits, setEdits] = useState<ReadonlyMap<string, LocalEdit>>(
		() => new Map(),
	);
	const [phase, setPhase] = useState<
		"idle" | "saving" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const operationIdRef = useRef<string | null>(null);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);
	const normalizedQuery = normalizeSearch(query);
	const segmentsById = useMemo(
		() => new Map(segments.map((segment) => [segment.id, segment])),
		[segments],
	);
	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index];
			const value = effectiveValue(segment, edits);
			if (
				value.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				value.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [edits, normalizedQuery, segments]);

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
		const segment = segments[index];
		const value = effectiveValue(segment, edits);
		const reference = `${formatTranscriptTimestamp(segment.startMs)} · ${value.speaker}`;
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
	}

	function updateSegment(
		segment: TranscriptReaderSegment,
		field: "speaker" | "text",
		value: string,
	) {
		operationIdRef.current = null;
		setPhase("idle");
		setMessage(null);
		setEdits((current) => {
			const next = new Map(current);
			const previous = effectiveValue(segment, current);
			const candidate = { ...previous, [field]: value };
			if (
				candidate.speaker === segment.speaker &&
				candidate.text === segment.text
			)
				next.delete(segment.id);
			else next.set(segment.id, candidate);
			return next;
		});
	}

	function revertSegment(segmentId: string) {
		operationIdRef.current = null;
		setEdits((current) => {
			const next = new Map(current);
			next.delete(segmentId);
			return next;
		});
		setPhase("idle");
		setMessage(null);
	}

	function resetWorkingCopy() {
		operationIdRef.current = null;
		setEdits(new Map());
		setActiveId(null);
		setPhase("idle");
		setMessage(null);
	}

	function discardAll() {
		if (
			edits.size > 0 &&
			!window.confirm("Descartar todas as alterações não salvas da transcrição?")
		)
			return;
		resetWorkingCopy();
	}

	function leaveEditMode() {
		if (
			edits.size > 0 &&
			!window.confirm("Sair do modo de edição e descartar as alterações não salvas?")
		)
			return;
		resetWorkingCopy();
		setEditing(false);
	}

	const saveWorkingCopy = useCallback(async () => {
		if (
			!editing ||
			phase === "saving" ||
			edits.size === 0 ||
			!sessionId ||
			!revisionId
		)
			return;

		const payload: TranscriptRevisionEdit[] = [];
		for (const [readerId, edit] of edits) {
			const segment = segmentsById.get(readerId);
			if (!segment) {
				setPhase("error");
				setMessage("A fala editada não pertence mais a esta revisão.");
				return;
			}
			const segmentId = revisionSegmentId(segment.trackNumber, segment.id);
			if (!segmentId) {
				setPhase("error");
				setMessage("A identidade de uma fala não pôde ser validada.");
				return;
			}
			payload.push({
				trackNumber: segment.trackNumber,
				segmentId,
				speaker: edit.speaker,
				text: edit.text,
			});
		}

		const operationId = operationIdRef.current ?? crypto.randomUUID();
		operationIdRef.current = operationId;
		setPhase("saving");
		setMessage(null);
		try {
			const result = await saveTranscriptRevisionEditsAction({
				sessionId,
				expectedCurrentRevisionId: revisionId,
				operationId,
				edits: payload,
			});
			if (result.ok) {
				operationIdRef.current = null;
				setEdits(new Map());
				setActiveId(null);
				setEditing(false);
				window.location.reload();
				return;
			}

			if (result.reason === "stale_current") {
				operationIdRef.current = null;
				setPhase("conflict");
				setMessage(
					"A transcrição ganhou uma revisão mais nova enquanto você editava. Sua working copy continua aqui; nada foi sobrescrito.",
				);
				return;
			}
			if (result.reason === "forbidden" || result.reason === "profile_unresolved") {
				operationIdRef.current = null;
				setPhase("error");
				setMessage("Sua permissão de edição não está mais disponível. As alterações locais foram preservadas.");
				return;
			}
			if (
				result.reason === "validation" ||
				result.reason === "invalid_edits" ||
				result.reason === "invalid_base" ||
				result.reason === "not_found" ||
				result.reason === "conflict"
			)
				operationIdRef.current = null;
			setPhase("error");
			setMessage(
				result.reason === "validation" || result.reason === "invalid_edits"
					? "Há uma fala inválida. Confira speaker/texto e tente novamente."
					: "Não foi possível salvar esta revisão. As alterações locais foram preservadas.",
			);
		} catch {
			// Keep operationId for exact replay after an ambiguous network failure.
			setPhase("error");
			setMessage(
				"A resposta do save se perdeu. As alterações continuam locais; tentar novamente reutiliza a mesma operação.",
			);
		}
	}, [editing, edits, phase, revisionId, segmentsById, sessionId]);

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
		if (!edits.size) return;
		const beforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		const guardLinks = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest("a[href]");
			if (
				!(anchor instanceof HTMLAnchorElement) ||
				anchor.target === "_blank" ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			if (
				!window.confirm(
					"Há alterações não salvas na transcrição. Sair desta página mesmo assim?",
				)
			) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("click", guardLinks, true);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("click", guardLinks, true);
		};
	}, [edits.size]);

	useEffect(() => {
		if (!editing) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void saveWorkingCopy();
				return;
			}
			if (event.key === "Escape" && activeId) {
				event.preventDefault();
				setActiveId(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activeId, editing, saveWorkingCopy]);

	const visible = segments.slice(0, visibleCount);
	const canEditCurrent = editable && Boolean(sessionId) && Boolean(revisionId);

	return (
		<div className={styles.reader}>
			<div className={styles.toolbar}>
				<div className={styles.source}>
					<strong>Fonte da leitura</strong>
					<span>{sourceLabel}</span>
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
					<Button size="sm" variant="tertiary" disabled={!matches.length} onClick={() => moveMatch(-1)}>
						Anterior
					</Button>
					<Button size="sm" variant="tertiary" disabled={!matches.length} onClick={() => moveMatch(1)}>
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
					<Button size="sm" onClick={jump}>Ir</Button>
				</div>
				<a className={styles.download} href={downloadHref}>
					Baixar transcrição (.md)
				</a>
				{canEditCurrent && !editing ? (
					<Button
						size="sm"
						onClick={() => {
							setEditing(true);
							setPhase("idle");
							setMessage(null);
						}}
					>
						Editar transcrição
					</Button>
				) : null}
			</div>

			{editing ? (
				<div className={styles.editToolbar} role="status">
					<div>
						<strong>Modo de edição</strong>
						<span>
							{edits.size.toLocaleString("pt-BR")} alteração(ões) não salva(s)
						</span>
					</div>
					<div className={styles.editActions}>
						<Button
							size="sm"
							disabled={!edits.size || phase === "saving"}
							onClick={() => void saveWorkingCopy()}
						>
							{phase === "saving" ? "Salvando…" : "Salvar alterações da transcrição"}
						</Button>
						<Button size="sm" variant="tertiary" disabled={phase === "saving"} onClick={discardAll}>
							Descartar alterações
						</Button>
						<Button size="sm" variant="tertiary" disabled={phase === "saving"} onClick={leaveEditMode}>
							Sair do modo de edição
						</Button>
					</div>
					{message ? (
						<p className={phase === "conflict" ? styles.conflict : styles.editError}>
							{message}
						</p>
					) : null}
				</div>
			) : null}

			<section className={styles.timeline} aria-label="Transcrição completa">
				{visible.map((segment, index) => {
					const value = effectiveValue(segment, edits);
					const changed = edits.has(segment.id);
					const active = editing && activeId === segment.id;
					return (
						<article
							id={`segment-${encodeURIComponent(segment.id)}`}
							className={`${styles.segment} ${changed ? styles.segmentEdited : ""}`}
							key={segment.id}
							ref={(node) => {
								if (node) segmentRefs.current.set(index, node);
								else segmentRefs.current.delete(index);
							}}
							data-transcript-segment
						>
							<button
								type="button"
								className={styles.timestamp}
								title={formatTranscriptTimestamp(segment.startMs)}
								onClick={() => void copyReference(index)}
							>
								{formatTranscriptTimestamp(segment.startMs, false)}
							</button>
							{active ? (
								<>
									<label className={styles.inlineSpeaker}>
										<span>Speaker</span>
										<input
											autoFocus
											value={value.speaker}
											onChange={(event) =>
												updateSegment(segment, "speaker", event.currentTarget.value)
											}
										/>
									</label>
									<label className={styles.inlineText}>
										<span>Texto</span>
										<textarea
											rows={Math.min(8, Math.max(3, value.text.split("\n").length + 1))}
											value={value.text}
											onChange={(event) =>
												updateSegment(segment, "text", event.currentTarget.value)
											}
										/>
									</label>
								</>
							) : (
								<>
									<strong className={styles.speaker}>
										{highlighted(value.speaker, normalizedQuery)}
									</strong>
									<p className={styles.text}>{highlighted(value.text, normalizedQuery)}</p>
								</>
							)}
							{editing ? (
								<div className={styles.segmentActions}>
									{changed ? <span className={styles.editedBadge}>Editada</span> : null}
									<Button
										size="sm"
										variant="tertiary"
										onClick={() => setActiveId(active ? null : segment.id)}
									>
										{active ? "Fechar edição" : "Editar"}
									</Button>
									{changed ? (
										<Button
											size="sm"
											variant="tertiary"
											onClick={() => revertSegment(segment.id)}
										>
											Reverter fala
										</Button>
									) : null}
								</div>
							) : null}
						</article>
					);
				})}
				{visibleCount < segments.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!segments.length ? <p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p> : null}
			</section>
		</div>
	);
}
