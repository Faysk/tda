"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusTone } from "@/components/ui/status";
import type { LocalRunSummary } from "./protocol";
import {
	type RunDateFilter,
	type RunLineageFilter,
	type RunReviewFilter,
	type RunSort,
	type RunWarningFilter,
	compatibleRunCount,
	compactRunId,
	runProfileLabel,
	runReviewLabel,
	runReviewStatus,
	runSessionLabel,
	selectRuns,
} from "./results-model";
import styles from "./run-library.module.css";

type Props = Readonly<{
	runs: readonly LocalRunSummary[];
	selectedRunId: string | null;
	busy: boolean;
	onSelectRun: (runId: string | null) => void;
	onOpen: (sourceId: string, runId: string) => void | Promise<void>;
}>;

function formatDate(value: string | null): string {
	if (!value) return "data desconhecida";
	return new Date(value).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatSeconds(value: number | null): string {
	if (value === null) return "—";
	const seconds = Math.max(0, Math.round(value));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	if (minutes) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
	return `${rest}s`;
}

function formatRealtime(rtf: number | null): string {
	if (rtf === null || rtf <= 0) return "—";
	const speed = 1 / rtf;
	return `${speed >= 10 ? speed.toFixed(1) : speed.toFixed(2)}×`;
}

function formatRtf(rtf: number | null): string {
	return rtf === null ? "—" : rtf.toFixed(3);
}

function formatBytes(value: number): string {
	const units = ["B", "KB", "MB", "GB"];
	let amount = value;
	let unit = 0;
	while (amount >= 1024 && unit < units.length - 1) {
		amount /= 1024;
		unit += 1;
	}
	return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function formatVram(value: number | null | undefined): string {
	if (value === null || value === undefined) return "—";
	return `${(value / 1024 ** 3).toFixed(1)} GiB`;
}

function reviewTone(run: LocalRunSummary): StatusTone {
	const status = runReviewStatus(run);
	if (status === "approved_local") return "success";
	if (status === "reviewed") return "accent";
	if (status === "invalid") return "danger";
	return "neutral";
}

function warningTone(run: LocalRunSummary): StatusTone {
	return (run.stats.warningCount ?? 0) > 0 ? "warning" : "neutral";
}

function engineLabel(run: LocalRunSummary): string {
	const engine = run.engine ?? run.executionLineage?.runtimeFamily;
	return engine || "engine não registrado";
}

function runtimeLabel(run: LocalRunSummary): string {
	const lineage = run.executionLineage;
	if (!lineage) return "—";
	return [lineage.runtimeFamily, lineage.runtimeVersion]
		.filter(Boolean)
		.join(" ") || "—";
}

function Fact({
	label,
	value,
	help,
}: Readonly<{ label: string; value: string | number; help?: string }>) {
	return (
		<div className={styles.fact}>
			<dt>{label}</dt>
			<dd>{value}</dd>
			{help ? <small>{help}</small> : null}
		</div>
	);
}

export function RunLibrary({
	runs,
	selectedRunId,
	busy,
	onSelectRun,
	onOpen,
}: Props) {
	const [query, setQuery] = useState("");
	const [profile, setProfile] = useState("all");
	const [engine, setEngine] = useState("all");
	const [warnings, setWarnings] = useState<RunWarningFilter>("all");
	const [review, setReview] = useState<RunReviewFilter>("all");
	const [lineage, setLineage] = useState<RunLineageFilter>("all");
	const [date, setDate] = useState<RunDateFilter>("all");
	const [sort, setSort] = useState<RunSort>("newest");
	const [copied, setCopied] = useState<string | null>(null);

	const profiles = useMemo(
		() => Array.from(new Set(runs.map((run) => run.profileId))).sort(),
		[runs],
	);
	const engines = useMemo(
		() =>
			Array.from(
				new Set(
					runs
						.map((run) => run.engine)
						.filter((value): value is string => Boolean(value)),
				),
			).sort(),
		[runs],
	);
	const visible = useMemo(
		() =>
			selectRuns(runs, {
				query,
				profile,
				engine,
				warnings,
				review,
				lineage,
				date,
				sort,
			}),
		[runs, query, profile, engine, warnings, review, lineage, date, sort],
	);

	useEffect(() => {
		if (
			selectedRunId &&
			!visible.some((run) => run.runId === selectedRunId)
		)
			onSelectRun(null);
	}, [onSelectRun, selectedRunId, visible]);

	useEffect(() => {
		const media = window.matchMedia("(min-width: 761px)");
		const ensureDesktopSelection = () => {
			if (
				media.matches &&
				!selectedRunId &&
				visible.length > 0
			)
				onSelectRun(visible[0]?.runId ?? null);
		};
		ensureDesktopSelection();
		media.addEventListener("change", ensureDesktopSelection);
		return () => media.removeEventListener("change", ensureDesktopSelection);
	}, [onSelectRun, selectedRunId, visible]);

	const selected =
		visible.find((run) => run.runId === selectedRunId) ??
		runs.find((run) => run.runId === selectedRunId) ??
		null;

	async function copy(label: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(label);
			window.setTimeout(() => {
				setCopied((current) => (current === label ? null : current));
			}, 1400);
		} catch {
			setCopied(null);
		}
	}

	return (
		<section
			className={styles.library}
			data-results-library="true"
			data-detail-open={selected ? "true" : "false"}
			aria-labelledby="local-results-title"
		>
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Biblioteca local</span>
					<h2 id="local-results-title">Resultados</h2>
					<p>
						Runs brutos imutáveis. Revisão e publicação continuam ações explícitas.
					</p>
				</div>
				<span className={styles.total}>
					{runs.length} {runs.length === 1 ? "run" : "runs"}
				</span>
			</header>

			<div className={styles.controls}>
				<label className={styles.search}>
					<span>Buscar</span>
					<input
						type="search"
						value={query}
						placeholder="Sessão, source, profile ou run…"
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
				</label>
				<label>
					<span>Profile</span>
					<select value={profile} onChange={(event) => setProfile(event.currentTarget.value)}>
						<option value="all">Todos</option>
						{profiles.map((value) => (
							<option key={value} value={value}>
								{runProfileLabel(value)}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>Engine</span>
					<select value={engine} onChange={(event) => setEngine(event.currentTarget.value)}>
						<option value="all">Todas</option>
						{engines.map((value) => (
							<option key={value} value={value}>{value}</option>
						))}
					</select>
				</label>
				<label>
					<span>Ordenar</span>
					<select value={sort} onChange={(event) => setSort(event.currentTarget.value as RunSort)}>
						<option value="newest">Mais recentes</option>
						<option value="rtf">RTF menor primeiro</option>
						<option value="duration">Processamento menor primeiro</option>
						<option value="warnings">Mais warnings</option>
					</select>
				</label>
				<details className={styles.moreFilters}>
					<summary>Mais filtros</summary>
					<div>
						<label>
							<span>Warnings</span>
							<select value={warnings} onChange={(event) => setWarnings(event.currentTarget.value as RunWarningFilter)}>
								<option value="all">Todos</option>
								<option value="warnings">Com warnings</option>
								<option value="clean">Sem warnings</option>
							</select>
						</label>
						<label>
							<span>Revisão</span>
							<select value={review} onChange={(event) => setReview(event.currentTarget.value as RunReviewFilter)}>
								<option value="all">Todos</option>
								<option value="asr_only">ASR concluído</option>
								<option value="draft">Draft</option>
								<option value="reviewed">Revisado</option>
								<option value="approved_local">Aprovado localmente</option>
								<option value="invalid">Revisão indisponível</option>
							</select>
						</label>
						<label>
							<span>Lineage</span>
							<select value={lineage} onChange={(event) => setLineage(event.currentTarget.value as RunLineageFilter)}>
								<option value="all">Todos</option>
								<option value="lineage">Com lineage</option>
								<option value="legacy">Legado / sem lineage</option>
							</select>
						</label>
						<label>
							<span>Data</span>
							<select value={date} onChange={(event) => setDate(event.currentTarget.value as RunDateFilter)}>
								<option value="all">Qualquer data</option>
								<option value="7d">Últimos 7 dias</option>
								<option value="30d">Últimos 30 dias</option>
							</select>
						</label>
					</div>
				</details>
			</div>

			<p className={styles.resultCount} aria-live="polite">
				{visible.length === runs.length
					? `${visible.length} runs`
					: `${visible.length} de ${runs.length} runs`}
			</p>

			{copied ? (
				<p className={styles.srStatus} role="status">{copied} copiado.</p>
			) : null}

			{runs.length === 0 ? (
				<div className={styles.empty}>
					<strong>Nenhum resultado local concluído ainda.</strong>
					<span>Runs concluídos aparecem aqui sem publicação automática.</span>
				</div>
			) : visible.length === 0 ? (
				<div className={styles.empty}>
					<strong>Nenhum run corresponde aos filtros.</strong>
					<span>Ajuste busca, profile, engine ou filtros adicionais.</span>
				</div>
			) : (
				<div className={styles.workspace}>
					<div className={styles.master} aria-label="Runs concluídos">
						<div className={styles.masterList}>
							{visible.map((run) => {
								const isSelected = selected?.runId === run.runId;
								return (
									<button
										key={run.runId}
										type="button"
										className={styles.runItem}
										data-selected={isSelected ? "true" : "false"}
										aria-current={isSelected ? "true" : undefined}
										onClick={() => onSelectRun(run.runId)}
									>
										<span className={styles.runIdentity}>
											<strong>{runSessionLabel(run)}</strong>
											<span>{runProfileLabel(run.profileId)}</span>
										</span>
										<span className={styles.runMeta}>
											<time dateTime={run.completedAt ?? undefined}>
												{formatDate(run.completedAt)}
											</time>
											<span>{formatSeconds(run.stats.processingSeconds)}</span>
											<span>{formatRealtime(run.stats.rtf)}</span>
										</span>
										<span className={styles.runBadges}>
											<StatusPill tone={reviewTone(run)}>{runReviewLabel(run)}</StatusPill>
											{(run.stats.warningCount ?? 0) > 0 ? (
												<StatusPill tone={warningTone(run)}>
													{run.stats.warningCount} warnings
												</StatusPill>
											) : null}
											<span>{engineLabel(run)}</span>
											{run.executionLineage ? <span>lineage</span> : <span>legacy</span>}
										</span>
									</button>
								);
							})}
						</div>
					</div>

					<div className={styles.detail}>
						{selected ? (
							<>
								<Button
									size="sm"
									variant="tertiary"
									className={styles.mobileBack}
									onClick={() => onSelectRun(null)}
								>
									Voltar à lista
								</Button>
								<div className={styles.detailHeader}>
									<div>
										<span className={styles.eyebrow}>Run selecionado</span>
										<h3>{runSessionLabel(selected)}</h3>
										<p>
											{runProfileLabel(selected.profileId)} · {formatDate(selected.completedAt)}
										</p>
									</div>
									<div className={styles.detailStatus}>
										<StatusPill tone={reviewTone(selected)}>
											{runReviewLabel(selected)}
										</StatusPill>
										{(selected.stats.warningCount ?? 0) > 0 ? (
											<StatusPill tone="warning">
												{selected.stats.warningCount} warnings
											</StatusPill>
										) : null}
									</div>
								</div>

								<div className={styles.primaryActions}>
									<Button
										size="sm"
										variant="primary"
										disabled={busy || runReviewStatus(selected) === "invalid"}
										onClick={() => void onOpen(selected.sourceId, selected.runId)}
									>
										{busy ? "Abrindo…" : "Revisar"}
									</Button>
									<span className={styles.compare}>
										<strong>Comparar</strong>
										<small>
											{compatibleRunCount(runs, selected) > 1
												? "Há outro run desta source; comparação A/B ainda não está habilitada nesta versão."
												: "Requer dois runs concluídos da mesma source."}
										</small>
									</span>
								</div>

								<div className={styles.groups}>
									<section aria-labelledby="run-performance">
										<h4 id="run-performance">Performance</h4>
										<dl>
											<Fact label="Processamento" value={formatSeconds(selected.stats.processingSeconds)} />
											<Fact label="Trabalho de áudio" value={formatSeconds(selected.stats.audioWorkSeconds)} />
											<Fact label="Duração da sessão" value={formatSeconds(selected.stats.sessionDurationSeconds)} />
											<Fact label="RTF" value={formatRtf(selected.stats.rtf)} />
											<Fact label="Tempo real" value={formatRealtime(selected.stats.rtf)} />
										</dl>
									</section>

									<section aria-labelledby="run-output">
										<h4 id="run-output">Output</h4>
										<dl>
											<Fact label="Palavras" value={selected.stats.wordCount ?? "—"} />
											<Fact label="Segmentos" value={selected.stats.segmentCount ?? "—"} />
											<Fact label="Turnos" value={selected.stats.turnCount ?? "—"} />
											<Fact label="Tracks" value={selected.stats.trackCount ?? "—"} />
											<Fact label="Deduplicados" value={selected.stats.deduplicatedSegmentCount ?? "—"} />
											<Fact label="Warnings" value={selected.stats.warningCount ?? "—"} />
										</dl>
									</section>

									<section className={styles.execution} aria-labelledby="run-execution">
										<h4 id="run-execution">Execution</h4>
										{selected.executionLineage ? (
											<dl>
												<Fact label="Engine" value={selected.engine ?? "—"} />
												<Fact label="Modelo" value={selected.model ?? "—"} />
												<Fact label="Revision" value={selected.modelRevision ?? "—"} />
												<Fact label="Runtime" value={runtimeLabel(selected)} />
												<Fact label="Companion" value={selected.executionLineage.companionVersion ?? "—"} />
												<Fact label="Device" value={selected.device ?? selected.executionLineage.device ?? "—"} />
												<Fact label="Compute" value={selected.computeType ?? selected.executionLineage.computeType ?? "—"} />
												<Fact label="Alignment" value={selected.alignment ?? "—"} />
												<Fact label="GPU" value={selected.executionLineage.gpu?.model ?? "—"} />
												<Fact label="VRAM" value={formatVram(selected.executionLineage.gpu?.vramTotalBytes)} />
												<Fact label="Compute capability" value={selected.executionLineage.gpu?.computeCapability ?? "—"} />
												<Fact label="Driver" value={selected.executionLineage.gpu?.driverVersion ?? "—"} />
											</dl>
										) : (
											<div className={styles.legacyNotice}>
												<strong>Lineage histórico não registrado.</strong>
												<span>
													Este run continua legível, mas hardware/runtime não podem ser reconstruídos com segurança.
												</span>
												<dl>
													<Fact label="Engine" value={selected.engine ?? "—"} />
													<Fact label="Modelo" value={selected.model ?? "—"} />
													<Fact label="Device" value={selected.device ?? "—"} />
													<Fact label="Compute" value={selected.computeType ?? "—"} />
													<Fact label="Alignment" value={selected.alignment ?? "—"} />
												</dl>
											</div>
										)}
									</section>
								</div>

								<details className={styles.integrity}>
									<summary>Integrity e IDs</summary>
									<div className={styles.integrityGrid}>
										<div>
											<span>Source ID</span>
											<code>{selected.sourceId}</code>
											<Button size="sm" variant="tertiary" onClick={() => void copy("Source ID", selected.sourceId)}>
												Copiar
											</Button>
										</div>
										<div>
											<span>Transcript SHA-256</span>
											<code>{selected.transcriptSha256}</code>
											<Button size="sm" variant="tertiary" onClick={() => void copy("Transcript SHA", selected.transcriptSha256)}>
												Copiar
											</Button>
										</div>
										<div>
											<span>Run ID</span>
											<code>{selected.runId}</code>
											<Button size="sm" variant="tertiary" onClick={() => void copy("Run ID", selected.runId)}>
												Copiar
											</Button>
										</div>
										<div>
											<span>Transcript</span>
											<code>{formatBytes(selected.transcriptSizeBytes)}</code>
										</div>
										<div>
											<span>Destino editorial</span>
											<code>
												{selected.publicationTarget
													? `${selected.publicationTarget.campaignSlug} · ${selected.publicationTarget.sourceSessionId}`
													: "não vinculado"}
											</code>
										</div>
										<div>
											<span>Receipt</span>
											<code>não exposto pelo contrato local</code>
										</div>
									</div>
								</details>
							</>
						) : (
							<div className={styles.detailEmpty}>
								<strong>Selecione um run.</strong>
								<span>Performance, output, execution e integrity aparecem aqui.</span>
							</div>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
