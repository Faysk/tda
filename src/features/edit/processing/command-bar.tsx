"use client";

import { Button } from "@/components/ui/button";
import type { Health, SystemSnapshot } from "./protocol";
import styles from "./command-bar.module.css";

type Props = Readonly<{
	connection: "disconnected" | "connecting" | "connected" | "error";
	connected: boolean;
	connectionLabel: string;
	health: Health | null;
	system: SystemSnapshot | null;
	refreshError: string | null;
	checkedAt: string | null;
	runningCount: number;
	queuedCount: number;
	attentionCount: number;
	refreshing: boolean;
	pendingLifecycle: "pause" | "resume" | null;
	onRefresh: () => void;
	onToggleLifecycle: () => void;
	onAttention: () => void;
	onDiagnostics: () => void;
}>;

function compactGpuName(value: string): string {
	return value
		.replace(/^NVIDIA\s+/iu, "")
		.replace(/^GeForce\s+/iu, "")
		.replace(/\s+Laptop GPU$/iu, "")
		.trim();
}

function compactMemory(used: number | null, total: number | null): string | null {
	if (used === null || total === null || total <= 0) return null;
	const usedGiB = used / 1024 ** 3;
	const totalGiB = total / 1024 ** 3;
	const usedLabel = usedGiB >= 10 ? usedGiB.toFixed(0) : usedGiB.toFixed(1);
	const totalLabel = totalGiB >= 10 ? totalGiB.toFixed(0) : totalGiB.toFixed(1);
	return `${usedLabel}/${totalLabel} GB`;
}

function freshness(checkedAt: string | null, stale: boolean): string {
	if (stale) return "desatualizado";
	if (!checkedAt) return "aguardando leitura";
	const elapsed = Math.max(0, Date.now() - Date.parse(checkedAt));
	const seconds = Math.round(elapsed / 1000);
	if (seconds <= 2) return "agora";
	if (seconds < 60) return `há ${seconds} s`;
	return `há ${Math.floor(seconds / 60)} min`;
}

function countLabel(value: number, singular: string, plural: string): string {
	return `${value} ${value === 1 ? singular : plural}`;
}

export function ProcessingCommandBar({
	connection,
	connected,
	connectionLabel,
	health,
	system,
	refreshError,
	checkedAt,
	runningCount,
	queuedCount,
	attentionCount,
	refreshing,
	pendingLifecycle,
	onRefresh,
	onToggleLifecycle,
	onAttention,
	onDiagnostics,
}: Props) {
	const gpu = system?.gpus[0] ?? null;
	const gpuMemory = gpu
		? compactMemory(gpu.memoryUsedBytes, gpu.memoryTotalBytes)
		: null;
	const stale = Boolean(refreshError);
	const gpuUnavailable = connected && Boolean(system) && system?.gpus.length === 0;
	const partialTelemetry =
		Boolean(gpu) &&
		(gpu?.utilizationPercent === null ||
			gpu?.memoryUsedBytes === null ||
			gpu?.memoryTotalBytes === null);
	const degradedHint = stale
		? "Dados desatualizados"
		: gpuUnavailable
			? "GPU não detectada"
			: partialTelemetry
				? "Telemetria parcial"
				: null;
	const tone =
		connection === "error"
			? "danger"
			: stale || gpuUnavailable || partialTelemetry || health?.lifecycle === "paused"
				? "warning"
				: health?.lifecycle === "ready"
					? "success"
					: "neutral";
	const primaryLifecycleAction =
		health?.lifecycle === "paused" ? "resume" : health?.lifecycle === "ready" ? "pause" : null;

	return (
		<section
			className={styles.bar}
			data-processing-command-bar="true"
			data-tone={tone}
			aria-label="Estado e comandos do TDA Companion"
		>
			<div className={styles.statusCluster}>
				<span className={styles.statusDot} aria-hidden="true" />
				<div className={styles.statusCopy}>
					<strong>
						Companion · <span className={styles.stateLabel}>{connectionLabel}</span>
					</strong>
					<span>{freshness(checkedAt, stale)}</span>
					{degradedHint ? <span className={styles.degradedHint}>{degradedHint}</span> : null}
				</div>
				{connected && gpu ? (
					<span className={styles.gpuCluster} title={gpu.name}>
						{compactGpuName(gpu.name)}
						{gpu.utilizationPercent === null
							? ""
							: ` · ${Math.round(gpu.utilizationPercent)}%`}
						{gpuMemory ? ` · ${gpuMemory}` : ""}
					</span>
				) : null}
				{connected && system ? (
					<span className={styles.secondaryTelemetry}>
						CPU {system.cpu.utilizationPercent === null ? "—" : `${Math.round(system.cpu.utilizationPercent)}%`}
						{" · "}
						RAM {system.memory.percent === null ? "—" : `${Math.round(system.memory.percent)}%`}
					</span>
				) : null}
			</div>

			{connected ? (
				<div className={styles.counters} aria-label="Resumo da fila">
					<span>{countLabel(runningCount, "processando", "processando")}</span>
					<span>{countLabel(queuedCount, "na fila", "na fila")}</span>
					{attentionCount > 0 ? (
						<button type="button" className={styles.attention} onClick={onAttention}>
							{countLabel(attentionCount, "atenção", "atenções")}
						</button>
					) : (
						<span>0 atenção</span>
					)}
				</div>
			) : null}

			<div className={styles.actions}>
				{connected ? (
					<Button
						size="sm"
						variant="tertiary"
						className={styles.refreshAction}
						disabled={refreshing}
						onClick={onRefresh}
						aria-label="Atualizar estado do Companion"
					>
						{refreshing ? "Atualizando…" : "Atualizar"}
					</Button>
				) : null}
				{connected && primaryLifecycleAction ? (
					<Button
						size="sm"
						disabled={pendingLifecycle === primaryLifecycleAction}
						onClick={onToggleLifecycle}
					>
						<span className={styles.actionLong}>
							{primaryLifecycleAction === "pause"
								? pendingLifecycle === "pause"
									? "Pausando…"
									: "Pausar novas execuções"
								: pendingLifecycle === "resume"
									? "Retomando…"
									: "Retomar novas execuções"}
						</span>
						<span className={styles.actionShort}>
							{primaryLifecycleAction === "pause"
								? pendingLifecycle === "pause"
									? "Pausando…"
									: "Pausar"
								: pendingLifecycle === "resume"
									? "Retomando…"
									: "Retomar"}
						</span>
					</Button>
				) : null}
				{connected ? (
					<Button size="sm" variant="tertiary" onClick={onDiagnostics}>
						Diagnóstico
					</Button>
				) : null}
			</div>
		</section>
	);
}
