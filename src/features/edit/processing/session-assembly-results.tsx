"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalBridge } from "./bridge";
import {
	retainSessionAssemblyReview,
	shouldApplySessionAssemblyResult,
	type SessionAssemblyReviewSelection,
} from "./session-assembly-results-model";
import { SessionAssemblyReview } from "./session-assembly-review";
import {
	readSessionComposerLastSessionPointer,
	SESSION_COMPOSER_CHANGE_EVENT,
} from "./session-composer-storage";
import type {
	SessionAssembly,
	SessionAssemblyListItem,
} from "./session-composer-protocol";
import styles from "./session-assembly-results.module.css";

export type SessionAssemblyReviewFocus = Readonly<{
	sessionId: string;
	assemblyId: string;
	requestId: number;
}>;

type Props = Readonly<{
	campaignId: string;
	capabilities: readonly string[];
	focus?: SessionAssemblyReviewFocus | null;
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
	focus = null,
}: Props) {
	const enabled =
		capabilities.includes("transcription.session-assembly") &&
		capabilities.includes("transcription.session-assembly.review");
	const [bridge] = useState(() => new LocalBridge());
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [assemblies, setAssemblies] = useState<readonly SessionAssemblyListItem[]>([]);
	const [selectedAssembly, setSelectedAssembly] = useState<SessionAssembly | null>(null);
	const [reviewSelection, setReviewSelection] =
		useState<SessionAssemblyReviewSelection | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const refreshGeneration = useRef(0);
	const reviewGeneration = useRef(0);
	const handledFocusRequest = useRef(0);
	const editorRef = useRef<HTMLDivElement>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [reviewBusy, setReviewBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!enabled) return;
		const generation = ++refreshGeneration.current;
		const nextSession = focus?.sessionId ?? readSessionId(campaignId);
		const previousSession = sessionIdRef.current;
		sessionIdRef.current = nextSession;
		setSessionId(nextSession);
		setReviewSelection((current) =>
			retainSessionAssemblyReview(current, nextSession),
		);
		if (previousSession !== nextSession) {
			reviewGeneration.current += 1;
			setAssemblies([]);
			setSelectedAssembly(null);
			setStatus(null);
		}
		if (!nextSession) {
			setAssemblies([]);
			setError(null);
			setRefreshing(false);
			return;
		}
		const controller = new AbortController();
		setRefreshing(true);
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
				setRefreshing(false);
		}
	}, [bridge, campaignId, enabled, focus?.sessionId]);

	const openReview = useCallback(
		async (assemblyId: string) => {
			const requestSessionId = sessionIdRef.current;
			if (!requestSessionId) return;
			const generation = ++reviewGeneration.current;
			const controller = new AbortController();
			setReviewSelection(null);
			setSelectedAssembly(null);
			setStatus(null);
			setReviewBusy(true);
			setError(null);
			try {
				const [assembly, nextReview] = await Promise.all([
					bridge.sessionAssembly(
						campaignId,
						requestSessionId,
						assemblyId,
						controller.signal,
					),
					bridge.sessionAssemblyReview(
						campaignId,
						requestSessionId,
						assemblyId,
						controller.signal,
					),
				]);
				if (
					!shouldApplySessionAssemblyResult({
						requestGeneration: generation,
						currentGeneration: reviewGeneration.current,
						requestSessionId,
						currentSessionId: sessionIdRef.current,
					})
				)
					return;
				setSelectedAssembly(assembly);
				setReviewSelection({ sessionId: requestSessionId, review: nextReview });
				requestAnimationFrame(() => {
					editorRef.current?.querySelector<HTMLElement>("h3")?.focus();
				});
			} catch {
				if (
					shouldApplySessionAssemblyResult({
						requestGeneration: generation,
						currentGeneration: reviewGeneration.current,
						requestSessionId,
						currentSessionId: sessionIdRef.current,
					})
				)
					setError("A revisão desta assembly não pôde ser carregada.");
			} finally {
				if (
					shouldApplySessionAssemblyResult({
						requestGeneration: generation,
						currentGeneration: reviewGeneration.current,
						requestSessionId,
						currentSessionId: sessionIdRef.current,
					})
				)
					setReviewBusy(false);
			}
		},
		[bridge, campaignId],
	);

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

	useEffect(() => {
		if (
			!focus ||
			!enabled ||
			focus.requestId === handledFocusRequest.current ||
			sessionId !== focus.sessionId
		)
			return;
		handledFocusRequest.current = focus.requestId;
		void openReview(focus.assemblyId);
	}, [enabled, focus, openReview, sessionId]);

	if (!enabled || (!sessionId && assemblies.length === 0)) return null;

	const review =
		reviewSelection?.sessionId === sessionId ? reviewSelection.review : null;

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
					<h2 id="session-assembly-results-title">Assemblies · {sessionId}</h2>
					{assemblies.length === 0 ? (
						<p className={styles.empty}>Nenhuma assembly concluída para a sessão ativa.</p>
					) : null}
				</div>
				<Button
					type="button"
					size="sm"
					variant="tertiary"
					disabled={refreshing}
					onClick={() => void refresh()}
				>
					Atualizar
				</Button>
			</div>
			{assemblies.length ? (
				<div className={styles.list}>
					{assemblies.map((assembly) => {
						const selected = selectedAssembly?.assemblyId === assembly.assemblyId;
						return (
							<article
								key={assembly.assemblyId}
								className={styles.item}
								data-selected={selected ? "true" : "false"}
							>
								<div>
									<strong>
										{assembly.partCount} gravações · {assembly.segmentCount} segmentos
									</strong>
									<span>
										Assembly {short(assembly.assemblyId)} · transcript{" "}
										{short(assembly.transcriptSha256)}
									</span>
									<small>
										{new Date(assembly.createdAt).toLocaleString("pt-BR")}
										{assembly.participantApprovalBlocked
											? " · aprovação bloqueada por participantes"
											: ""}
									</small>
								</div>
								<Button
									type="button"
									size="sm"
									variant={selected ? "secondary" : "tertiary"}
									disabled={busy}
									onClick={() => void openReview(assembly.assemblyId)}
								>
									{selected ? "Revisão aberta" : "Abrir revisão"}
								</Button>
							</article>
						);
					})}
				</div>
			) : null}
			{selectedAssembly && review ? (
				<div ref={editorRef} className={styles.editor} data-session-assembly-editor="true">
					<SessionAssemblyReview
						bridge={bridge}
						assembly={selectedAssembly}
						review={review}
						disabled={reviewBusy}
						onChange={(next) =>
							setReviewSelection({ sessionId: selectedAssembly.sessionId, review: next })
						}
						onStatus={setStatus}
					/>
				</div>
			) : null}
			{status ? (
				<p className={styles.status} role="status">
					{status}
				</p>
			) : null}
			{error ? <p className={styles.error} role="alert">{error}</p> : null}
		</section>
	);
}
