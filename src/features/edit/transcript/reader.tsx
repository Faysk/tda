"use client";

import { useRouter } from "next/navigation";
import {
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
	type TranscriptReaderSnapshot,
} from "./reader-contract";
import {
	applyTranscriptRevisionPatches,
	rebaseTranscriptPatches,
	summarizeTranscriptRebase,
	TRANSCRIPT_REVISION_EDIT_LIMITS,
	type TranscriptRevisionPatch,
} from "./revision-edit-model";
import { saveTranscriptRevisionEditAction } from "./revision-edit-actions";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;

type PendingSave = Readonly<{
	operationId: string;
	patches: readonly TranscriptRevisionPatch[];
}>;

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

function validDraft(speaker: string, text: string) {
	return (
		speaker.trim().length > 0 &&
		text.trim().length > 0 &&
		Array.from(speaker).length <= TRANSCRIPT_REVISION_EDIT_LIMITS.speaker &&
		Array.from(text).length <= TRANSCRIPT_REVISION_EDIT_LIMITS.text
	);
}

function InlineSegmentEditor({
	segment,
	disabled,
	onDraftChange,
	onApply,
	onCancel,
	onSave,
}: Readonly<{
	segment: TranscriptReaderSegment;
	disabled: boolean;
	onDraftChange: (draft: TranscriptRevisionPatch | null) => void;
	onApply: (draft: TranscriptRevisionPatch) => void;
	onCancel: () => void;
	onSave: (draft: TranscriptRevisionPatch) => void;
}>) {
	const [speaker, setSpeaker] = useState(segment.speaker);
	const [text, setText] = useState(segment.text);
	const valid = validDraft(speaker, text);
	const draft = useMemo(
		() => ({ id: segment.id, speaker, text }),
		[segment.id, speaker, text],
	);

	useEffect(() => {
		onDraftChange(draft);
		return () => onDraftChange(null);
	}, [draft, onDraftChange]);

	function keyboard(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
		if (event.key === "Escape") {
			event.preventDefault();
			onCancel();
			return;
		}
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			if (valid && !disabled) onSave(draft);
			return;
		}
		if (event.ctrlKey && event.key === "Enter") {
			event.preventDefault();
			if (valid && !disabled) onApply(draft);
		}
	}

	return (
		<div className={styles.inlineEditor}>
			<label>
				<span>Speaker</span>
				<input
					autoFocus
					disabled={disabled}
					maxLength={TRANSCRIPT_REVISION_EDIT_LIMITS.speaker}
					onChange={(event) => setSpeaker(event.currentTarget.value)}
					onKeyDown={keyboard}
					value={speaker}
				/>
			</label>
			<label>
				<span>Texto</span>
				<textarea
					disabled={disabled}
					maxLength={TRANSCRIPT_REVISION_EDIT_LIMITS.text}
					onChange={(event) => setText(event.currentTarget.value)}
					onKeyDown={keyboard}
					rows={4}
					value={text}
				/>
			</label>
			<div className={styles.inlineEditorActions}>
				<Button
					disabled={disabled}
					onClick={onCancel}
					size="sm"
					variant="tertiary"
				>
					Cancelar
				</Button>
				<Button
					disabled={disabled || !valid}
					onClick={() => onApply(draft)}
					size="sm"
				>
					Aplicar à working copy
				</Button>
			</div>
			<small>
				Esc cancela esta fala · Ctrl+Enter aplica · Ctrl/⌘+S salva a revisão.
			</small>
		</div>
	);
}

export function TranscriptReader({
	segments,
	sourceLabel,
	downloadHref,
	editable = false,
	sessionId,
	revisionId,
	revisionNumber,
}: Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
	editable?: boolean;
	sessionId?: string;
	revisionId?: string | null;
	revisionNumber?: number | null;
}>) {
	const router = useRouter();
	const [baseline, setBaseline] = useState(() => [...segments]);
	const [baseRevisionId, setBaseRevisionId] = useState(revisionId ?? null);
	const [baseRevisionNumber, setBaseRevisionNumber] = useState(
		revisionNumber ?? null,
	);
	const [patches, setPatches] = useState(
		() => new Map<string, TranscriptRevisionPatch>(),
	);
	const [editMode, setEditMode] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const activeDraftRef = useRef<TranscriptRevisionPatch | null>(null);
	const patchesRef = useRef(patches);
	const baselineRef = useRef(baseline);
	const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
	const [phase, setPhase] = useState<
		"idle" | "saving" | "saved" | "error" | "conflict"
	>("idle");
	const [message, setMessage] = useState<string | null>(null);
	const [remote, setRemote] = useState<TranscriptReaderSnapshot | null>(null);
	const [showConflictDiff, setShowConflictDiff] = useState(false);
	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);

	patchesRef.current = patches;
	baselineRef.current = baseline;

	const patchList = useMemo(() => [...patches.values()], [patches]);
	const effectiveSegments = useMemo(
		() => applyTranscriptRevisionPatches(baseline, patchList),
		[baseline, patchList],
	);
	const normalizedQuery = normalizeSearch(query);
	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < effectiveSegments.length; index += 1) {
			const segment = effectiveSegments[index];
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [normalizedQuery, effectiveSegments]);

	const conflictSummary = useMemo(
		() =>
			remote
				? summarizeTranscriptRebase(baseline, remote.segments, patchList)
				: null,
		[baseline, patchList, remote],
	);
	const conflictRows = useMemo(() => {
		if (!remote) return [];
		const previous = new Map(baseline.map((segment) => [segment.id, segment]));
		const local = new Map(patchList.map((patch) => [patch.id, patch]));
		return remote.segments
			.filter((segment) => {
				const before = previous.get(segment.id);
				return (
					!before ||
					before.speaker !== segment.speaker ||
					before.text !== segment.text
				);
			})
			.slice(0, 20)
			.map((segment) => ({
				id: segment.id,
				startMs: segment.startMs,
				before: previous.get(segment.id),
				remote: segment,
				local: local.get(segment.id),
			}));
	}, [baseline, patchList, remote]);

	function activeDraftIsDirty() {
		const draft = activeDraftRef.current;
		if (!draft) return false;
		const original = baselineRef.current.find((segment) => segment.id === draft.id);
		return Boolean(
			original &&
				(draft.speaker !== original.speaker || draft.text !== original.text),
		);
	}

	function collectCandidatePatches(
		explicitActive: TranscriptRevisionPatch | null = activeDraftRef.current,
	) {
		const next = new Map(patchesRef.current);
		if (explicitActive) {
			const original = baselineRef.current.find(
				(segment) => segment.id === explicitActive.id,
			);
			if (!original)
				throw new Error("Active transcript segment no longer exists");
			if (
				explicitActive.speaker === original.speaker &&
				explicitActive.text === original.text
			)
				next.delete(explicitActive.id);
			else next.set(explicitActive.id, explicitActive);
		}
		return [...next.values()];
	}

	function setWorkingPatch(draft: TranscriptRevisionPatch) {
		const original = baseline.find((segment) => segment.id === draft.id);
		if (!original) return;
		setPatches((current) => {
			const next = new Map(current);
			if (
				draft.speaker === original.speaker &&
				draft.text === original.text
			)
				next.delete(draft.id);
			else next.set(draft.id, draft);
			return next;
		});
		activeDraftRef.current = null;
		setActiveId(null);
		setPhase("idle");
		setMessage(null);
	}

	function revertSegment(id: string) {
		setPatches((current) => {
			const next = new Map(current);
			next.delete(id);
			return next;
		});
		if (activeId === id) {
			activeDraftRef.current = null;
			setActiveId(null);
		}
		setPhase("idle");
		setMessage(null);
	}

	function revealAndScroll(index: number) {
		if (index < 0) return;
		setVisibleCount((current) =>
			Math.max(
				current,
				Math.min(effectiveSegments.length, index + 30),
			),
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
		revealAndScroll(findTranscriptJumpIndex(effectiveSegments, milliseconds));
	}

	async function copyReference(index: number) {
		const segment = effectiveSegments[index];
		const reference = `${formatTranscriptTimestamp(segment.startMs)} · ${segment.speaker}`;
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
	}

	async function saveWorkingCopy(
		explicitActive: TranscriptRevisionPatch | null = activeDraftRef.current,
	) {
		if (!editable || !sessionId || !baseRevisionId || phase === "saving") return;
		let candidate: readonly TranscriptRevisionPatch[];
		try {
			candidate = pendingSave?.patches ?? collectCandidatePatches(explicitActive);
		} catch {
			setPhase("error");
			setMessage("A fala ativa não pertence mais à revisão atual.");
			return;
		}
		if (!candidate.length) {
			setMessage("Nenhuma alteração para salvar.");
			return;
		}

		const operationId = pendingSave?.operationId ?? crypto.randomUUID();
		if (!pendingSave) setPendingSave({ operationId, patches: candidate });
		setPatches(new Map(candidate.map((patch) => [patch.id, patch])));
		activeDraftRef.current = null;
		setActiveId(null);
		setPhase("saving");
		setMessage("Salvando nova revisão privada…");

		let result: Awaited<ReturnType<typeof saveTranscriptRevisionEditAction>>;
		try {
			result = await saveTranscriptRevisionEditAction({
				sessionId,
				expectedCurrentTranscriptRevisionId: baseRevisionId,
				operationId,
				patches: candidate,
			});
		} catch {
			setPhase("error");
			setMessage(
				"Não foi possível confirmar o save. Repetir usa a mesma operação para evitar revisão duplicada.",
			);
			return;
		}

		if (result.ok) {
			const nextBaseline = applyTranscriptRevisionPatches(baseline, candidate);
			setBaseline(nextBaseline);
			setBaseRevisionId(result.revisionId);
			setBaseRevisionNumber(result.revisionNumber);
			setPatches(new Map());
			setPendingSave(null);
			setRemote(null);
			setShowConflictDiff(false);
			setPhase("saved");
			setMessage(
				result.unchanged
					? `Revisão privada r${result.revisionNumber} já estava atual.`
					: `${result.changedSegments} fala(s) salvas em nova revisão privada r${result.revisionNumber}.`,
			);
			router.refresh();
			return;
		}

		if (result.reason === "stale_current") {
			setPendingSave(null);
			setRemote(result.remote);
			setPhase("conflict");
			setMessage(
				result.remote
					? `A transcrição mudou para r${result.remote.revisionNumber}. Sua working copy foi preservada.`
					: "A transcrição mudou e a versão mais recente não pôde ser carregada. Sua working copy foi preservada.",
			);
			return;
		}

		if (result.reason !== "dependency_unavailable") setPendingSave(null);
		setPhase("error");
		setMessage(
			result.reason === "forbidden"
				? "Sua conta não tem permissão para editar esta transcrição."
				: result.reason === "validation" || result.reason === "invalid_payload"
					? "A working copy contém uma alteração inválida. Revise speaker e texto."
					: result.reason === "operation_conflict"
						? "A identidade desta tentativa já pertence a outro conteúdo. Inicie um novo save."
						: result.reason === "not_found"
							? "A sessão ou revisão não está mais disponível."
							: "Não foi possível confirmar o save. Repetir usa a mesma operação para evitar revisão duplicada.",
		);
	}

	function keepWorkingCopyOnRemote() {
		if (
			!remote ||
			!remote.revisionId ||
			!remote.revisionNumber ||
			!conflictSummary?.compatible
		)
			return;
		const rebased = rebaseTranscriptPatches(
			baseline,
			remote.segments,
			patchList,
		);
		setBaseline([...remote.segments]);
		setBaseRevisionId(remote.revisionId);
		setBaseRevisionNumber(remote.revisionNumber);
		setPatches(new Map(rebased.map((patch) => [patch.id, patch])));
		setRemote(null);
		setShowConflictDiff(false);
		setPhase("idle");
		setMessage(
			`Working copy reaplicada sobre r${remote.revisionNumber}. Revise e salve novamente.`,
		);
	}

	function useRemoteRevision() {
		if (!remote?.revisionId || !remote.revisionNumber) return;
		if (
			patchList.length &&
			!window.confirm(
				"Descartar sua working copy e usar a revisão mais recente?",
			)
		)
			return;
		setBaseline([...remote.segments]);
		setBaseRevisionId(remote.revisionId);
		setBaseRevisionNumber(remote.revisionNumber);
		setPatches(new Map());
		setPendingSave(null);
		setRemote(null);
		setShowConflictDiff(false);
		setActiveId(null);
		activeDraftRef.current = null;
		setPhase("idle");
		setMessage(`Revisão remota r${remote.revisionNumber} carregada.`);
	}

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || visibleCount >= effectiveSegments.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setVisibleCount((count) =>
					Math.min(effectiveSegments.length, count + VISIBLE_STEP),
				);
			},
			{ rootMargin: "600px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [effectiveSegments.length, visibleCount]);

	useEffect(() => {
		function shortcut(event: globalThis.KeyboardEvent) {
			if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
				return;
			if (!editable || (!patchesRef.current.size && !activeDraftIsDirty())) return;
			event.preventDefault();
			void saveWorkingCopy();
		}
		window.addEventListener("keydown", shortcut);
		return () => window.removeEventListener("keydown", shortcut);
	});

	useEffect(() => {
		function hasUnsaved() {
			return patchesRef.current.size > 0 || activeDraftIsDirty();
		}
		function beforeUnload(event: BeforeUnloadEvent) {
			if (!hasUnsaved()) return;
			event.preventDefault();
		}
		function guardLink(event: MouseEvent) {
			if (!hasUnsaved()) return;
			const element =
				event.target instanceof Element
					? event.target.closest("a[href]")
					: null;
			if (!(element instanceof HTMLAnchorElement)) return;
			const next = new URL(element.href, window.location.href);
			if (
				next.origin === window.location.origin &&
				next.pathname === window.location.pathname &&
				next.search === window.location.search &&
				next.hash
			)
				return;
			if (
				!window.confirm(
					"Há alterações de transcrição não salvas. Sair mesmo assim?",
				)
			) {
				event.preventDefault();
				event.stopPropagation();
			}
		}
		window.addEventListener("beforeunload", beforeUnload);
		document.addEventListener("click", guardLink, true);
		return () => {
			window.removeEventListener("beforeunload", beforeUnload);
			document.removeEventListener("click", guardLink, true);
		};
	}, []);

	useEffect(() => {
		if (
			!revisionId ||
			!revisionNumber ||
			revisionId === baseRevisionId ||
			patches.size ||
			activeId ||
			pendingSave ||
			remote
		)
			return;
		setBaseline([...segments]);
		setBaseRevisionId(revisionId);
		setBaseRevisionNumber(revisionNumber);
		setVisibleCount((count) => Math.min(Math.max(count, INITIAL_VISIBLE), segments.length));
	}, [
		activeId,
		baseRevisionId,
		patches.size,
		pendingSave,
		remote,
		revisionId,
		revisionNumber,
		segments,
	]);

	const visible = effectiveSegments.slice(0, visibleCount);
	const saveDisabled =
		!editable ||
		phase === "saving" ||
		(!pendingSave && !patches.size && !activeDraftIsDirty());

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

				{editable ? (
					<div className={styles.editBar}>
						<div>
							<strong>
								{editMode ? "Working copy privada" : "Leitura privada"}
							</strong>
							<span aria-live="polite">
								{patches.size
									? `${patches.size} fala(s) alteradas · base r${baseRevisionNumber ?? "?"}`
									: `Revisão r${baseRevisionNumber ?? "?"} · sem alterações locais`}
							</span>
						</div>
						<div className={styles.editBarActions}>
							<Button
								disabled={Boolean(pendingSave)}
								onClick={() => {
									setEditMode((current) => !current);
									setActiveId(null);
									activeDraftRef.current = null;
								}}
								size="sm"
								variant="tertiary"
							>
								{editMode ? "Modo leitura" : "Editar transcrição"}
							</Button>
							<Button
								disabled={saveDisabled}
								onClick={() => void saveWorkingCopy()}
								size="sm"
							>
								{phase === "saving"
									? "Salvando…"
									: pendingSave
										? "Repetir confirmação"
										: "Salvar nova revisão"}
							</Button>
						</div>
						{message ? (
							<span
								className={styles.saveMessage}
								data-state={phase}
								role={phase === "error" || phase === "conflict" ? "alert" : "status"}
							>
								{message}
							</span>
						) : null}
					</div>
				) : null}
			</div>

			{phase === "conflict" && remote ? (
				<section className={styles.conflictPanel} role="alert">
					<div>
						<strong>Conflito de revisão</strong>
						<p>
							A base mudou para r{remote.revisionNumber}. Sua working copy não foi
							salva nem descartada.
						</p>
						{conflictSummary ? (
							<p>
								{conflictSummary.compatible
									? `${conflictSummary.remoteChangedSegments} fala(s) mudaram remotamente; ${conflictSummary.collisions} colisão(ões) tocam o mesmo campo.`
									: "A identidade ou o timing da revisão mudou; rebase automático está bloqueado."}
							</p>
						) : null}
					</div>
					<div className={styles.conflictActions}>
						<Button
							onClick={() => setShowConflictDiff((current) => !current)}
							size="sm"
							variant="tertiary"
						>
							{showConflictDiff ? "Ocultar comparação" : "Comparar com versão mais recente"}
						</Button>
						<Button
							disabled={!conflictSummary?.compatible}
							onClick={keepWorkingCopyOnRemote}
							size="sm"
						>
							Manter minha working copy sobre r{remote.revisionNumber}
						</Button>
						<Button
							onClick={useRemoteRevision}
							size="sm"
							variant="tertiary"
						>
							Usar versão mais recente
						</Button>
					</div>
					{showConflictDiff ? (
						<div className={styles.conflictDiff}>
							{conflictRows.length ? (
								conflictRows.map((row) => (
									<article key={row.id}>
										<strong>{formatTranscriptTimestamp(row.startMs, false)}</strong>
										<span>
											Remoto: {row.remote.speaker} — {row.remote.text}
										</span>
										{row.local ? (
											<span>
												Minha working copy: {row.local.speaker} — {row.local.text}
											</span>
										) : null}
									</article>
								))
							) : (
								<p>Nenhuma alteração textual remota para listar.</p>
							)}
							{conflictSummary && conflictSummary.remoteChangedSegments > 20 ? (
								<small>Mostrando as primeiras 20 diferenças.</small>
							) : null}
						</div>
					) : null}
				</section>
			) : null}

			<section className={styles.timeline} aria-label="Transcrição completa">
				{visible.map((segment, index) => {
					const dirty = patches.has(segment.id);
					const active = editMode && activeId === segment.id;
					return (
						<article
							id={`segment-${encodeURIComponent(segment.id)}`}
							className={[
								styles.segment,
								dirty ? styles.segmentDirty : "",
								active ? styles.segmentActive : "",
							]
								.filter(Boolean)
								.join(" ")}
							key={segment.id}
							ref={(node) => {
								if (node) segmentRefs.current.set(index, node);
								else segmentRefs.current.delete(index);
							}}
							data-transcript-segment
							data-dirty={dirty ? "true" : undefined}
						>
							<button
								type="button"
								className={styles.timestamp}
								title="Copiar referência deste timestamp"
								onClick={() => void copyReference(index)}
							>
								{formatTranscriptTimestamp(segment.startMs, false)}
							</button>
							{active ? (
								<InlineSegmentEditor
									disabled={phase === "saving" || Boolean(pendingSave)}
									segment={segment}
									onDraftChange={(draft) => {
										activeDraftRef.current = draft;
									}}
									onApply={setWorkingPatch}
									onCancel={() => {
										activeDraftRef.current = null;
										setActiveId(null);
									}}
									onSave={(draft) => void saveWorkingCopy(draft)}
								/>
							) : (
								<>
									<strong className={styles.speaker}>
										{highlighted(segment.speaker, normalizedQuery)}
									</strong>
									<p className={styles.text}>
										{highlighted(segment.text, normalizedQuery)}
									</p>
									{editMode ? (
										<div className={styles.segmentActions}>
											{dirty ? <span>Editada</span> : null}
											<Button
												disabled={Boolean(pendingSave)}
												onClick={() => {
													setActiveId(segment.id);
													setPhase("idle");
													setMessage(null);
												}}
												size="sm"
												variant="tertiary"
											>
												Editar
											</Button>
											{dirty ? (
												<Button
													disabled={Boolean(pendingSave)}
													onClick={() => revertSegment(segment.id)}
													size="sm"
													variant="tertiary"
												>
													Reverter fala
												</Button>
											) : null}
										</div>
									) : null}
								</>
							)}
						</article>
					);
				})}
				{visibleCount < effectiveSegments.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!effectiveSegments.length ? (
					<p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p>
				) : null}
			</section>
		</div>
	);
}
