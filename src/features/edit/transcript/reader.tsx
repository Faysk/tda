"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
	type TranscriptReaderSnapshot,
} from "./reader-contract";
import {
	reloadCurrentTranscriptRevisionAction,
	saveTranscriptRevisionEditAction,
} from "./revision-edit-actions";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;

type EditableValue = Readonly<{ speaker: string; text: string }>;

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

function sameEditable(left: EditableValue, right: EditableValue) {
	return left.speaker === right.speaker && left.text === right.text;
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
	const [baseline, setBaseline] = useState<readonly TranscriptReaderSegment[]>(() => [
		...segments,
	]);
	const [currentRevisionId, setCurrentRevisionId] = useState(revisionId ?? null);
	const [currentRevisionNumber, setCurrentRevisionNumber] = useState(
		revisionNumber ?? null,
	);
	const [changes, setChanges] = useState<Record<string, EditableValue>>({});
	const [editMode, setEditMode] = useState(false);
	const [activeEditId, setActiveEditId] = useState<string | null>(null);
	const [phase, setPhase] = useState<
		"idle" | "saving" | "saved" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [remote, setRemote] = useState<TranscriptReaderSnapshot | null>(null);
	const pendingOperationId = useRef<string | null>(null);
	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);
	const dirtyCount = Object.keys(changes).length;
	const dirty = dirtyCount > 0;

	const workingSegments = useMemo(
		() =>
			baseline.map((segment) => {
				const change = changes[segment.id];
				return change ? { ...segment, ...change } : segment;
			}),
		[baseline, changes],
	);
	const normalizedQuery = normalizeSearch(query);
	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < workingSegments.length; index += 1) {
			const segment = workingSegments[index];
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [normalizedQuery, workingSegments]);

	const remoteComparison = useMemo(() => {
		if (!remote) return null;
		const original = new Map(
			baseline.map((segment) => [
				segment.id,
				{ speaker: segment.speaker, text: segment.text },
			]),
		);
		const remoteById = new Map(
			remote.segments.map((segment) => [
				segment.id,
				{ speaker: segment.speaker, text: segment.text },
			]),
		);
		let collisions = 0;
		for (const id of Object.keys(changes)) {
			const before = original.get(id);
			const after = remoteById.get(id);
			if (!before || !after || !sameEditable(before, after)) collisions += 1;
		}
		return { collisions, revisionNumber: remote.revisionNumber ?? "?" };
	}, [baseline, changes, remote]);

	function revealAndScroll(index: number) {
		if (index < 0) return;
		setVisibleCount((current) =>
			Math.max(current, Math.min(workingSegments.length, index + 30)),
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
		revealAndScroll(findTranscriptJumpIndex(workingSegments, milliseconds));
	}

	async function copyReference(index: number) {
		const segment = workingSegments[index];
		const reference = `${formatTranscriptTimestamp(segment.startMs)} · ${segment.speaker}`;
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
	}

	function changeSegment(id: string, value: EditableValue) {
		const original = baseline.find((segment) => segment.id === id);
		if (!original) return;
		pendingOperationId.current = null;
		setRemote(null);
		setPhase("idle");
		setMessage(null);
		setChanges((current) => {
			if (
				original.speaker === value.speaker &&
				original.text === value.text
			) {
				const next = { ...current };
				delete next[id];
				return next;
			}
			return { ...current, [id]: value };
		});
	}

	function revertSegment(id: string) {
		pendingOperationId.current = null;
		setChanges((current) => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setPhase("idle");
		setMessage(null);
	}

	function leaveEditMode() {
		if (dirty && !window.confirm("Descartar as alterações ainda não salvas?"))
			return;
		setChanges({});
		setRemote(null);
		setMessage(null);
		setPhase("idle");
		setActiveEditId(null);
		setEditMode(false);
		pendingOperationId.current = null;
	}

	async function save() {
		if (
			!editable ||
			!sessionId ||
			!currentRevisionId ||
			!dirty ||
			phase === "saving"
		)
			return;
		setPhase("saving");
		setMessage("Salvando uma nova revisão privada…");
		setRemote(null);
		const operationId = pendingOperationId.current ?? crypto.randomUUID();
		pendingOperationId.current = operationId;
		const result = await saveTranscriptRevisionEditAction({
			sessionId,
			expectedCurrentRevisionId: currentRevisionId,
			operationId,
			patches: Object.entries(changes).map(([id, value]) => ({ id, ...value })),
		});
		if (!result.ok) {
			if (result.reason === "stale_current" && result.remote) {
				setRemote(result.remote);
				setPhase("conflict");
				pendingOperationId.current = null;
				setMessage(
					"A revisão atual mudou em outra aba. Sua working copy foi preservada; compare antes de salvar novamente.",
				);
				return;
			}
			setPhase("error");
			if (result.reason !== "dependency_unavailable")
				pendingOperationId.current = null;
			setMessage(
				result.reason === "operation_conflict"
					? "A operação já existe com outro conteúdo. Nada foi sobrescrito."
					: result.reason === "validation"
						? "Uma fala ficou fora dos limites do contrato. Nada foi salvo."
						: result.reason === "forbidden"
							? "Sua conta não tem permissão para editar esta transcrição."
							: "Não foi possível confirmar o salvamento. Tente novamente; a mesma operação será reutilizada se a resposta tiver se perdido.",
			);
			return;
		}

		setBaseline(result.snapshot.segments);
		setCurrentRevisionId(result.snapshot.revisionId);
		setCurrentRevisionNumber(result.snapshot.revisionNumber);
		setChanges({});
		setRemote(null);
		setPhase("saved");
		pendingOperationId.current = null;
		setMessage(
			result.status === "replay"
				? `Salvamento recuperado · revisão r${result.snapshot.revisionNumber ?? "?"}.`
				: result.status === "no_changes"
					? "Nenhuma alteração efetiva para salvar."
					: `Nova revisão privada r${result.snapshot.revisionNumber ?? "?"} salva · ${result.changedSegments} fala(s) alterada(s).`,
		);
		router.refresh();
	}

	async function refreshConflictComparison() {
		if (!sessionId) return;
		const result = await reloadCurrentTranscriptRevisionAction(sessionId);
		if (!result.ok) {
			setMessage("Não foi possível atualizar a comparação agora.");
			return;
		}
		setRemote(result.snapshot);
	}

	function adoptRemote() {
		if (!remote) return;
		if (dirty && !window.confirm("Descartar sua working copy e usar a revisão atual?"))
			return;
		setBaseline(remote.segments);
		setCurrentRevisionId(remote.revisionId);
		setCurrentRevisionNumber(remote.revisionNumber);
		setChanges({});
		setRemote(null);
		setPhase("idle");
		setMessage("Revisão atual carregada.");
		setActiveEditId(null);
		pendingOperationId.current = null;
	}

	function rebaseWorkingCopy() {
		if (!remote) return;
		const localById = new Map(
			workingSegments.map((segment) => [
				segment.id,
				{ speaker: segment.speaker, text: segment.text },
			]),
		);
		if (
			remoteComparison?.collisions &&
			!window.confirm(
				`${remoteComparison.collisions} fala(s) também mudaram na revisão remota. Reaplicar sua versão sobre elas mesmo assim?`,
			)
		)
			return;
		const rebased: Record<string, EditableValue> = {};
		for (const id of Object.keys(changes)) {
			const local = localById.get(id);
			const remoteSegment = remote.segments.find((segment) => segment.id === id);
			if (!local || !remoteSegment) continue;
			if (
				local.speaker !== remoteSegment.speaker ||
				local.text !== remoteSegment.text
			)
				rebased[id] = local;
		}
		setBaseline(remote.segments);
		setCurrentRevisionId(remote.revisionId);
		setCurrentRevisionNumber(remote.revisionNumber);
		setChanges(rebased);
		setRemote(null);
		setPhase("idle");
		setMessage(
			"Working copy reaplicada sobre a revisão atual. Revise e salve explicitamente.",
		);
		pendingOperationId.current = null;
	}

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || visibleCount >= workingSegments.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisibleCount((count) =>
					Math.min(workingSegments.length, count + VISIBLE_STEP),
				);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [workingSegments.length, visibleCount]);

	useEffect(() => {
		if (!dirty) return;
		const unload = (event: BeforeUnloadEvent) => event.preventDefault();
		const navigate = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest("a[href]");
			if (!anchor || anchor.hasAttribute("data-transcript-download")) return;
			if (!window.confirm("Há alterações na transcrição que ainda não foram salvas.")) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener("beforeunload", unload);
		document.addEventListener("click", navigate, true);
		return () => {
			window.removeEventListener("beforeunload", unload);
			document.removeEventListener("click", navigate, true);
		};
	}, [dirty]);

	useEffect(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (
				editMode &&
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

	const visible = workingSegments.slice(0, visibleCount);
	const canEditRevision = Boolean(
		editable && sessionId && currentRevisionId && currentRevisionNumber,
	);

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
				<div className={styles.editActions}>
					<a className={styles.download} href={downloadHref} data-transcript-download>
						Baixar transcrição (.md)
					</a>
					{canEditRevision ? (
						<Button
							size="sm"
							variant={editMode ? "tertiary" : "secondary"}
							onClick={() => (editMode ? leaveEditMode() : setEditMode(true))}
						>
							{editMode ? "Sair da edição" : "Editar transcrição"}
						</Button>
					) : null}
				</div>
			</div>

			{editMode ? (
				<div className={styles.editBar} role="status">
					<div>
						<strong>Edição privada por revisão</strong>
						<span>
							{dirty
								? `${dirtyCount} fala(s) alterada(s) · timestamps bloqueados`
								: "Nenhuma alteração pendente · timestamps bloqueados"}
						</span>
					</div>
					<div className={styles.editBarActions}>
						<Button
							disabled={!dirty || phase === "saving" || phase === "conflict"}
							onClick={() => void save()}
						>
							{phase === "saving" ? "Salvando…" : "Salvar nova revisão"}
						</Button>
						<span className={styles.editStatus} aria-live="polite">
							{message}
						</span>
					</div>
				</div>
			) : null}

			{phase === "conflict" && remote ? (
				<div className={styles.conflictPanel} role="alert">
					<strong>Conflito com revisão r{remote.revisionNumber ?? "?"}</strong>
					<p>
						Sua working copy continua local. A comparação encontrou{" "}
						<strong>{remoteComparison?.collisions ?? 0}</strong> fala(s) que também
						mudaram do outro lado.
					</p>
					<div className={styles.conflictActions}>
						<Button size="sm" variant="tertiary" onClick={() => void refreshConflictComparison()}>
							Atualizar comparação
						</Button>
						<Button size="sm" variant="secondary" onClick={rebaseWorkingCopy}>
							Reaplicar meu rascunho sobre r{remote.revisionNumber ?? "?"}
						</Button>
						<Button size="sm" variant="tertiary" onClick={adoptRemote}>
							Usar versão atual
						</Button>
					</div>
				</div>
			) : null}

			<section className={styles.timeline} aria-label="Transcrição completa">
				{visible.map((segment, index) => {
					const editing = editMode && activeEditId === segment.id;
					const changed = Boolean(changes[segment.id]);
					return (
						<article
							id={`segment-${encodeURIComponent(segment.id)}`}
							className={editing ? `${styles.segment} ${styles.segmentEditing}` : styles.segment}
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
								title="Copiar referência deste timestamp"
								onClick={() => void copyReference(index)}
							>
								{formatTranscriptTimestamp(segment.startMs, false)}
							</button>
							{editing ? (
								<div className={styles.editFields}>
									<label>
										<span>Speaker</span>
										<input
											value={segment.speaker}
											maxLength={160}
											onChange={(event) =>
												changeSegment(segment.id, {
													speaker: event.currentTarget.value,
													text: segment.text,
												})
											}
										/>
									</label>
									<label className={styles.editTextField}>
										<span>Fala</span>
										<textarea
											value={segment.text}
											maxLength={100000}
											rows={5}
											onChange={(event) =>
												changeSegment(segment.id, {
													speaker: segment.speaker,
													text: event.currentTarget.value,
												})
											}
										/>
									</label>
									<div className={styles.segmentActions}>
										{changed ? <span className={styles.editedBadge}>Editada</span> : null}
										<Button size="sm" variant="tertiary" disabled={!changed} onClick={() => revertSegment(segment.id)}>
											Reverter fala
										</Button>
										<Button size="sm" variant="tertiary" onClick={() => setActiveEditId(null)}>
											Fechar
										</Button>
									</div>
								</div>
							) : (
								<>
									<strong className={styles.speaker}>
										{highlighted(segment.speaker, normalizedQuery)}
										{changed ? <span className={styles.editedBadge}>Editada</span> : null}
									</strong>
									<div className={styles.textColumn}>
										<p className={styles.text}>{highlighted(segment.text, normalizedQuery)}</p>
										{editMode ? (
											<div className={styles.segmentActions}>
												<Button size="sm" variant="tertiary" onClick={() => setActiveEditId(segment.id)}>
													Editar fala
												</Button>
												{changed ? (
													<Button size="sm" variant="tertiary" onClick={() => revertSegment(segment.id)}>
														Reverter
													</Button>
												) : null}
											</div>
										) : null}
									</div>
								</>
							)}
						</article>
					);
				})}
				{visibleCount < workingSegments.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!workingSegments.length ? (
					<p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p>
				) : null}
			</section>
		</div>
	);
}
