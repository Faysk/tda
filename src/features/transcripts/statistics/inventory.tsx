"use client";

import { useId, useMemo, useState } from "react";
import { Select } from "@/components/ui";
import { formatSessionDate } from "@/features/sessions/model";
import {
	formatDuration,
	formatWords,
	type SessionMetric,
} from "@/features/transcripts/statistics/model";
import {
	filterAndSortSessions,
	type CoverageFilter,
	type SortOption,
} from "./inventory-model";
import styles from "./inventory.module.css";

const SORT_OPTIONS: readonly { value: SortOption; label: string }[] = [
	{ value: "date-desc", label: "Data — mais recentes" },
	{ value: "date-asc", label: "Data — mais antigas" },
	{ value: "title-asc", label: "Título — A a Z" },
	{ value: "title-desc", label: "Título — Z a A" },
	{ value: "words-desc", label: "Palavras — maior primeiro" },
	{ value: "words-asc", label: "Palavras — menor primeiro" },
	{ value: "duration-desc", label: "Duração — maior primeiro" },
	{ value: "duration-asc", label: "Duração — menor primeiro" },
];

function sessionDate(date: string | null) {
	return date ? formatSessionDate(date) : "Data não informada";
}

function mobileWords(words: number | null) {
	return words === null
		? "Palavras não informadas"
		: formatWords(words) + " palavras";
}

function mobileDuration(durationMs: number | null) {
	return durationMs === null
		? "Duração não informada"
		: formatDuration(durationMs);
}

export function TranscriptInventory({
	sessions,
}: {
	sessions: readonly SessionMetric[];
}) {
	const [query, setQuery] = useState("");
	const [coverage, setCoverage] = useState<CoverageFilter>("all");
	const [sort, setSort] = useState<SortOption>("date-desc");
	const headingId = useId();
	const visibleSessions = useMemo(
		() => filterAndSortSessions(sessions, query, coverage, sort),
		[sessions, query, coverage, sort],
	);

	return (
		<section className={styles.inventory} aria-labelledby={headingId}>
			<div className={styles.toolbar}>
				<h2 id={headingId}>Sessões</h2>
				<label
					className={[styles.control, styles.searchControl].join(" ")}
				>
					<span>Buscar sessão</span>
					<input
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Buscar por título"
						autoComplete="off"
					/>
				</label>
				<div className={styles.control}>
					<span>Cobertura</span>
					<Select
						value={coverage}
						options={[
							{ value: "all", label: "Todas" },
							{ value: "complete", label: "Completa" },
							{ value: "incomplete", label: "Com dados faltantes" },
						]}
						onChange={(value) => setCoverage(value as CoverageFilter)}
						ariaLabel="Cobertura"
						compact
					/>
				</div>
				<div className={styles.control}>
					<span>Ordenar</span>
					<Select
						value={sort}
						options={SORT_OPTIONS}
						onChange={(value) => setSort(value as SortOption)}
						ariaLabel="Ordenar sessões"
						compact
					/>
				</div>
				<p className={styles.resultCount} role="status" aria-live="polite">
					{visibleSessions.length === sessions.length
						? String(sessions.length) +
							" " +
							(sessions.length === 1 ? "sessão" : "sessões")
						: String(visibleSessions.length) +
							" de " +
							String(sessions.length) +
							" sessões"}
				</p>
			</div>

			{visibleSessions.length ? (
				<div className={styles.tableFrame}>
					<table className={styles.table}>
						<caption className={styles.srOnly}>
							Inventário de cobertura das transcrições
						</caption>
						<thead>
							<tr>
								<th scope="col">Sessão</th>
								<th scope="col">Data</th>
								<th scope="col">Palavras</th>
								<th scope="col">Duração</th>
							</tr>
						</thead>
						<tbody>
							{visibleSessions.map((session) => (
								<tr key={session.id}>
									<td className={styles.titleCell}>{session.title}</td>
									<td>
										<span className={styles.desktopValue}>
											{sessionDate(session.date)}
										</span>
										<span className={styles.mobileValue}>
											{sessionDate(session.date)}
										</span>
									</td>
									<td className={styles.numericCell}>
										<span className={styles.desktopValue}>
											{formatWords(session.words)}
										</span>
										<span className={styles.mobileValue}>
											{mobileWords(session.words)}
										</span>
									</td>
									<td className={styles.numericCell}>
										<span className={styles.desktopValue}>
											{formatDuration(session.durationMs)}
										</span>
										<span className={styles.mobileValue}>
											{mobileDuration(session.durationMs)}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p className={styles.emptyState}>
					Nenhuma sessão corresponde aos filtros atuais.
				</p>
			)}
		</section>
	);
}
