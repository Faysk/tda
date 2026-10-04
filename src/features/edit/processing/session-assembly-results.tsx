"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalBridge } from "./bridge";
import { SessionAssemblyReview } from "./session-assembly-review";
import {
	focusedSessionAssemblyIsReady,
	retainSessionAssemblyReview,
	shouldApplySessionAssemblyResult,
	type SessionAssemblyReviewFocus,
	type SessionAssemblyReviewSelection,
} from "./session-assembly-results-model";
import {
	readSessionComposerLastSessionPointer,
	SESSION_COMPOSER_CHANGE_EVENT,
} from "./session-composer-storage";
import type { SessionAssemblyListItem } from "./session-composer-protocol";
import styles from "./session-assembly-results.module.css";

type Props = Readonly<{
	campaignId: string;
	capabilities: readonly string[];
	focusReview?: SessionAssemblyReviewFocus | null;
}>;

function short(value: string, size = 12) {
	return value.slice(0, size) + "…";
}

function readSessionId(campaignId: string): string | null {
	try {
		const value = readSessionComposerLastSessionPointer(window.localStorage, campaignId);
		return value && /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : null;
	} catch {
		return null;
	}
}

export function SessionAssemblyResults({
	campaignId,
	capabilities,
	focusReview = null,
}: Props) {
	const enabled =
		capabilities.includes("transcription.session-assembly") &&
		capabilities.includes("transcription.session-assembly.review");
	const [bridge] = useState(() => new LocalBridge());
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [assemblies, setAssemblies] = useState<readonly SessionAssemblyListItem[]>([]);
	const [reviewSelection, setReviewSelection] =
		useState<SessionAssemblyReviewSelection | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const refreshGeneration = useRef(0);
	const reviewGeneration = useRef(0);
	const handledFocusRequest = useRef(0);
	const reviewHeading = useRef<HTMLHeadingElement>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!enabled) return;
		const generation = ++refreshGeneration.current;
		const nextSession = focusReview?.sessionId ?? readSessionId(campaignId);
		const previousSession = sessionIdRef.current;
		sessionIdRef.current = nextSession;
		setSessionId(nextSession);
		setReviewSelection((current) =>
			retainSessionAssemblyReview(current, nextSession),
		);
		if (previousSession !== nextSession) {
			reviewGeneration.current += 1;
			setAssemblies([]);
		}
		if (!nextSession) {
			setAssemblies([]);
			setError(null);
			setBusy(false);
			return;
		}
		const controller = new AbortController();
		setBusy(true);
		setError(null);
		try {
			const listing = await bridge.sessionAssemblies(
				campaignId,
				nextSession,
				controller.signal,
			);
			if (
				!shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: refreshGeneration.current,
					requestSessionId: nextSession,
					currentSessionId: sessionIdRef.current,
				})
			)
				return;
			setAssemblies(listing.assemblies);
		} catch {
			if (
				shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: refreshGeneration.current,
					requestSessionId: nextSession,
					currentSessionId: sessionIdRef.current,
				})
			)
				setError("Não foi possível atualizar as assemblies desta sessão.");
		} finally {
			if (
				shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: refreshGeneration.current,
					requestSessionId: nextSession,
					currentSessionId: sessionIdRef.current,
				})
			)
				setBusy(false);
		}
	}, [bridge, campaignId, enabled, focusReview?.sessionId]);

	useEffect(() => {
		if (!enabled) return;
		void refresh();
		const changed = () => void refresh();
		window.addEventListener(SESSION_COMPOSER_CHANGE_EVENT, changed);
		window.addEventListener("storage", changed);
		return () => {
			window.removeEventListener(SESSION_COMPOSER_CHANGE_EVENT, changed);
			window.removeEventListener("storage", changed);
		};
	}, [enabled, refresh]);

	const review =
		reviewSelection?.sessionId === sessionId ? reviewSelection.review : null;

	async function openReview(
		assemblyId: string,
		requestedSessionId: string | null = sessionId,
	) {
		if (!requestedSessionId) return;
		const requestSessionId = requestedSessionId;
		const generation = ++reviewGeneration.current;
		const controller = new AbortController();
		setReviewSelection(null);
		setBusy(true);
		setError(null);
		try {
			const nextReview = await bridge.sessionAssemblyReview(
				campaignId,
				requestSessionId,
				assemblyId,
				controller.signal,
			);
			if (
				!shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: reviewGeneration.current,
					requestSessionId,
					currentSessionId: sessionIdRef.current,
				})
			)
				return;
			setReviewSelection({ sessionId: requestSessionId, review: nextReview });
		} catch {
			if (
				shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: reviewGeneration.current,
					requestSessionId,
					currentSessionId: sessionIdRef.current,
				})
			)
				setError("A base de revisão da assembly não pôde ser carregada.");
		} finally {
			if (
				shouldApplySessionAssemblyResult({
					requestGeneration: generation,
					currentGeneration: reviewGeneration.current,
					requestSessionId,
					currentSessionId: sessionIdRef.current,
				})
			)
				setBusy(false);
		}
	}

	useEffect(() => {
		if (
			!focusedSessionAssemblyIsReady({
				focus: focusReview,
				currentSessionId: sessionId,
				assemblyIds: assemblies.map((item) => item.assemblyId),
				handledRequestId: handledFocusRequest.current,
				busy,
			})
		)
			return;
		handledFocusRequest.current = focusReview.requestId;
		void openReview(focusReview.assemblyId, focusReview.sessionId);
	}, [assemblies, busy, focusReview, sessionId]);

	useEffect(() => {
		if (!review || !focusReview || review.assemblyId !== focusReview.assemblyId) return;
		requestAnimationFrame(() => reviewHeading.current?.focus({ preventScroll: false }));
	}, [focusReview, review]);

	if (!enabled || (!sessionId && assemblies.length === 0)) return null;

	return (
		<section
			className={styles.section}
			aria-labelledby="session-assembly-results-title"
			data-results-assembly="true"
			data-empty={assemblies.length === 0 ? "true" : "false"}
		>
			<div className={styles.header}>
				<div>
					<span>Resultado de sessão</span>
					<h2
						id="session-assembly-results-title"
						ref={reviewHeading}
						tabIndex={-1}
					>
						Assemblies · {sessionId}
					</h2>
					{assemblies.length === 0 ? (
						<p className={styles.empty}>Nenhuma assembly concluída para a sessão ativa.</p>
					) : null}
				</div>
				<Button type="button" size="sm" variant="tertiary" disabled={busy} onClick={() => void refresh()}>
					Atualizar
				</Button>
			</div>
			{assemblies.length ? (
				<div className={styles.list}>
					{assemblies.map((assembly) => (
						<article
							key={assembly.assemblyId}
							className={styles.item}
							data-selected={
								review?.assemblyId === assembly.assemblyId ? "true" : undefined
							}
						>
							<div>
								<strong>{assembly.partCount} gravações · {assembly.segmentCount} segmentos</strong>
								<span>
									Assembly {short(assembly.assemblyId)} · transcript {short(assembly.transcriptSha256)}
								</span>
								<small>
									{new Date(assembly.createdAt).toLocaleString("pt-BR")}
									{assembly.participantApprovalBlocked
										? " · aprovação bloqueada por participantes"
										: ""}
								</small>
							</div>
							<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void openReview(assembly.assemblyId)}>
								Abrir revisão
							</Button>
						</article>
					))}
				</div>
			) : null}
			{review && sessionId ? (
				<div className={styles.reviewWorkspace} data-session-review-owner="results">
					<div className={styles.review} role="status">
						<strong>Revisão baseada na assembly {short(review.assemblyId)}</strong>
						<span>
							{review.segmentCount} segmentos · {review.reviewedSegments} revisados ·{" "}
							{review.reviewPercent.toFixed(1)}%
						</span>
						<small>
							Base {short(review.baseTranscriptSha256)} ·{" "}
							{review.persistence === "persisted"
								? "draft r" + review.draftRevision
								: "base ainda sem draft"}
						</small>
					</div>
					<SessionAssemblyReview
						bridge={bridge}
						assembly={{
							campaignId,
							sessionId,
							assemblyId: review.assemblyId,
						}}
						review={review}
						disabled={busy}
						onChange={(next) =>
							setReviewSelection({ sessionId, review: next })
						}
						onStatus={(message) => {
							setError(null);
							setStatus(message);
						}}
					/>
				</div>
			) : null}
			{status ? <p className={styles.status} role="status">{status}</p> : null}
			{error ? <p className={styles.error} role="alert">{error}</p> : null}
		</section>
	);
}
