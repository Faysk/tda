"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
	activityContext,
	activityEventCanBeHumorous,
	selectActivityBark,
	type ActivityBark,
} from "./activity-barks";
import {
	buildLiveLogRevealPlan,
	scheduleLiveLogRevealPlan,
} from "./live-log-pacing";
import { presentJobEvent } from "./presentation";
import type { JobEvent, LocalJob, SystemSnapshot } from "./protocol";
import styles from "./processing.module.css";

type Row =
	| Readonly<{ kind: "event"; event: JobEvent }>
	| Readonly<{ kind: "group"; events: readonly JobEvent[]; code: string }>;

const GROUPABLE = new Set([
	"QWEN_WINDOW_TRANSCRIBED",
	"WHISPER_SEGMENT_TRANSCRIBED",
]);
const MAX_VISIBLE_EVENTS = 500;

function boundedEvents(events: readonly JobEvent[]): readonly JobEvent[] {
	return events.length <= MAX_VISIBLE_EVENTS
		? events
		: events.slice(events.length - MAX_VISIBLE_EVENTS);
}

function humanText(
	event: JobEvent,
	job: LocalJob,
	system: SystemSnapshot | null,
	activityCatalog: readonly ActivityBark[],
) {
	const factual = presentJobEvent(event);
	const bark = activityEventCanBeHumorous(event)
		? selectActivityBark(activityContext(event, job, system), { level: "tda", catalog: activityCatalog })
		: null;
	return bark ? { title: bark.text, detail: factual.detail } : factual;
}

function groupRows(events: readonly JobEvent[], enabled: boolean): Row[] {
	if (!enabled) return events.map((event) => ({ kind: "event", event }));

	const rows: Row[] = [];
	for (const event of events) {
		const previous = rows.at(-1);
		const joinsPrevious =
			previous &&
			GROUPABLE.has(event.code) &&
			event.level === "info" &&
			((previous.kind === "event" &&
				previous.event.code === event.code &&
				previous.event.level === "info") ||
				(previous.kind === "group" && previous.code === event.code));

		if (joinsPrevious && previous) {
			const priorEvents =
				previous.kind === "event"
					? [previous.event]
					: [...previous.events];
			rows[rows.length - 1] = {
				kind: "group",
				code: event.code,
				events: [...priorEvents, event],
			};
			continue;
		}

		rows.push({ kind: "event", event });
	}
	return rows;
}

function matches(
	event: JobEvent,
	query: string,
	level: string,
	code: string,
	speaker: string,
	track: string,
): boolean {
	if (level !== "all" && event.level !== level) return false;
	if (code !== "all" && event.code !== code) return false;
	if (speaker !== "all" && event.data.speaker !== speaker) return false;
	if (track !== "all" && String(event.data.track ?? "") !== track) return false;
	if (!query) return true;

	const needle = query.toLocaleLowerCase("pt-BR");
	const haystack = [
		event.code,
		event.at,
		String(event.attempt ?? ""),
		...Object.entries(event.data).flatMap(([key, value]) => [
			key,
			String(value ?? ""),
		]),
	]
		.join(" ")
		.toLocaleLowerCase("pt-BR");

	return haystack.includes(needle);
}

function formatTime(value: string) {
	const date = new Date(value);
	return Number.isFinite(date.getTime())
		? date.toLocaleTimeString("pt-BR", {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			})
		: "—";
}

function historyCount(value: number): string {
	return `${value} mais recente${value === 1 ? "" : "s"}`;
}

function PacedHumanText({
	text,
	durationMs,
}: Readonly<{ text: string; durationMs: number }>) {
	if (durationMs <= 0) return <span>{text}</span>;
	const words = [...text.trim().matchAll(/\S+/gu)].map((match) => ({
		value: match[0],
		offset: match.index,
	}));
	const delayMs = durationMs / Math.max(words.length, 1);
	return (
		<span>
			<span className={styles.visuallyHidden}>{text}</span>
			<span className={styles.pacedWords} aria-hidden="true">
				{words.map((word, index) => (
					<span
						key={`${word.offset}-${word.value}`}
						className={styles.pacedWord}
						style={{ animationDelay: `${Math.round(index * delayMs)}ms` }}
					>
						{word.value}{index < words.length - 1 ? " " : ""}
					</span>
				))}
			</span>
		</span>
	);
}

export function ProcessingLiveLog({
	events,
	job,
	system,
	live,
	stale,
	expectedPollMs,
	activityCatalog,
}: Readonly<{
	events: readonly JobEvent[];
	job: LocalJob;
	system: SystemSnapshot | null;
	live: boolean;
	stale: boolean;
	expectedPollMs: number;
	activityCatalog: readonly ActivityBark[];
}>) {
	const [mode, setMode] = useState<"humanized" | "technical">("humanized");
	const [query, setQuery] = useState("");
	const [level, setLevel] = useState<"all" | JobEvent["level"]>("all");
	const [code, setCode] = useState("all");
	const [speaker, setSpeaker] = useState("all");
	const [track, setTrack] = useState("all");
	const [grouped, setGrouped] = useState(true);
	const [paused, setPaused] = useState(false);
	const boundedCurrentEvents = useMemo(() => boundedEvents(events), [events]);
	const [snapshot, setSnapshot] = useState<readonly JobEvent[]>(() =>
		boundedEvents(events),
	);
	const [typeDurationBySeq, setTypeDurationBySeq] = useState<
		ReadonlyMap<number, number>
	>(() => new Map());
	const [reducedMotion, setReducedMotion] = useState(false);
	const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const nearBottom = useRef(true);
	const snapshotRef = useRef<readonly JobEvent[]>(snapshot);
	const revealCancelRef = useRef<() => void>(() => undefined);
	const lastEventsRef = useRef(events);
	const previousEventBatchAtRef = useRef<number | null>(performance.now());
	const skipAnimationThroughSeq = useRef(snapshot.at(-1)?.seq ?? 0);
	const latestSnapshotSeq = snapshot.at(-1)?.seq ?? null;

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReducedMotion(media.matches);
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, []);

	useEffect(() => {
		let observedPollGapMs: number | undefined;
		if (lastEventsRef.current !== events) {
			const now = performance.now();
			const previous = previousEventBatchAtRef.current;
			observedPollGapMs =
				previous === null ? undefined : Math.max(0, now - previous);
			previousEventBatchAtRef.current = now;
			lastEventsRef.current = events;
		}

		revealCancelRef.current();
		revealCancelRef.current = () => undefined;
		if (paused) return;

		const next = boundedEvents(events);
		const current = snapshotRef.current;
		const currentLastSeq = current.at(-1)?.seq ?? null;
		const sequenceReset =
			currentLastSeq !== null &&
			next.length > 0 &&
			!next.some((event) => event.seq === currentLastSeq);

		if (
			!live ||
			reducedMotion ||
			document.hidden ||
			currentLastSeq === null ||
			sequenceReset
		) {
			skipAnimationThroughSeq.current =
				next.at(-1)?.seq ?? skipAnimationThroughSeq.current;
			snapshotRef.current = next;
			setSnapshot(next);
			setTypeDurationBySeq(new Map());
			return;
		}

		const pending = next.filter((event) => event.seq > currentLastSeq);
		if (!pending.length) {
			if (next.length !== current.length) {
				snapshotRef.current = next;
				setSnapshot(next);
			}
			return;
		}

		const plan = buildLiveLogRevealPlan(
			pending,
			expectedPollMs,
			observedPollGapMs,
			grouped,
		);
		revealCancelRef.current = scheduleLiveLogRevealPlan(plan, (step) => {
			if (step.typeDurationMs > 0) {
				setTypeDurationBySeq((currentDurations) => {
					const updated = new Map(currentDurations);
					if (updated.size > MAX_VISIBLE_EVENTS * 2) updated.clear();
					for (const event of step.events) {
						updated.set(event.seq, step.typeDurationMs);
					}
					return updated;
				});
			}
			setSnapshot((currentSnapshot) => {
				const lastSeq = currentSnapshot.at(-1)?.seq ?? null;
				const additions = step.events.filter(
					(event) => lastSeq === null || event.seq > lastSeq,
				);
				if (!additions.length) return currentSnapshot;
				const updated = boundedEvents([...currentSnapshot, ...additions]);
				snapshotRef.current = updated;
				return updated;
			});
		});

		return () => {
			revealCancelRef.current();
			revealCancelRef.current = () => undefined;
		};
	}, [events, expectedPollMs, grouped, live, paused, reducedMotion]);

	useEffect(() => {
		const handleVisibility = () => {
			if (!document.hidden) return;
			revealCancelRef.current();
			revealCancelRef.current = () => undefined;
			const next = boundedEvents(events);
			skipAnimationThroughSeq.current =
				next.at(-1)?.seq ?? skipAnimationThroughSeq.current;
			snapshotRef.current = next;
			setSnapshot(next);
			setTypeDurationBySeq(new Map());
		};
		document.addEventListener("visibilitychange", handleVisibility);
		return () =>
			document.removeEventListener("visibilitychange", handleVisibility);
	}, [events]);

	useEffect(() => {
		if (!paused && nearBottom.current && latestSnapshotSeq !== null) {
			requestAnimationFrame(() => {
				const node = scroller.current;
				if (node) node.scrollTop = node.scrollHeight;
			});
		}
	}, [latestSnapshotSeq, paused]);

	const inspectionActive =
		Boolean(query.trim()) ||
		level !== "all" ||
		code !== "all" ||
		speaker !== "all" ||
		track !== "all";
	const displaySnapshot = inspectionActive ? boundedCurrentEvents : snapshot;
	const filtered = useMemo(
		() =>
			displaySnapshot.filter((event) =>
				matches(event, query.trim(), level, code, speaker, track),
			),
		[displaySnapshot, query, level, code, speaker, track],
	);
	const rows = useMemo(() => groupRows(filtered, grouped), [filtered, grouped]);
	const assistiveAnnouncement = useMemo(() => {
		for (let index = boundedCurrentEvents.length - 1; index >= 0; index -= 1) {
			const event = boundedCurrentEvents[index];
			if (!event || GROUPABLE.has(event.code)) continue;
			if (event.level === "info" && event.code.endsWith("_STARTED")) continue;
			const presented = humanText(event, job, system, activityCatalog);
			return presented.detail
				? `${presented.title}. ${presented.detail}`
				: presented.title;
		}
		return "";
	}, [boundedCurrentEvents, job, system, activityCatalog]);
	const selected =
		boundedCurrentEvents.find((event) => event.seq === selectedSeq) ?? null;
	const newEventCount = paused
		? boundedCurrentEvents.filter(
				(event) => latestSnapshotSeq === null || event.seq > latestSnapshotSeq,
			).length
		: 0;
	const codeOptions = useMemo(
		() => [...new Set(boundedCurrentEvents.map((event) => event.code))].sort(),
		[boundedCurrentEvents],
	);
	const speakerOptions = useMemo(
		() =>
			[
				...new Set(
					boundedCurrentEvents
						.map((event) => event.data.speaker)
						.filter(
							(value): value is string =>
								typeof value === "string" && Boolean(value),
						),
				),
			].sort(),
		[boundedCurrentEvents],
	);
	const trackOptions = useMemo(
		() =>
			[
				...new Set(
					boundedCurrentEvents
						.map((event) => event.data.track)
						.filter(
							(value): value is number =>
								typeof value === "number" && Number.isFinite(value),
						)
						.map(String),
				),
			].sort((left, right) => Number(left) - Number(right)),
		[boundedCurrentEvents],
	);

	function flushVisualSnapshot() {
		revealCancelRef.current();
		revealCancelRef.current = () => undefined;
		skipAnimationThroughSeq.current =
			boundedCurrentEvents.at(-1)?.seq ?? skipAnimationThroughSeq.current;
		snapshotRef.current = boundedCurrentEvents;
		setSnapshot(boundedCurrentEvents);
		setTypeDurationBySeq(new Map());
	}

	function inspectFactualBuffer() {
		flushVisualSnapshot();
	}

	function switchMode(nextMode: "humanized" | "technical") {
		inspectFactualBuffer();
		setMode(nextMode);
	}

	function togglePause() {
		if (paused) {
			flushVisualSnapshot();
			nearBottom.current = true;
			setPaused(false);
			return;
		}
		revealCancelRef.current();
		revealCancelRef.current = () => undefined;
		setPaused(true);
	}

	function catchUp() {
		flushVisualSnapshot();
		setPaused(false);
		nearBottom.current = true;
	}

	return (
		<section
			className={styles.liveLogExplorer}
			aria-label="Explorador de eventos do processamento"
		>
			<div className={styles.logHeader}>
				<div>
					<h3>{live ? "Log em tempo real" : "Histórico de eventos"}</h3>
					<span>
						{paused
							? "visualização pausada"
							: live
								? "● ao vivo"
								: historyCount(snapshot.length)}
					</span>
				</div>
				<fieldset className={styles.logModeSwitch}>
					<legend className={styles.visuallyHidden}>Apresentação do log</legend>
					<button
						type="button"
						aria-pressed={mode === "humanized"}
						onClick={() => switchMode("humanized")}
					>
						Humanizada
					</button>
					<button
						type="button"
						aria-pressed={mode === "technical"}
						onClick={() => switchMode("technical")}
					>
						Técnica
					</button>
				</fieldset>
			</div>

			{stale ? (
				<p role="status">
					Eventos desatualizados. O último histórico disponível foi preservado.
				</p>
			) : null}

			<div className={styles.logToolbar}>
				<label>
					<span className={styles.visuallyHidden}>Filtrar eventos</span>
					<input
						className={styles.logSearch}
						value={query}
						onChange={(event) => {
						inspectFactualBuffer();
						setQuery(event.target.value);
					}}
						placeholder="Buscar code, speaker, stage…"
					/>
				</label>
				<select
					value={level}
					onChange={(event) => {
						inspectFactualBuffer();
						setLevel(event.target.value as typeof level);
					}}
					aria-label="Filtrar por nível"
				>
					<option value="all">Todos os níveis</option>
					<option value="info">Info</option>
					<option value="warning">Warning</option>
					<option value="error">Erro</option>
				</select>
				<select
					value={code}
					onChange={(event) => {
						inspectFactualBuffer();
						setCode(event.target.value);
					}}
					aria-label="Filtrar por code"
				>
					<option value="all">Todos os codes</option>
					{codeOptions.map((value) => (
						<option key={value} value={value}>{value}</option>
					))}
				</select>
				<select
					value={speaker}
					onChange={(event) => {
						inspectFactualBuffer();
						setSpeaker(event.target.value);
					}}
					aria-label="Filtrar por speaker"
				>
					<option value="all">Todos os speakers</option>
					{speakerOptions.map((value) => (
						<option key={value} value={value}>{value}</option>
					))}
				</select>
				<select
					value={track}
					onChange={(event) => {
						inspectFactualBuffer();
						setTrack(event.target.value);
					}}
					aria-label="Filtrar por track"
				>
					<option value="all">Todas as tracks</option>
					{trackOptions.map((value) => (
						<option key={value} value={value}>Track {value}</option>
					))}
				</select>
				<label className={styles.logToggle}>
					<input
						type="checkbox"
						checked={grouped}
						onChange={(event) => {
						inspectFactualBuffer();
						setGrouped(event.target.checked);
					}}
					/>
					Agrupar repetitivos
				</label>
				<button type="button" onClick={togglePause}>
					{paused ? "Retomar visualização" : "Pausar visualização"}
				</button>
			</div>

			<p className={styles.visuallyHidden} role="status" aria-live="polite">
				{assistiveAnnouncement}
			</p>

			<div
				ref={scroller}
				className={`${styles.log} ${rows.length ? "" : styles.logEmpty}`}
				role="log"
				aria-label="Eventos do processamento local"
				aria-live="off"
				aria-relevant="additions"
				onScroll={(event) => {
					const node = event.currentTarget;
					nearBottom.current =
						node.scrollHeight - node.scrollTop - node.clientHeight < 48;
					if (!nearBottom.current && live && !paused) {
						revealCancelRef.current();
						revealCancelRef.current = () => undefined;
						setPaused(true);
					}
				}}
			>
				{rows.length ? (
					rows.map((row) => {
						if (row.kind === "group") {
							const first = row.events[0];
							const last = row.events.at(-1);
							if (!first || !last) return null;
							const speaker =
								typeof last.data.speaker === "string"
									? last.data.speaker
									: null;
							return (
								<button
									type="button"
									key={`group-${first.seq}-${last.seq}`}
									className={`${styles.logEntry} ${live && !paused && !reducedMotion && last.seq > skipAnimationThroughSeq.current && (typeDurationBySeq.get(last.seq) ?? 0) > 0 ? styles.logEntryReveal : ""}`}
									data-level="info"
									onClick={() => setSelectedSeq(last.seq)}
								>
									<time dateTime={last.at}>{formatTime(last.at)}</time>
									<div>
										<span>
											{row.code} × {row.events.length}
											{speaker ? ` · ${speaker}` : ""}
										</span>
										<small>
											seq {first.seq}–{last.seq} · evento mais recente no
											inspector
										</small>
									</div>
								</button>
							);
						}

						const factual = presentJobEvent(row.event);
						const presented =
							mode === "humanized"
								? humanText(row.event, job, system, activityCatalog)
								: factual;
						return (
							<button
								type="button"
								className={`${styles.logEntry} ${live && !paused && !reducedMotion && row.event.seq > skipAnimationThroughSeq.current && (typeDurationBySeq.get(row.event.seq) ?? 0) > 0 ? styles.logEntryReveal : ""}`}
								key={row.event.seq}
								data-level={row.event.level}
								onClick={() => setSelectedSeq(row.event.seq)}
							>
								<time dateTime={row.event.at}>
									{formatTime(row.event.at)}
								</time>
								<div>
									<PacedHumanText
									text={presented.title}
									durationMs={
										mode === "humanized" &&
										live &&
										!paused &&
										!reducedMotion &&
										row.event.seq > skipAnimationThroughSeq.current
											? (typeDurationBySeq.get(row.event.seq) ?? 0)
											: 0
									}
								/>
									{presented.detail ? (
										<small>{presented.detail}</small>
									) : null}
									{mode === "technical" ? (
										<small>
											{row.event.code} · seq {row.event.seq}
										</small>
									) : null}
								</div>
							</button>
						);
					})
				) : (
					<p>Nenhum evento corresponde aos filtros atuais.</p>
				)}
			</div>

			{events.length > MAX_VISIBLE_EVENTS ? (
				<p className={styles.logBoundedNote} role="status">
					Mostrando os {MAX_VISIBLE_EVENTS} eventos mais recentes para manter a visualização responsiva.
				</p>
			) : null}

			{paused && newEventCount > 0 ? (
				<button
					type="button"
					className={styles.logCatchup}
					onClick={catchUp}
				>
					{newEventCount} novos eventos · Voltar ao vivo
				</button>
			) : null}

			{selected ? (
				<details className={styles.logInspector} open>
					<summary>Detalhe · {selected.code}</summary>
					<dl>
						<div>
							<dt>Seq</dt>
							<dd>{selected.seq}</dd>
						</div>
						<div>
							<dt>Attempt</dt>
							<dd>{selected.attempt ?? "—"}</dd>
						</div>
						<div>
							<dt>Nível</dt>
							<dd>{selected.level}</dd>
						</div>
						<div>
							<dt>Timestamp</dt>
							<dd>{selected.at}</dd>
						</div>
					</dl>
					<pre>{JSON.stringify(selected.data, null, 2)}</pre>
				</details>
			) : null}
		</section>
	);
}
