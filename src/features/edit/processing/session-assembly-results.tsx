"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalBridge } from "./bridge";
import { SessionAssemblyReview } from "./session-assembly-review";
import {
	retainSessionAssemblyReview,
	shouldApplySessionAssemblyResult,
	type SessionAssemblyReviewSelection,
} from "./session-assembly-results-model";
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
	assembly: SessionAssembly;
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
	const [activeAssembly, setActiveAssembly] = useState<SessionAssembly | null>(null);
	const [reviewSelection, setReviewSelection] =
		useState<SessionAssemblyReviewSelection | null>(null);
	const sessionIdRef = useRef<string | null>(null);
	const refreshGeneration = useRef(0);
	const reviewGeneration = useRef(0);
	const editorRef = useRef<HTMLElement>(null);
	const focusedRequestId = useRef(0);
	const [busy, setBusy] = useState(false);
	const [reviewDirty, setReviewDirty] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(
		async (requestedSessionId?: string | null) => {
			if (!enabled) return;
			const generation = ++refreshGeneration.current;
			const nextSession = requestedSessionId ?? readSessionId(campaignId);
			const previousSession = sessionIdRef.current;
			sessionIdRef.current = nextSession;
			setSessionId(nextSession);
			setReviewSelection((current) =>
				retainSessionAssemblyReview(current, nextSession),
			);
			if (previousSession !== nextSession) {
				reviewGeneration.current += 1;
				setAssemblies([]);
				setActiveAssembly(null);
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
		},
		[bridge, campaignId, enabled],
	);

	const loadReview = useCallback(
		async (
			requestSessionId: string,
			assemblyId: string,
			knownAssembly?: SessionAssembly,
		) => {
			if (!enabled) return;
			const generation = ++reviewGeneration.current;
			const controller = new AbortController();
			setBusy(true);
			setError(null);
			try {
				const [nextAssembly, nextReview] = await Promise.all([
					knownAssembly
						? Promise.resolve(knownAssembly)
						: bridge.sessionAssembly(
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
				setActiveAssembly(nextAssembly);
				setReviewSelection({
					sessionId: requestSessionId,
					review: nextReview,
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
					setError("A revisão da assembly não pôde ser carregada.");
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
		},
		[bridge, campaignId, enabled],
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
		if (!enabled || !focus) return;
		if (
			focus.assembly.campaignId !== campaignId ||
			focus.assembly.sessionId !== focus.sessionId
		) {
			setError("A assembly selecionada não pertence ao contexto atual.");
			return;
		}
		if (
			reviewDirty &&
			activeAssembly &&
			activeAssembly.assemblyId !== focus.assembly.assemblyId
		) {
			setError(
				"Há alterações não salvas na revisão atual. Salve ou descarte antes de abrir outra assembly.",
			);
			return;
		}
		if (
			activeAssembly?.assemblyId === focus.assembly.assemblyId &&
			reviewSelection?.review.assemblyId === focus.assembly.assemblyId
		)
			return;
		sessionIdRef.current = focus.sessionId;
		setSessionId(focus.sessionId);
		void refresh(focus.sessionId);
		void loadReview(
			focus.sessionId,
			focus.assembly.assemblyId,
			focus.assembly,
		);
	}, [
		activeAssembly,
		campaignId,
		enabled,
		focus,
		loadReview,
		refresh,
		reviewDirty,
		reviewSelection,
	]);

	const review =
		reviewSelection?.sessionId === sessionId ? reviewSelection.review : null;
	const editorOpen =
		activeAssembly !== null &&
		review !== null &&
		activeAssembly.assemblyId === review.assemblyId;

	useEffect(() => {
		if (
			!editorOpen ||
			!focus ||
			focus.requestId <= focusedRequestId.current
		)
			return;
		focusedRequestId.current = focus.requestId;
		editorRef.current?.focus({ preventScroll: true });
		editorRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
	}, [editorOpen, focus]);

	if (!enabled || (!sessionId && assemblies.length === 0 && !focus)) return null;

	return (
		<section
			className={styles.section}
			aria-labelledby="session-assembly-results-title"
			data-results-assembly="true"
			data-empty={assemblies.length === 0 ? "true" : "false"}
			data-review-open={editorOpen ? "true" : "false"}
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
					disabled={busy}
					onClick={() => void refresh(sessionId)}
				>
					Atualizar
				</Button>
			</div>

			{assemblies.length ? (
				<div className={styles.list}>
					{assemblies.map((assembly) => {
						const selected = activeAssembly?.assemblyId === assembly.assemblyId;
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
									variant={selected ? "primary" : "secondary"}
									disabled={busy}
									onClick={() => {
										if (!sessionId || selected) return;
										if (reviewDirty) {
											setError(
												"Salve ou descarte as alterações da revisão atual antes de abrir outra assembly.",
											);
											return;
										}
										void loadReview(sessionId, assembly.assemblyId);
									}}
								>
									{selected ? "Revisão aberta" : "Abrir revisão"}
								</Button>
							</article>
						);
					})}
				</div>
			) : null}

			{editorOpen && activeAssembly && review ? (
				<section
					ref={editorRef}
					className={styles.editor}
					data-assembly-review-owner="results"
					aria-label="Revisão aberta em Resultados"
					tabIndex={-1}
				>
					<SessionAssemblyReview
						bridge={bridge}
						assembly={activeAssembly}
						review={review}
						disabled={busy}
						onChange={(next) =>
							setReviewSelection({
								sessionId: activeAssembly.sessionId,
								review: next,
							})
						}
						onDirtyChange={setReviewDirty}
					/>
				</section>
			) : null}

			{error ? (
				<p className={styles.error} role="alert">
					{error}
				</p>
			) : null}
		</section>
	);
}
