"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { saveTranscriptRevisionAction } from "./revision-edit-actions";
import {
	applyTranscriptRevisionEdits,
	type TranscriptRevisionEditPatch,
} from "./revision-edit-model";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import { TranscriptReader } from "./reader";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;
export const TRANSCRIPT_REVISION_UPDATED_EVENT =
	"tda:transcript-revision-updated";

type Props = Readonly<{
	sessionId: string;
	revisionId: string | null;
	revisionNumber: number | null;
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	editable: boolean;
}>;

function normalizeSearch(value: string): string {
	return value.trim().toLocaleLowerCase("pt-BR");
}

function dirtyPatch(
	segment: TranscriptReaderSegment,
	patch: TranscriptRevisionEditPatch | undefined,
): TranscriptRevisionEditPatch | null {
	if (!patch) return null;
	const speaker = patch.speaker.trim();
	const text = patch.text.trim();
	if (speaker === segment.speaker && text === segment.text) return null;
	return { id: segment.id, speaker, text };
}

export function TranscriptRevisionEditor({
	sessionId,
	revisionId,
	revisionNumber,
	segments,
	sourceLabel,
	downloadHref,
	editable,
}: Props) {
	const [mode, setMode] = useState<"read" | "edit">("read");
	const [baseline, setBaseline] = useState<readonly TranscriptReaderSegment[]>(segments);
	const [currentRevisionId, setCurrentRevisionId] = useState(revisionId);
	const [currentRevisionNumber, setCurrentRevisionNumber] = useState(revisionNumber);
	const [patches, setPatches] = useState(
		() => new Map<string, TranscriptRevisionEditPatch>(),
	);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [jumpValue, setJumpValue] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const [phase, setPhase] = useState<
		"idle" | "saving" | "saved" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const refs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);

	const working = useMemo(
		() => applyTranscriptRevisionEdits(baseline, [...patches.values()]),
		[baseline, patches],
	);
	const dirty = patches.size > 0;
	const normalizedQuery = normalizeSearch(query);
	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < working.length; index += 1) {
			const segment = working[index];
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			) {
				result.push(index);
			}
		}
		return result;
	}, [normalizedQuery, working]);

	useEffect(() => {
		if (mode !== "edit" || !dirty) return;
		const guard = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty, mode]);

	useEffect(() => {
		if (mode !== "edit" || !dirty) return;
		const guardLinks = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest("a");
			if (
				!anchor ||
				anchor.target === "_blank" ||
				anchor.hasAttribute("download") ||
				!anchor.href
			) {
				return;
			}
			if (
				window.confirm(
					"Há correções de transcrição ainda não salvas. Sair desta página e descartá-las?",
				)
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
		};
		document.addEventListener("click", guardLinks, true);
		return () => document.removeEventListener("click", guardLinks, true);
	}, [dirty, mode]);

	useEffect(() => {
		if (mode !== "edit") return;
		const element = sentinelRef.current;
		if (!element || visibleCount >= working.length) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				setVisibleCount((count) =>
					Math.min(working.length, count + VISIBLE_STEP),
				);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [mode, visibleCount, working.length]);

	useEffect(() => {
		if (mode !== "edit") return;
		const shortcut = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				void save();
				return;
			}
			if (event.key === "Escape" && activeId) {
				event.preventDefault();
				setActiveId(null);
			}
		};
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	});

	function patchSegment(
		segment: TranscriptReaderSegment,
		field: "speaker" | "text",
		value: string,
	) {
		setPatches((current) => {
			const next = new Map(current);
			const existing = next.get(segment.id) ?? {
				id: segment.id,
				speaker: segment.speaker,
				text: segment.text,
			};
			const candidate = { ...existing, [field]: value };
			const normalized = dirtyPatch(segment, candidate);
			if (normalized) next.set(segment.id, normalized);
			else next.delete(segment.id);
			return next;
		});
		setPhase("idle");
		setMessage(null);
	}

	function reveal(index: number) {
		if (index < 0) return;
		setVisibleCount((count) => Math.max(count, Math.min(working.length, index + 20)));
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				refs.current.get(index)?.scrollIntoView({
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
		reveal(matches[next]);
	}

	function jump() {
		const target = parseTranscriptTimestamp(jumpValue);
		if (target === null) {
			setMessage("Use o formato HH:MM:SS ou HH:MM:SS.mmm.");
			setPhase("error");
			return;
		}
		reveal(findTranscriptJumpIndex(working, target));
	}

	async function save() {
		if (
			!dirty ||
			phase === "saving" ||
			!currentRevisionId ||
			!editable
		) {
			return;
		}
		setPhase("saving");
		setMessage("Salvando uma nova revisão privada…");
		const edits = [...patches.values()];
		const result = await saveTranscriptRevisionAction({
			sessionId,
			expectedCurrentRevisionId: currentRevisionId,
			operationId: crypto.randomUUID(),
			edits,
		});
		if (!result.ok) {
			if (result.reason === "conflict") {
				setPhase("conflict");
				setMessage(
					"A transcrição mudou em outra edição. Seu rascunho continua aqui; abra a sessão em outra aba para comparar antes de decidir.",
				);
				return;
			}
			setPhase("error");
			setMessage(
				result.reason === "forbidden"
					? "Sua conta não tem permissão para corrigir esta transcrição."
					: result.reason === "validation"
						? "Uma correção ficou fora do contrato. Revise speaker/text e tente novamente."
						: "Não foi possível salvar agora. Seu rascunho continua nesta aba.",
			);
			return;
		}

		const nextBaseline = applyTranscriptRevisionEdits(baseline, result.edits);
		setBaseline(nextBaseline);
		setCurrentRevisionId(result.revisionId);
		setCurrentRevisionNumber(result.revisionNumber);
		setPatches(new Map());
		setActiveId(null);
		setPhase("saved");
		setMessage(
			result.status === "no_change"
				? `Nada mudou na revisão privada r${result.revisionNumber}.`
				: `Revisão privada r${result.revisionNumber} salva. Nada foi publicado.`,
		);
		window.dispatchEvent(
			new CustomEvent(TRANSCRIPT_REVISION_UPDATED_EVENT, {
				detail: {
					sessionId,
					revisionId: result.revisionId,
					revisionNumber: result.revisionNumber,
				},
			}),
		);
		setMode("read");
	}

	function discardAndExit() {
		if (
			dirty &&
			!window.confirm("Descartar as correções de transcrição ainda não salvas?")
		) {
			return;
		}
		setPatches(new Map());
		setActiveId(null);
		setMode("read");
		setPhase("idle");
		setMessage(null);
	}

	if (!editable || !currentRevisionId || currentRevisionNumber === null) {
		return (
			<TranscriptReader
				downloadHref={downloadHref}
				segments={baseline}
				sourceLabel={sourceLabel}
			/>
		);
	}

	if (mode === "read") {
		return (
			<div className={styles.reader}>
				<div className={styles.editLauncher}>
					<div>
						<strong>
							Revisão privada atual · r{currentRevisionNumber}
						</strong>
						<p>
							Correções criam uma nova revisão privada. A versão pública e os
							timestamps não mudam.
						</p>
					</div>
					<Button onClick={() => setMode("edit")} size="sm">
						Corrigir transcrição
					</Button>
				</div>
				{message ? (
					<p className={styles.editorStatus} role="status">
						{message}
					</p>
				) : null}
				<TranscriptReader
					downloadHref={downloadHref}
					segments={baseline}
					sourceLabel={`Revisão privada atual · r${currentRevisionNumber}`}
				/>
			</div>
		);
	}

	return (
		<div className={styles.reader}>
			<div className={styles.editorToolbar}>
				<div className={styles.source}>
					<span>Modo</span>
					<strong>
						Correção privada · r{currentRevisionNumber}
						{dirty ? ` · ${patches.size} alterada(s)` : ""}
					</strong>
				</div>
				<label className={styles.search}>
					<span>Buscar na working copy</span>
					<input
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Pessoa ou trecho"
						type="search"
						value={query}
					/>
				</label>
				<div className={styles.searchNav}>
					<span className={styles.matchCount}>
						{normalizedQuery
							? `${matches.length} ocorrência(s)`
							: "Busca na working copy"}
					</span>
					{matches.length ? (
						<>
							<Button
								aria-label="Ocorrência anterior"
								onClick={() => moveMatch(-1)}
								size="sm"
								variant="tertiary"
							>
								↑
							</Button>
							<Button
								aria-label="Próxima ocorrência"
								onClick={() => moveMatch(1)}
								size="sm"
								variant="tertiary"
							>
								↓
							</Button>
						</>
					) : null}
				</div>
				<div className={styles.jump}>
					<label>
						<span>Ir para tempo</span>
						<input
							onChange={(event) => setJumpValue(event.target.value)}
							placeholder="00:12:34"
							value={jumpValue}
						/>
					</label>
					<Button onClick={jump} size="sm">
						Ir
					</Button>
				</div>
				<div className={styles.editorActions}>
					<Button
						disabled={!dirty || phase === "saving" || phase === "conflict"}
						onClick={() => void save()}
						size="sm"
						variant="primary"
					>
						{phase === "saving" ? "Salvando…" : "Salvar nova revisão"}
					</Button>
					<Button
						disabled={phase === "saving"}
						onClick={discardAndExit}
						size="sm"
						variant="tertiary"
					>
						Sair da edição
					</Button>
				</div>
			</div>

			{message ? (
				<div
					className={
						phase === "conflict"
							? styles.editorConflict
							: phase === "error"
								? styles.editorError
								: styles.editorStatus
					}
					role={phase === "error" ? "alert" : "status"}
				>
					<span>{message}</span>
					{phase === "conflict" ? (
						<button
							className={styles.inlineLink}
							onClick={() =>
								window.open(window.location.href, "_blank", "noopener,noreferrer")
							}
							type="button"
						>
							Abrir versão atual em outra aba
						</button>
					) : null}
				</div>
			) : null}

			<div className={styles.timeline}>
				{working.slice(0, visibleCount).map((segment, index) => {
					const isActive = activeId === segment.id;
					const original = baseline[index];
					const changed = patches.has(segment.id);
					return (
						<article
							className={
								isActive
									? `${styles.segment} ${styles.segmentEditing}`
									: styles.segment
							}
							key={segment.id}
							ref={(element) => {
								if (element) refs.current.set(index, element);
								else refs.current.delete(index);
							}}
						>
							<button
								className={styles.timestamp}
								onClick={() => reveal(index)}
								title="Timestamp somente leitura"
								type="button"
							>
								{formatTranscriptTimestamp(segment.startMs, false)}
							</button>
							{isActive ? (
								<div className={styles.editFields}>
									<label className={styles.editLabel}>
										<span>Pessoa</span>
										<input
											aria-label="Pessoa desta fala"
											className={styles.editInput}
											onChange={(event) =>
												patchSegment(original, "speaker", event.target.value)
											}
											value={segment.speaker}
										/>
									</label>
									<label className={styles.editLabel}>
										<span>Texto</span>
										<textarea
											aria-label="Texto desta fala"
											className={styles.editTextarea}
											onChange={(event) =>
												patchSegment(original, "text", event.target.value)
											}
											rows={4}
											value={segment.text}
										/>
									</label>
									<div className={styles.rowActions}>
										{changed ? <span>Alteração não salva</span> : <span>Sem alteração</span>}
										<Button onClick={() => setActiveId(null)} size="sm">
											Fechar fala
										</Button>
									</div>
								</div>
							) : (
								<>
									<strong className={styles.speaker}>{segment.speaker}</strong>
									<div className={styles.editableText}>
										<p className={styles.text}>{segment.text}</p>
										<Button
											aria-label={`Editar fala de ${segment.speaker} em ${formatTranscriptTimestamp(segment.startMs, false)}`}
											onClick={() => setActiveId(segment.id)}
											size="sm"
											variant={changed ? "primary" : "tertiary"}
										>
											{changed ? "Editar alteração" : "Editar fala"}
										</Button>
									</div>
								</>
							)}
						</article>
					);
				})}
				{visibleCount < working.length ? (
					<div
						aria-hidden="true"
						className={styles.more}
						ref={sentinelRef}
					/>
				) : null}
				{working.length === 0 ? (
					<p className={styles.empty}>Nenhuma fala nesta revisão.</p>
				) : null}
			</div>
		</div>
	);
}
