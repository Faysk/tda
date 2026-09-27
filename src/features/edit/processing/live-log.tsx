"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	activityContext,
	activityEventCanBeHumorous,
	selectActivityBark,
	type ActivityBark,
} from "./activity-barks";
import {
	buildLiveLogRevealPlan,
	scheduleLiveLogReveal,
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

function PacedLogText({
	text,
	animate,
	durationMs,
}: Readonly<{
	text: string;
	animate: boolean;
	durationMs: number;
}>) {
	const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
	const [visibleWords, setVisibleWords] = useState(() =>
		animate ? Math.min(1, words.length) : words.length,
	);

	useEffect(() => {
		if (!animate || words.length <= 1) {
			setVisibleWords(words.length);
			return;
		}
		setVisibleWords(1);
		const delay = Math.max(30, Math.floor(durationMs / words.length));
		const timers: ReturnType<typeof setTimeout>[] = [];
		for (let index = 2; index <= words.length; index += 1) {
			timers.push(setTimeout(() => setVisibleWords(index), delay * (index - 1)));
		}
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, [animate, durationMs, words]);

	if (!animate) return <span>{text}</span>;

	return (
		<>
			<span aria-hidden="true" data-live-log-typewriter="true">
				{words.slice(0, visibleWords).join(" ")}
			</span>
			<span className={styles.visuallyHidden}>{text}</span>
		</>
	);
}

export function ProcessingLiveLog({
	events,
	job,
	system,
	live,
	stale,
	activityCatalog,
	expectedPollMs,
}: Readonly<{
	events: readonly JobEvent[];
	job: LocalJob;
	system: SystemSnapshot | null;
	live: boolean;
	stale: boolean;
	activityCatalog: readonly ActivityBark[];
	expectedPollMs: number;
}>) {
	const [mode, setMode] = useState<"humanized" | "technical">("humanized");
	const [query, setQuery] = useState("");
	const [level, setLevel] = useState<"all" | JobEvent["level"]>("all");
	const [code, setCode] = useState("all");
	const [speaker, setSpeaker] = useState("all");
	const [track, setTrack] = useState("all");
	const [grouped, setGrouped] = useState(true);
	const [paused, setPaused] = useState(false);
	const factualEvents = useMemo(() => boundedEvents(events), [events]);
	const initialLatestSeq = useRef(factualEvents.at(-1)?.seq ?? null);
	const revealedThroughRef = useRef<number | null>(initialLatestSeq.current);
	const [revealedThroughSeq, setRevealedThroughSeq] = useState<number | null>(
		initialLatestSeq.current,
	);
	const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
	const [reducedMotion, setReducedMotion] = useState(false);
	const [documentHidden, setDocumentHidden] = useState(false);
	const [typeDurationMs, setTypeDurationMs] = useState(180);
	const scroller = useRef<HTMLDivElement>(null);
	const nearBottom = useRef(true);
	const lastBatchAt = useRef<number | null>(null);
	const skipAnimationThrough = useRef(initialLatestSeq.current ?? -1);
	const latestFactualSeq = factualEvents.at(-1)?.seq ?? null;

	const revealThrough = useCallback((seq: number) => {
		const current = revealedThroughRef.current;
		if (current !== null && seq <= current) return;
		revealedThroughRef.current = seq;
		setRevealedThroughSeq(seq);
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReducedMotion(media.matches);
		sync();
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, []);

	useEffect(() => {
		const sync = () => setDocumentHidden(document.visibilityState !== "visible");
		sync();
		document.addEventListener("visibilitychange", sync);
		return () => document.removeEventListener("visibilitychange", sync);
	}, []);

	useEffect(() => {
		if (latestFactualSeq === null) {
			revealedThroughRef.current = null;
			setRevealedThroughSeq(null);
			return;
		}

		if (paused) return;

		if (!live || stale || reducedMotion || documentHidden) {
			skipAnimationThrough.current = latestFactualSeq;
			revealThrough(latestFactualSeq);
			lastBatchAt.current = performance.now();
			return;
		}

		const current = revealedThroughRef.current ?? -1;
		const pending = factualEvents.filter((event) => event.seq > current);
		if (!pending.length) return;

		const now = performance.now();
		const observedGap =
			lastBatchAt.current === null ? null : now - lastBatchAt.current;
		lastBatchAt.current = now;
		const plan = buildLiveLogRevealPlan(pending, expectedPollMs, observedGap);
		setTypeDurationMs(plan.typeDurationMs || 180);

		if (plan.immediateThroughSeq !== null) {
			skipAnimationThrough.current = Math.max(
				skipAnimationThrough.current,
				plan.immediateThroughSeq,
			);
			revealThrough(plan.immediateThroughSeq);
		}

		return scheduleLiveLogReveal(plan, revealThrough);
	}, [
		factualEvents,
		latestFactualSeq,
		live,
		stale,
		paused,
		reducedMotion,
		documentHidden,
		expectedPollMs,
		revealThrough,
	]);

	useEffect(() => {
		if (!paused && nearBottom.current && revealedThroughSeq !== null) {
			const frame = requestAnimationFrame(() => {
				const node = scroller.current;
				if (node) node.scrollTop = node.scrollHeight;
			});
			return () => cancelAnimationFrame(frame);
		}
	}, [revealedThroughSeq, paused]);

	const visuallyRevealedEvents = useMemo(
		() =>
			revealedThroughSeq === null
				? []
				: factualEvents.filter((event) => event.seq <= revealedThroughSeq),
		[factualEvents, revealedThroughSeq],
	);
	const hasActiveFilter =
		Boolean(query.trim()) ||
		level !== "all" ||
		code !== "all" ||
		speaker !== "all" ||
		track !== "all";
	const displayEvents = hasActiveFilter ? factualEvents : visuallyRevealedEvents;

	const filtered = useMemo(
		() =>
			displayEvents.filter((event) =>
				matches(event, query.trim(), level, code, speaker, track),
			),
		[displayEvents, query, level, code, speaker, track],
	);
	const rows = useMemo(
		() => groupRows(filtered, grouped),
		[filtered, grouped],
	);
	const assistiveAnnouncement = useMemo(() => {
		for (let index = factualEvents.length - 1; index >= 0; index -= 1) {
			const event = factualEvents[index];
			if (!event || GROUPABLE.has(event.code)) continue;
			if (event.level === "info" && event.code.endsWith("_STARTED")) continue;
			const presented = humanText(event, job, system, activityCatalog);
			return presented.detail
				? `${presented.title}. ${presented.detail}`
				: presented.title;
		}
		return "";
	}, [factualEvents, job, system, activityCatalog]);
	const selected =
		factualEvents.find((event) => event.seq === selectedSeq) ?? null;
	const newEventCount = paused
		? factualEvents.filter(
				(event) =>
					revealedThroughRef.current === null ||
					event.seq > revealedThroughRef.current,
			).length
		: 0;
	const codeOptions = useMemo(
		() => [...new Set(factualEvents.map((event) => event.code))].sort(),
		[factualEvents],
	);
	const speakerOptions = useMemo(
		() =>
			[
				...new Set(
					factualEvents
						.map((event) => event.data.speaker)
						.filter((value): value is string => typeof value === "string" && Boolean(value)),
				),
			].sort(),
		[factualEvents],
	);
	const trackOptions = useMemo(
		() =>
			[
				...new Set(
					factualEvents
						.map((event) => event.data.track)
						.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
						.map(String),
				),
			].sort((left, right) => Number(left) - Number(right)),
		[factualEvents],
	);

	function switchMode(next: "humanized" | "technical") {
		if (latestFactualSeq !== null) {
			skipAnimationThrough.current = latestFactualSeq;
			revealThrough(latestFactualSeq);
		}
		setMode(next);
	}

	function togglePause() {
		setPaused((value) => {
			const next = !value;
			if (value && latestFactualSeq !== null) {
				skipAnimationThrough.current = latestFactualSeq;
				revealThrough(latestFactualSeq);
			}
			return next;
		});
	}

	function catchUp() {
		if (latestFactualSeq !== null) {
			skipAnimationThrough.current = latestFactualSeq;
			revealThrough(latestFactualSeq);
		}
		setPaused(false);
		nearBottom.current = true;
	}

	return (
		<section
			className={styles.liveLogExplorer}
			aria-label="Explorador de eventos do processamento"
			data-live-log-revealed-through={revealedThroughSeq ?? ""}
			data-live-log-latest-seq={latestFactualSeq ?? ""}
			data-live-log-poll-ms={expectedPollMs}
		>
			<div className={styles.logHeader}>
				<div>
					<h3>{live ? "Log em tempo real" : "Histórico de eventos"}</h3>
					<span>
						{paused
							? "visualização pausada"
							: live
								? "● ao vivo"
								: historyCount(factualEvents.length)}
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
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Buscar code, speaker, stage…"
					/>
				</label>
				<select
					value={level}
					onChange={(event) =>
						setLevel(event.target.value as typeof level)
					}
					aria-label="Filtrar por nível"
				>
					<option value="all">Todos os níveis</option>
					<option value="info">Info</option>
					<option value="warning">Warning</option>
					<option value="error">Erro</option>
				</select>
				<select
					value={code}
					onChange={(event) => setCode(event.target.value)}
					aria-label="Filtrar por code"
				>
					<option value="all">Todos os codes</option>
					{codeOptions.map((value) => (
						<option key={value} value={value}>{value}</option>
					))}
				</select>
				<select
					value={speaker}
					onChange={(event) => setSpeaker(event.target.value)}
					aria-label="Filtrar por speaker"
				>
					<option value="all">Todos os speakers</option>
					{speakerOptions.map((value) => (
						<option key={value} value={value}>{value}</option>
					))}
				</select>
				<select
					value={track}
					onChange={(event) => setTrack(event.target.value)}
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
						onChange={(event) => setGrouped(event.target.checked)}
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
					if (!nearBottom.current && live && !paused) setPaused(true);
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
									key={`group-${first.seq}-${row.code}`}
									className={`${styles.logEntry} ${last.seq > skipAnimationThrough.current && !reducedMotion ? styles.logEntryReveal : ""}`}
									data-level="info"
									data-paced-seq={last.seq}
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
								className={`${styles.logEntry} ${row.event.seq > skipAnimationThrough.current && !reducedMotion ? styles.logEntryReveal : ""}`}
								key={row.event.seq}
								data-level={row.event.level}
								data-paced-seq={row.event.seq}
								onClick={() => setSelectedSeq(row.event.seq)}
							>
								<time dateTime={row.event.at}>
									{formatTime(row.event.at)}
								</time>
								<div>
									<PacedLogText
										text={presented.title}
										animate={
											mode === "humanized" &&
											!hasActiveFilter &&
											!paused &&
											!reducedMotion &&
											!documentHidden &&
											row.event.seq > skipAnimationThrough.current
										}
										durationMs={typeDurationMs}
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
