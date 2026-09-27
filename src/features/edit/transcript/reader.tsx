"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
	findTranscriptJumpIndex,
	formatTranscriptTimestamp,
	parseTranscriptTimestamp,
	type TranscriptReaderSegment,
} from "./reader-contract";
import styles from "./reader.module.css";

const INITIAL_VISIBLE = 300;
const VISIBLE_STEP = 300;

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

export function TranscriptReader({
	segments,
	sourceLabel,
	downloadHref,
}: Readonly<{
	segments: readonly TranscriptReaderSegment[];
	sourceLabel: string;
	downloadHref: string;
}>) {
	const [query, setQuery] = useState("");
	const [matchCursor, setMatchCursor] = useState(-1);
	const [jumpValue, setJumpValue] = useState("");
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(INITIAL_VISIBLE, segments.length),
	);
	const segmentRefs = useRef(new Map<number, HTMLElement>());
	const sentinelRef = useRef<HTMLDivElement>(null);
	const normalizedQuery = normalizeSearch(query);
	const matches = useMemo(() => {
		if (!normalizedQuery) return [] as number[];
		const result: number[] = [];
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index];
			if (
				segment.text.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
				segment.speaker.toLocaleLowerCase("pt-BR").includes(normalizedQuery)
			)
				result.push(index);
		}
		return result;
	}, [normalizedQuery, segments]);

	function revealAndScroll(index: number) {
		if (index < 0) return;
		setVisibleCount((current) => Math.max(current, Math.min(segments.length, index + 30)));
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
		const reference = `${formatTranscriptTimestamp(segment.startMs)} · ${segment.speaker}`;
		try {
			await navigator.clipboard.writeText(reference);
		} catch {
			/* Clipboard may be unavailable; timestamp remains selectable. */
		}
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

	const visible = segments.slice(0, visibleCount);

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
			</div>

			<div className={styles.timeline} aria-label="Transcrição completa">
				{visible.map((segment, index) => (
					<article
						id={`segment-${encodeURIComponent(segment.id)}`}
						className={styles.segment}
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
						<strong className={styles.speaker}>
							{highlighted(segment.speaker, normalizedQuery)}
						</strong>
						<p className={styles.text}>{highlighted(segment.text, normalizedQuery)}</p>
					</article>
				))}
				{visibleCount < segments.length ? (
					<div ref={sentinelRef} className={styles.more} aria-hidden="true" />
				) : null}
				{!segments.length ? <p className={styles.empty}>Nenhuma fala disponível nesta sessão.</p> : null}
			</div>
		</div>
	);
}
