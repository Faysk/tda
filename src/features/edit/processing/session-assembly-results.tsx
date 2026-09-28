"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalBridge } from "./bridge";
import {
	BridgeError,
	type LocalReviewStatus,
	type SessionAssemblyList,
	type SessionAssemblyReview,
	type SessionAssemblyReviewSegment,
} from "./protocol";
import styles from "./session-assembly-results.module.css";

type Props = Readonly<{
	enabled: boolean;
	sessionId: string | null;
	refreshKey?: number;
}>;

const CAMPAIGN_SLUG = "yuhara";

function errorMessage(cause: unknown): string {
	if (!(cause instanceof BridgeError))
		return "Não foi possível carregar o resultado de sessão.";
	return {
		SESSION_ASSEMBLY_NOT_FOUND:
			"A assembly não está mais disponível neste Companion.",
		SESSION_ASSEMBLY_REVIEW_DRAFT_CONFLICT:
			"A revisão mudou em outra ação. Reabra o resultado antes de salvar.",
		SESSION_ASSEMBLY_REVIEW_APPROVAL_BLOCKED:
			"A aprovação está bloqueada por participantes ainda ambíguos.",
		SESSION_ASSEMBLY_REVIEW_APPROVAL_REQUIRES_SAVED_DRAFT:
			"Salve o draft antes de aprovar localmente.",
	}[cause.serverCode ?? ""] ??
		(cause.serverCode
			? `Operação bloqueada · ${cause.serverCode}`
			: "Falha ao conversar com o Companion.");
}

function formatDate(value: string): string {
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.getTime())) return "data indisponível";
	return parsed.toLocaleString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatClock(seconds: number): string {
	const rounded = Math.max(0, Math.round(seconds));
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const rest = rounded % 60;
	return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

export function SessionAssemblyResults({
	enabled,
	sessionId,
	refreshKey = 0,
}: Props) {
	const [bridge] = useState(() => new LocalBridge());
	const [listing, setListing] = useState<SessionAssemblyList | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [review, setReview] = useState<SessionAssemblyReview | null>(null);
	const [segments, setSegments] = useState<SessionAssemblyReviewSegment[]>([]);
	const [status, setStatus] = useState<LocalReviewStatus>("draft");
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [query, setQuery] = useState("");
	const [visibleLimit, setVisibleLimit] = useState(200);
	const [saveStatus, setSaveStatus] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || !sessionId) {
			setListing(null);
			setReview(null);
			setSegments([]);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		void bridge
			.sessionAssemblies(CAMPAIGN_SLUG, sessionId, controller.signal)
			.then((value) => {
				if (controller.signal.aborted) return;
				setListing(value);
				setError(null);
			})
			.catch((cause) => {
				if (!controller.signal.aborted) setError(errorMessage(cause));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [bridge, enabled, refreshKey, sessionId]);

	useEffect(() => {
		if (!dirty) return;
		const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, [dirty]);

	const filtered = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase("pt-BR");
		return segments
			.map((segment, index) => ({ segment, index }))
			.filter(({ segment }) => {
				if (!normalized) return true;
				return [
					segment.text,
					segment.speaker,
					segment.sourceId,
					segment.runId,
					formatClock(segment.start),
				].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized));
			});
	}, [query, segments]);
	const visible = filtered.slice(0, visibleLimit);

	if (!enabled || !sessionId) return null;

	async function openReview(assemblyId: string) {
		if (dirty && !window.confirm("Há alterações não salvas. Descartar e abrir outra assembly?"))
			return;
		setLoading(true);
		setError(null);
		setSaveStatus(null);
		try {
			const value = await bridge.sessionAssemblyReview(
				CAMPAIGN_SLUG,
				sessionId as string,
				assemblyId,
				new AbortController().signal,
			);
			setReview(value);
			setSegments(value.segments.map((segment) => ({ ...segment })));
			setStatus(value.status);
			setDirty(false);
			setVisibleLimit(200);
			setQuery("");
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setLoading(false);
		}
	}

	function patch(index: number, value: Partial<SessionAssemblyReviewSegment>) {
		if (status === "approved_local") setStatus("reviewed");
		setSegments((current) =>
			current.map((segment, candidate) =>
				candidate === index ? { ...segment, ...value } : segment,
			),
		);
		setDirty(true);
		setSaveStatus(null);
	}

	async function saveReview() {
		if (!review || saving) return;
		setSaving(true);
		setError(null);
		setSaveStatus(null);
		try {
			let baseline = review;
			if (status === "approved_local" && baseline.persistence === "ephemeral_base") {
				baseline = await bridge.saveSessionAssemblyReview(
					CAMPAIGN_SLUG,
					sessionId as string,
					baseline.base.assemblyId,
					baseline,
					"reviewed",
					segments,
					new AbortController().signal,
				);
			}
			const saved = await bridge.saveSessionAssemblyReview(
				CAMPAIGN_SLUG,
				sessionId as string,
				baseline.base.assemblyId,
				baseline,
				status,
				segments,
				new AbortController().signal,
			);
			setReview(saved);
			setSegments(saved.segments.map((segment) => ({ ...segment })));
			setStatus(saved.status);
			setDirty(false);
			setSaveStatus(
				saved.approvalCurrent
					? "Assembly aprovada localmente e vinculada ao SHA exato."
					: `Draft salvo · revisão ${saved.draftRevision ?? "base"}.`,
			);
		} catch (cause) {
			setError(errorMessage(cause));
		} finally {
			setSaving(false);
		}
	}

	function closeReview() {
		if (dirty && !window.confirm("Descartar alterações não salvas desta revisão?")) return;
		setReview(null);
		setSegments([]);
		setDirty(false);
		setSaveStatus(null);
	}

	return (
		<section className={styles.root} aria-labelledby="session-assembly-results">
			<header className={styles.header}>
				<div>
					<span className={styles.eyebrow}>Resultado de sessão</span>
					<h2 id="session-assembly-results">Assemblies · {sessionId}</h2>
					<p>
						Composição imutável de múltiplas gravações. Runs-fonte continuam disponíveis abaixo.
					</p>
				</div>
				{loading ? <span role="status">Atualizando…</span> : null}
			</header>

		{error ? <p className={styles.error} role="alert">{error}</p> : null}

		{listing?.assemblies.length ? (
			<div className={styles.list} aria-label="Assemblies da sessão">
				{listing.assemblies.map((assembly) => (
					<article
						key={assembly.assemblyId}
						className={styles.card}
						data-active={review?.base.assemblyId === assembly.assemblyId ? "true" : "false"}
					>
						<div>
							<strong>{assembly.partCount} gravação(ões) · {assembly.segmentCount} segmentos</strong>
							<span>{formatDate(assembly.createdAt)} · {assembly.assemblyId.slice(0, 12)}…</span>
						</div>
						<span data-blocked={assembly.participantApprovalBlocked ? "true" : "false"}>
							{assembly.participantApprovalBlocked
								? "aprovação bloqueada"
								: "pronta para revisão"}
						</span>
						<Button
							size="sm"
							variant="secondary"
							disabled={loading}
							onClick={() => void openReview(assembly.assemblyId)}
						>
							Revisar sessão
						</Button>
					</article>
				))}
			</div>
		) : !loading ? (
			<p className={styles.empty}>Nenhuma assembly concluída para esta sessão ainda.</p>
		) : null}

		{review ? (
			<section className={styles.editor} aria-labelledby="session-assembly-review-editor">
				<header className={styles.editorHeader}>
					<div>
						<span className={styles.eyebrow}>Revisão local</span>
						<h3 id="session-assembly-review-editor">
							Assembly {review.base.assemblyId.slice(0, 12)}…
						</h3>
						<p>
							{review.review.reviewedSegments} / {review.review.totalSegments} revisados · {review.review.editedSegments} editados
						</p>
					</div>
					<Button size="sm" variant="tertiary" onClick={closeReview}>
						Fechar
					</Button>
				</header>

				<div className={styles.toolbar}>
					<label>
						<span>Estado do draft</span>
						<select
							value={status}
							disabled={saving}
							onChange={(event) => {
								setStatus(event.target.value as LocalReviewStatus);
								setDirty(true);
							}}
						>
							<option value="draft">Draft</option>
							<option value="reviewed">Revisado</option>
							<option value="approved_local" disabled={review.approvalBlocked}>
								Aprovado localmente
							</option>
						</select>
					</label>
					<label className={styles.search}>
						<span>Buscar na timeline</span>
						<input
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setVisibleLimit(200);
							}}
							placeholder="Texto, participante, source, run…"
						/>
					</label>
					<Button
						size="sm"
						variant="tertiary"
						disabled={saving || visible.length === 0}
						onClick={() => {
							const visibleIndexes = new Set(visible.map((item) => item.index));
							setSegments((current) =>
								current.map((segment, index) =>
									visibleIndexes.has(index) ? { ...segment, reviewed: true } : segment,
								),
							);
							setDirty(true);
						}}
					>
						Marcar visíveis revisados
					</Button>
				</div>

				{review.approvalBlocked ? (
					<p className={styles.warning} role="status">
						Aprovação local bloqueada: volte ao composer e resolva participantes ambíguos.
					</p>
				) : null}

				<div className={styles.segments} aria-label="Timeline da assembly">
					{visible.map(({ segment, index }) => (
						<article
							key={segment.assemblySegmentId}
							className={styles.segment}
							data-review-segment={segment.assemblySegmentId}
						>
							<div className={styles.segmentMeta}>
								<time>{formatClock(segment.start)}</time>
								<span>gravação {segment.partId.slice(0, 6)} · track {segment.trackNumber}</span>
								<code>{segment.runId.slice(0, 10)}…</code>
							</div>
							<label>
								<span>Participante</span>
								<input
									value={segment.speaker}
									disabled={saving}
									onChange={(event) => patch(index, { speaker: event.target.value })}
								/>
							</label>
							<label className={styles.text}>
								<span>Texto</span>
								<textarea
									value={segment.text}
									disabled={saving}
									onChange={(event) => patch(index, { text: event.target.value })}
								/>
							</label>
							<label className={styles.reviewed}>
								<input
									type="checkbox"
									checked={segment.reviewed}
									disabled={saving}
									onChange={(event) => patch(index, { reviewed: event.target.checked })}
								/>
								<span>Revisado</span>
							</label>
						</article>
					))}
				</div>

				{visible.length < filtered.length ? (
					<Button
						size="sm"
						variant="tertiary"
						onClick={() => setVisibleLimit((current) => current + 200)}
					>
						Mostrar mais ({filtered.length - visible.length})
					</Button>
				) : null}

				<footer className={styles.editorFooter}>
					<div>
						<strong>
							{dirty ? "Alterações locais ainda não salvas" : "Draft sincronizado com o Companion"}
						</strong>
						<span>
							Publicação cloud multi-source não ocorre aqui; esta etapa preserva somente a revisão local.
						</span>
					</div>
					<Button
						variant="primary"
						disabled={!dirty || saving}
						onClick={() => void saveReview()}
					>
						{saving ? "Salvando…" : "Salvar revisão"}
					</Button>
				</footer>
				{saveStatus ? <p className={styles.status} role="status">{saveStatus}</p> : null}
			</section>
		) : null}
		</section>
	);
}
