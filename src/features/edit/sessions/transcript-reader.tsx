"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "@/features/edit/workbench.module.css";
import type { SessionTranscriptSegment } from "./transcript-revision";

type Props = Readonly<{
	segments: readonly SessionTranscriptSegment[];
}>;

const CHUNK = 300;

function formatTimestamp(seconds: number, milliseconds = true): string {
	const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
	const millis = totalMilliseconds % 1000;
	const totalSeconds = Math.floor(totalMilliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const secs = totalSeconds % 60;
	const base = [hours, minutes, secs]
		.map((part) => String(part).padStart(2, "0"))
		.join(":");
	return milliseconds ? `${base}.${String(millis).padStart(3, "0")}` : base;
}

function parseTimestamp(value: string): number | null {
	const raw = value.trim();
	if (!raw) return null;
	if (/^\d+(?:\.\d+)?$/u.test(raw)) {
		const seconds = Number(raw);
		return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
	}
	const parts = raw.split(":");
	if (parts.length < 2 || parts.length > 3) return null;
	const numbers = parts.map(Number);
	if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;
	const [hours, minutes, seconds] =
		parts.length === 3 ? numbers : [0, numbers[0], numbers[1]];
	if (minutes >= 60 || seconds >= 60) return null;
	return hours * 3600 + minutes * 60 + seconds;
}

export function SessionTranscriptReader({ segments }: Props) {
	const [query, setQuery] = useState("");
	const [jump, setJump] = useState("");
	const [visibleCount, setVisibleCount] = useState(CHUNK);
	const [copyState, setCopyState] = useState<string | null>(null);
	const sentinel = useRef<HTMLDivElement>(null);
	const normalized = query.trim().toLocaleLowerCase("pt-BR");

	const matches = useMemo(() => {
		if (!normalized) return segments.map((segment, index) => ({ segment, index }));
		return segments.flatMap((segment, index) =>
			`${segment.speaker} ${segment.text}`
				.toLocaleLowerCase("pt-BR")
				.includes(normalized)
				? [{ segment, index }]
				: [],
		);
	}, [normalized, segments]);

	useEffect(() => {
		setVisibleCount(CHUNK);
	}, [normalized]);

	useEffect(() => {
		const node = sentinel.current;
		if (!node || visibleCount >= matches.length) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting))
					setVisibleCount((value) => Math.min(matches.length, value + CHUNK));
			},
			{ rootMargin: "800px 0px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [matches.length, visibleCount]);

	const visible = matches.slice(0, visibleCount);

	function jumpToTimestamp() {
		const target = parseTimestamp(jump);
		if (target === null) return;
		const index = segments.findIndex((segment) => segment.startSeconds >= target);
		const resolved = index >= 0 ? index : segments.length - 1;
		if (resolved < 0) return;
		setQuery("");
		setVisibleCount(Math.max(CHUNK, resolved + 50));
		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				document
					.getElementById(`transcript-segment-${resolved}`)
					?.scrollIntoView({ behavior: "smooth", block: "center" });
			});
		});
	}

	async function copyTimestamp(index: number, seconds: number) {
		const value = formatTimestamp(seconds);
		try {
			await navigator.clipboard.writeText(value);
			setCopyState(String(index));
			window.setTimeout(() => setCopyState(null), 1200);
		} catch {
			setCopyState(null);
		}
	}

	return (
		<div className={styles.transcriptReader}>
			<div className={styles.readerToolbar}>
				<label className={styles.fieldLabel}>
					Buscar na transcrição inteira
					<input
						className={styles.search}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Speaker ou texto…"
						type="search"
						value={query}
					/>
				</label>
				<div className={styles.jumpGroup}>
					<label className={styles.fieldLabel}>
						Ir para timestamp
						<input
							className={styles.control}
							inputMode="decimal"
							onChange={(event) => setJump(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									jumpToTimestamp();
								}
							}}
							placeholder="01:32:10"
							value={jump}
						/>
					</label>
					<button className={styles.filterButton} onClick={jumpToTimestamp} type="button">
						Ir
					</button>
				</div>
				<div className={styles.muted} role="status">
					{matches.length.toLocaleString("pt-BR")} de {segments.length.toLocaleString("pt-BR")} falas
				</div>
			</div>

			{visible.length ? (
				<div className={styles.readerList}>
					{visible.map(({ segment, index }) => (
						<article
							className={styles.readerSegment}
							id={`transcript-segment-${index}`}
							key={`${segment.trackNumber}:${segment.segmentId}`}
						>
							<button
								aria-label={`Copiar timestamp ${formatTimestamp(segment.startSeconds)}`}
								className={styles.readerTimestamp}
								onClick={() => void copyTimestamp(index, segment.startSeconds)}
								title="Copiar timestamp"
								type="button"
							>
								{formatTimestamp(segment.startSeconds, false)}
							</button>
							<strong className={styles.readerSpeaker}>{segment.speaker}</strong>
							<p className={styles.readerText}>{segment.text}</p>
							<span className={styles.readerCopyState} aria-live="polite">
								{copyState === String(index) ? "Timestamp copiado" : ""}
							</span>
						</article>
					))}
					<div aria-hidden="true" className={styles.readerSentinel} ref={sentinel} />
				</div>
			) : (
				<div className={styles.empty}>Nenhuma fala corresponde à busca.</div>
			)}
		</div>
	);
}
