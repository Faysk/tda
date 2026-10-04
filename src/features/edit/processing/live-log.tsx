"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "@/components/ui";
import {
	activityContext,
	activityEventCanBeHumorous,
	selectActivityBark,
	type ActivityBark,
} from "./activity-barks";
import { presentJobEvent } from "./presentation";
import type { JobEvent, LocalJob, SystemSnapshot } from "./protocol";
import {
	GROUPABLE_LIVE_LOG_CODES,
	liveLogEventIsUrgent,
	planLiveLogReveal,
	scheduleLiveLogReveal,
} from "./live-log-pacing";
import styles from "./processing.module.css";

type Row =
	| Readonly<{ kind: "event"; event: JobEvent }>
	| Readonly<{ kind: "group"; events: readonly JobEvent[]; code: string }>;

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
			GROUPABLE_LIVE_LOG_CODES.has(event.code) &&
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
	animate,
	durationMs,
}: Readonly<{ text: string; animate: boolean; durationMs: number }>) {
	const words = useMemo(() => text.split(/\s+/u).filter(Boolean), [text]);
	const [visibleWords, setVisibleWords] = useState(() =>
		animate ? Math.min(1, words.length) : words.length,
	);

	useEffect(() => {
		if (!animate || words.length <= 1) {
			setVisibleWords(words.length);
			return;
		}
		setVisibleWords(1);
		const stepMs = Math.max(24, Math.round(durationMs / words.length));
		const timer = window.setInterval(() => {
			setVisibleWords((current) => {
				if (current >= words.length) {
					window.clearInterval(timer);
					return current;
				}
				return current + 1;
			});
		}, stepMs);
		return () => window.clearInterval(timer);
	}, [animate, durationMs, words.length]);

	if (!animate) return <>{text}</>;
	return (
		<>
			<span className={styles.visuallyHidden}>{text}</span>
			<span aria-hidden="true">{words.slice(0, visibleWords).join(" ")}</span>
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
	const [paused, setPaused] = useState(false);
	const [snapshot, setSnapshot] = useState<readonly JobEvent[]>(() => boundedEvents(events));
	const initialSeq = snapshot.at(-1)?.seq ?? null;
	const [revealedSeq, setRevealedSeq] = useState<number | null>(initialSeq);
	const [typeDurationMs, setTypeDurationMs] = useState(0);
	const [reducedMotion, setReducedMotion] = useState(false);
	const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const nearBottom = useRef(true);
	const revealedSeqRef = useRef<number | null>(initialSeq);
	const pacingCancel = useRef<null | (() => void)>(null);
	const animationCutoffSeq = useRef<number | null>(initialSeq);
	const latestEventsRef = useRef(events);
	latestEventsRef.current = events;
	const observedEventBatchRef = useRef(events);
	const previousEventBatchAtRef = useRef<number | null>(performance.now());
	const latestSnapshotSeq = snapshot.at(-1)?.seq ?? null;

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		let observedPollGapMs: number | undefined;
		if (observedEventBatchRef.current !== events) {
			const observedAt = performance.now();
			const previousObservedAt = previousEventBatchAtRef.current;
			observedPollGapMs =
				previousObservedAt === null
					? undefined
					: Math.max(0, observedAt - previousObservedAt);
			previousEventBatchAtRef.current = observedAt;
			observedEventBatchRef.current = events;
		}
		if (paused) return;
		const next = boundedEvents(events);
		setSnapshot(next);
		const latest = next.at(-1)?.seq ?? null;

		pacingCancel.current?.();
		pacingCancel.current = null;

		if (!live || mode === "technical" || reducedMotion || document.visibilityState === "hidden") {
			revealedSeqRef.current = latest;
			setRevealedSeq(latest);
			animationCutoffSeq.current = latest;
			return;
		}

		const plan = planLiveLogReveal(
			next,
			revealedSeqRef.current,
			expectedPollMs,
			observedPollGapMs,
		);
		if (!plan.steps.length) return;
		setTypeDurationMs(plan.typeDurationMs);

		if (plan.flushAll) {
			revealedSeqRef.current = latest;
			setRevealedSeq(latest);
			animationCutoffSeq.current = latest;
			return;
		}

		pacingCancel.current = scheduleLiveLogReveal(plan, (throughSeq) => {
			const current = revealedSeqRef.current;
			const nextSeq = current === null ? throughSeq : Math.max(current, throughSeq);
			revealedSeqRef.current = nextSeq;
			setRevealedSeq(nextSeq);
		});

		return () => {
			pacingCancel.current?.();
			pacingCancel.current = null;
		};
	}, [events, expectedPollMs, live, mode, paused, reducedMotion]);

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState !== "hidden") return;
			pacingCancel.current?.();
			pacingCancel.current = null;
			const next = boundedEvents(latestEventsRef.current);
			setSnapshot(next);
			const latest = next.at(-1)?.seq ?? null;
			revealedSeqRef.current = latest;
			setRevealedSeq(latest);
			animationCutoffSeq.current = latest;
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", onVisibilityChange);
			pacingCancel.current?.();
		};
	}, []);

	useEffect(() => {
		if (!paused && nearBottom.current && revealedSeq !== null) {
			requestAnimationFrame(() => {
				const node = scroller.current;
				if (node) node.scrollTop = node.scrollHeight;
			});
		}
	}, [revealedSeq, paused]);

	const boundedCurrentEvents = useMemo(() => boundedEvents(events), [events]);
	const visibleSnapshot = useMemo(
		() =>
			revealedSeq === null
				? []
				: snapshot.filter((event) => event.seq <= revealedSeq),
		[snapshot, revealedSeq],
	);
	const filtersActive =
		Boolean(query.trim()) ||
		level !== "all" ||
		code !== "all" ||
		speaker !== "all" ||
		track !== "all";
	const filtered = useMemo(
		() =>
			(filtersActive ? boundedCurrentEvents : visibleSnapshot).filter((event) =>
				matches(event, query.trim(), level, code, speaker, track),
			),
		[
			filtersActive,
			boundedCurrentEvents,
			visibleSnapshot,
			query,
			level,
			code,
			speaker,
			track,
		],
	);
	const rows = useMemo(
		() => groupRows(filtered, mode === "humanized"),
		[filtered, mode],
	);
	const assistiveAnnouncement = useMemo(() => {
		for (let index = snapshot.length - 1; index >= 0; index -= 1) {
			const event = snapshot[index];
			if (!event || GROUPABLE_LIVE_LOG_CODES.has(event.code)) continue;
			if (event.level === "info" && event.code.endsWith("_STARTED")) continue;
			const presented = humanText(event, job, system, activityCatalog);
			return presented.detail
				? `${presented.title}. ${presented.detail}`
				: presented.title;
		}
		return "";
	}, [snapshot, job, system, activityCatalog]);
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
						.filter((value): value is string => typeof value === "string" && Boolean(value)),
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
						.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
						.map(String),
				),
			].sort((left, right) => Number(left) - Number(right)),
		[boundedCurrentEvents],
	);

	function flushVisualTail(nextEvents: readonly JobEvent[]) {
		pacingCancel.current?.();
		pacingCancel.current = null;
		const latest = nextEvents.at(-1)?.seq ?? null;
		revealedSeqRef.current = latest;
		setRevealedSeq(latest);
		animationCutoffSeq.current = latest;
	}

	function pauseVisualization() {
		if (paused) return;
		flushVisualTail(snapshot);
		setPaused(true);
	}

	function togglePause() {
		if (paused) catchUp();
		else pauseVisualization();
	}

	function catchUp() {
		const next = boundedEvents(events);
		setSnapshot(next);
		flushVisualTail(next);
		setPaused(false);
		nearBottom.current = true;
	}

	function changeMode(nextMode: "humanized" | "technical") {
		const next = boundedEvents(events);
		setSnapshot(next);
		flushVisualTail(next);
		setMode(nextMode);
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
						onClick={() => changeMode("humanized")}
					>
						Humanizada
					</button>
					<button
						type="button"
						aria-pressed={mode === "technical"}
						onClick={() => changeMode("technical")}
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
				<Select
					value={level}
					options={[
						{ value: "all", label: "Todos os níveis" },
						{ value: "info", label: "Info" },
						{ value: "warning", label: "Warning" },
						{ value: "error", label: "Erro" },
					]}
					onChange={(value) => setLevel(value as typeof level)}
					ariaLabel="Filtrar por nível"
					compact
				/>
				<Select
					value={code}
					options={[
						{ value: "all", label: "Todos os codes" },
						...codeOptions.map((value) => ({ value, label: value })),
					]}
					onChange={setCode}
					ariaLabel="Filtrar por code"
					compact
				/>
				<Select
					value={speaker}
					options={[
						{ value: "all", label: "Todos os speakers" },
						...speakerOptions.map((value) => ({ value, label: value })),
					]}
					onChange={setSpeaker}
					ariaLabel="Filtrar por speaker"
					compact
				/>
				<Select
					value={track}
					options={[
						{ value: "all", label: "Todas as tracks" },
						...trackOptions.map((value) => ({ value, label: `Track ${value}` })),
					]}
					onChange={setTrack}
					ariaLabel="Filtrar por track"
					compact
				/>
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
					if (!nearBottom.current && live && !paused) pauseVisualization();
				}}
			>
				{rows.length ? (
					rows.map((row) => {
						if (row.kind === "group") {
							const first = row.events[0];
							const last = row.events.at(-1);
							if (!first || !last) return null;
							const animate =
								live &&
								!paused &&
								!reducedMotion &&
								!filtersActive &&
								(animationCutoffSeq.current === null ||
									last.seq > animationCutoffSeq.current);
							const humanizedGroup = humanText(
								last,
								job,
								system,
								activityCatalog,
							);
							const groupTitle = `${humanizedGroup.title} · × ${row.events.length}`;
							return (
								<button
									type="button"
									key={`group-${first.seq}-${last.seq}`}
									className={styles.logEntry}
									data-level="info"
									data-event-seq={last.seq}
									onClick={() => setSelectedSeq(last.seq)}
								>
									<time dateTime={last.at}>{formatTime(last.at)}</time>
									<div>
										<span>
											<PacedHumanText
												text={groupTitle}
												animate={animate}
												durationMs={typeDurationMs}
											/>
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
						const urgent = liveLogEventIsUrgent(row.event);
						const animate =
							live &&
							!paused &&
							!reducedMotion &&
							!filtersActive &&
							!urgent &&
							(animationCutoffSeq.current === null ||
								row.event.seq > animationCutoffSeq.current);
						return (
							<button
								type="button"
								className={`${styles.logEntry} ${
									mode === "technical" && animate ? styles.logEntryReveal : ""
								}`}
								key={row.event.seq}
								data-level={row.event.level}
								data-event-seq={row.event.seq}
								onClick={() => setSelectedSeq(row.event.seq)}
							>
								<time dateTime={row.event.at}>
									{formatTime(row.event.at)}
								</time>
								<div>
									<span>
										{mode === "humanized" ? (
											<PacedHumanText
												text={presented.title}
												animate={animate}
												durationMs={typeDurationMs}
											/>
										) : (
											presented.title
										)}
									</span>
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
