"use client";

import { useMemo, useRef, useState } from "react";
import { StoryMarkdown } from "@/components/story-markdown";
import type { TranscriptReaderSegment } from "@/features/edit/transcript/reader-contract";
import type { SessionEditorialDraftEditorTransport } from "./editorial-draft-editor";
import type { SessionEditorialDraft } from "./editorial-draft-model";
import type { SessionCoverUploadState } from "./session-cover-editor";
import { SessionEditWorkspace } from "./session-edit-workspace";
import {
	SessionCampaignMovePanel,
	type SessionCampaignMoveTransport,
} from "./session-campaign-move";
import workbenchStyles from "../workbench.module.css";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const TRANSCRIPT_REVISION_ID = "22222222-2222-4222-8222-222222222222";
const TRANSCRIPT_REVISION_ID_2 = "22222222-2222-4222-8222-222222222223";
const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const COVER_REFERENCE = "/assets/sessions/synthetic-editorial-cover.webp";
const COVER_REFERENCE_REPLACEMENT =
	"/assets/sessions/synthetic-editorial-cover-replacement.webp";
const PRIVATE_MARKER = "NEVER_PUBLIC_TRANSCRIPT_MARKER_9F3A";

const BASE_SEGMENTS: readonly TranscriptReaderSegment[] = [
	{
		id: "synthetic-segment-001",
		trackNumber: 1,
		startMs: 0,
		endMs: 4200,
		speaker: "Alya",
		text: "Primeira fala sintética da sessão.",
	},
	{
		id: "synthetic-segment-002",
		trackNumber: 2,
		startMs: 12500,
		endMs: 18100,
		speaker: "Dandelion",
		text: `Trecho privado ${PRIVATE_MARKER} usado somente para provar ausência de vazamento.`,
	},
	{
		id: "synthetic-segment-003",
		trackNumber: 3,
		startMs: 3723000,
		endMs: 3728600,
		speaker: "Mestre",
		text: "Última fala sintética para validar jump e cronologia.",
	},
];

function buildSyntheticSegments(count: number): readonly TranscriptReaderSegment[] {
	const safeCount = Math.max(0, Math.min(7500, Math.trunc(count)));
	if (safeCount <= BASE_SEGMENTS.length) return BASE_SEGMENTS.slice(0, safeCount);
	const generated = [...BASE_SEGMENTS];
	for (let index = BASE_SEGMENTS.length + 1; index <= safeCount; index += 1) {
		const startMs = (index - 1) * 4_500;
		generated.push({
			id: `synthetic-segment-${String(index).padStart(4, "0")}`,
			trackNumber: ((index - 1) % 6) + 1,
			startMs,
			endMs: startMs + 3_900,
			speaker: index % 2 === 0 ? "Alya" : "Dandelion",
			text: `Segmento sintético ${index}`,
		});
	}
	return generated;
}


type PublicSnapshot = Readonly<{
	version: number;
	publicationId: string;
	coverAssetId: string;
	arc: string;
	title: string;
	shortDescription: string;
	fullSummary: string;
	sessionDate: string;
}>;

function freshDraft(): SessionEditorialDraft {
	return {
		draftId: null,
		revision: 0,
		baseTranscriptRevisionId: TRANSCRIPT_REVISION_ID,
		currentTranscriptRevisionId: TRANSCRIPT_REVISION_ID,
		transcriptChanged: false,
		coverAssetId: "",
		arc: "",
		title: "",
		shortDescription: "",
		fullSummary: "",
		updatedAt: null,
		sessionStatus: "ready_for_review",
		sessionDate: null,
		seededFromPublished: false,
	};
}

function SyntheticCoverEditor({
	value,
	disabled = false,
	onChange,
	onUploadStateChange,
}: Readonly<{
	sessionId: string;
	value: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	onUploadStateChange?: (state: SessionCoverUploadState) => void;
}>) {
	const [pending, setPending] = useState(false);
	const [phase, setPhase] = useState<SessionCoverUploadState["phase"]>("idle");

	function emit(state: SessionCoverUploadState) {
		setPhase(state.phase);
		onUploadStateChange?.(state);
	}

	return (
		<div data-testid="synthetic-cover-editor">
			<button
				disabled={disabled || pending}
				onClick={() => {
					onChange(COVER_REFERENCE);
					emit({ phase: "ready", progress: 100 });
				}}
				type="button"
			>
				Usar capa sintética finalizada
			</button>
			<button
				disabled={disabled || pending || !value}
				onClick={() => {
					setPending(true);
					emit({ phase: "uploading", progress: 45 });
				}}
				type="button"
			>
				Simular troca de capa em andamento
			</button>
			{pending ? (
				<>
					<button
						onClick={() => emit({ phase: "finalizing", progress: null })}
						type="button"
					>
						Simular validação da nova capa
					</button>
					<button
						onClick={() => {
							onChange(COVER_REFERENCE_REPLACEMENT);
							setPending(false);
							emit({ phase: "ready", progress: 100 });
						}}
						type="button"
					>
						Concluir troca de capa
					</button>
					<button
						onClick={() => {
							setPending(false);
							emit({ phase: "cancelled", progress: null });
						}}
						type="button"
					>
						Cancelar troca de capa
					</button>
					<button
						onClick={() => {
							setPending(false);
							emit({ phase: "error", progress: null });
						}}
						type="button"
					>
						Falhar troca de capa
					</button>
				</>
			) : null}
			<output data-testid="synthetic-cover-phase">{phase}</output>
			{value ? <output data-testid="synthetic-cover-reference">{value}</output> : null}
		</div>
	);
}

export function SessionEditorialE2EFixture({
	segmentCount = BASE_SEGMENTS.length,
	moveBackendReady = true,
}: Readonly<{ segmentCount?: number; moveBackendReady?: boolean }>) {
	const segments = useMemo(() => buildSyntheticSegments(segmentCount), [segmentCount]);
	const initialDraft = useMemo(() => freshDraft(), []);
	const draftRef = useRef<SessionEditorialDraft>(initialDraft);
	const transcriptRevisionRef = useRef(TRANSCRIPT_REVISION_ID);
	const [transcriptRevisionId, setTranscriptRevisionId] = useState(
		TRANSCRIPT_REVISION_ID,
	);
	const publicRef = useRef<PublicSnapshot | null>(null);
	const operationsRef = useRef(
		new Map<
			string,
			Readonly<{
				publicationId: string;
				version: number;
				previousPublicationId: string | null;
				payloadSha256: string;
			}>
		>(),
	);
	const loseNextResponseRef = useRef(false);
	const failNextCoverPromotionRef = useRef(false);
	const loseNextMoveResponseRef = useRef(false);
	const moveReceiptsRef = useRef(new Set<string>());
	const moveAttemptsRef = useRef(new Map<string, number>());
	const moveLostResponseOperationsRef = useRef(new Set<string>());
	const [moveOperationIds, setMoveOperationIds] = useState<string[]>([]);
	const [publicSnapshot, setPublicSnapshot] = useState<PublicSnapshot | null>(null);
	const [editable, setEditable] = useState(true);
	const [publishable, setPublishable] = useState(true);
	const [remoteRevision, setRemoteRevision] = useState(0);

	const transport = useMemo<SessionEditorialDraftEditorTransport>(() => {
		const saveDraft: SessionEditorialDraftEditorTransport["saveDraft"] = async (
			input,
		) => {
			const current = draftRef.current;
			if (input.expectedRevision !== current.revision) {
				return {
					ok: false as const,
					reason: "conflict" as const,
					issues: ["conflict"],
					remote: current,
				};
			}
			const next: SessionEditorialDraft = {
				draftId: current.draftId ?? DRAFT_ID,
				revision: current.revision + 1,
				baseTranscriptRevisionId: input.baseTranscriptRevisionId,
				currentTranscriptRevisionId: transcriptRevisionRef.current,
				transcriptChanged:
					input.baseTranscriptRevisionId !== transcriptRevisionRef.current,
				coverAssetId: input.coverAssetId,
				arc: input.arc,
				title: input.title,
				shortDescription: input.shortDescription,
				fullSummary: input.fullSummary,
				updatedAt: "2026-09-28T01:30:00.000Z",
				sessionStatus: publicRef.current ? "published" : "ready_for_review",
				sessionDate: input.sessionDate || null,
				seededFromPublished: false,
			};
			draftRef.current = next;
			return { ok: true as const, draft: next };
		};

		const publishDraft: SessionEditorialDraftEditorTransport["publishDraft"] = async (
			request,
		) => {
			const recovered = operationsRef.current.get(request.operationId);
			if (recovered) {
				return {
					ok: true as const,
					receipt: {
						...recovered,
						replayed: true,
						currentlyActive:
							publicRef.current?.publicationId === recovered.publicationId,
						cachePending: false,
					},
				};
			}

			const draft = draftRef.current;
			if (!draft.draftId || request.draftId !== draft.draftId)
				return { ok: false as const, reason: "draft_changed" as const };
			if (
				request.expectedCurrentPublicationId !==
				(publicRef.current?.publicationId ?? null)
			) {
				return { ok: false as const, reason: "stale_current" as const };
			}
			if (draft.transcriptChanged)
				return { ok: false as const, reason: "transcript_changed" as const };
			if (failNextCoverPromotionRef.current) {
				failNextCoverPromotionRef.current = false;
				return { ok: false as const, reason: "cover_unverified" as const };
			}

			const version = (publicRef.current?.version ?? 0) + 1;
			const publicationId =
				version === 1
					? "44444444-4444-4444-8444-444444444444"
					: "55555555-5555-4555-8555-555555555555";
			const receipt = {
				publicationId,
				version,
				previousPublicationId: publicRef.current?.publicationId ?? null,
				payloadSha256: "a".repeat(64),
			};
			const snapshot: PublicSnapshot = {
				version,
				publicationId,
				coverAssetId: draft.coverAssetId,
				arc: draft.arc,
				title: draft.title,
				shortDescription: draft.shortDescription,
				fullSummary: draft.fullSummary,
				sessionDate: draft.sessionDate ?? "",
			};
			operationsRef.current.set(request.operationId, receipt);
			publicRef.current = snapshot;
			setPublicSnapshot(snapshot);

			if (loseNextResponseRef.current) {
				loseNextResponseRef.current = false;
				return {
					ok: false as const,
					reason: "readback_unavailable" as const,
				};
			}

			return {
				ok: true as const,
				receipt: {
					...receipt,
					replayed: false,
					currentlyActive: true,
					cachePending: false,
				},
			};
		};

		return {
			saveDraft,
			publishDraft,
			CoverEditor: SyntheticCoverEditor,
		};
	}, []);

	const moveTransport = useMemo<SessionCampaignMoveTransport>(() => ({
		preflight: async (request) => ({
			ok: true as const,
			preview: request.destinationCampaignSlug === "campanha-bloqueada"
				? {
					status: "blocked" as const,
					contractVersion: 2 as const,
					sessionId: request.sessionId,
					sourceSessionId: request.sourceSessionId,
					sourceCampaignSlug: request.sourceCampaignSlug,
					destinationCampaignSlug: request.destinationCampaignSlug,
					blockers: [{
						code: "synthetic_binding",
						count: 1,
						message: "Dependência sintética impede o move.",
					}],
					plan: [],
					consequences: [],
				}
				: {
					status: "ready" as const,
					contractVersion: 2 as const,
					sessionId: request.sessionId,
					sourceSessionId: request.sourceSessionId,
					sourceCampaignSlug: request.sourceCampaignSlug,
					destinationCampaignSlug: request.destinationCampaignSlug,
					blockers: [],
					plan: [],
					consequences: [
						"edit_url_changes",
						"campaign_scope_changes",
						"cache_revalidation_required",
					],
				},
		}),
		commit: async (request) => {
			const attempt = (moveAttemptsRef.current.get(request.operationId) ?? 0) + 1;
			moveAttemptsRef.current.set(request.operationId, attempt);
			const replayed = moveReceiptsRef.current.has(request.operationId);
			moveReceiptsRef.current.add(request.operationId);
			setMoveOperationIds((current) => [...current, request.operationId]);
			if (loseNextMoveResponseRef.current) {
				loseNextMoveResponseRef.current = false;
				moveLostResponseOperationsRef.current.add(request.operationId);
				throw new Error("synthetic lost move response");
			}
			const cachePending = moveLostResponseOperationsRef.current.has(request.operationId)
				? attempt < 3
				: attempt < 2;
			return {
				ok: true as const,
				replayed,
				cachePending,
				destinationHref:
					`/e2e-fixtures/session-editorial?move=committed&operationId=${encodeURIComponent(request.operationId)}`,
			};
		},
	}), []);

	function simulateTranscriptRevision() {
		transcriptRevisionRef.current = TRANSCRIPT_REVISION_ID_2;
		setTranscriptRevisionId(TRANSCRIPT_REVISION_ID_2);
	}

	function simulateRemoteDraft() {
		const current = draftRef.current;
		const nextRevision = current.revision + 1;
		draftRef.current = {
			...current,
			draftId: current.draftId ?? DRAFT_ID,
			revision: nextRevision,
			title: `Título remoto r${nextRevision}`,
			updatedAt: "2026-09-28T01:35:00.000Z",
		};
		setRemoteRevision(nextRevision);
	}

	return (
		<>
			<main
				className={[workbenchStyles.shell, workbenchStyles.sessionShell].join(" ")}
				data-testid="session-editorial-shell"
			>
				<header className={[workbenchStyles.workbenchHeader, workbenchStyles.sessionHeader].join(" ")}>
								<div>
									<h1 className={workbenchStyles.workbenchTitle}>Session Editorial E2E</h1>
									<p className={workbenchStyles.muted}>
										Fixture sintética. Nenhum dado, credencial, mídia ou transcrição real é
										carregado.
									</p>
								</div>
							</header>
				<div className={workbenchStyles.sessionNotice} role="status">
					<strong>Privado no Edit</strong>
					<span>Fixture sintética; salvar draft não publica.</span>
				</div>
				<div className={workbenchStyles.sessionMove}>
					<SessionCampaignMovePanel
									sessionId={SESSION_ID}
									sourceSessionId="synthetic-editorial"
									sourceCampaignSlug="campanha-a"
									sourceCampaignName="Campanha A"
									destinations={[
										{
											technicalSlug: "campanha-b",
											routeKey: "campanha-b",
											name: "Campanha B",
										},
										{
											technicalSlug: "campanha-bloqueada",
											routeKey: "campanha-bloqueada",
											name: "Campanha bloqueada",
										},
									]}
									backendReady={moveBackendReady}
									transport={moveTransport}
								/>
				</div>
				<div className={workbenchStyles.sessionWorkspace}>
					<section
						aria-label="Workspace editorial privado"
						className={workbenchStyles.sessionWorkspaceFrame}
						data-testid="session-editorial-workspace-frame"
					>
									<SessionEditWorkspace
										transcript={{
											downloadHref: "/e2e-fixtures/session-editorial/transcript",
											segments,
											sourceLabel: "Revisão privada sintética · r1",
										}}
										editorial={{
											editable,
											initial: {
												...initialDraft,
												currentTranscriptRevisionId: transcriptRevisionId,
												transcriptChanged:
													initialDraft.baseTranscriptRevisionId !== transcriptRevisionId,
											},
											initialPublication: {
												currentPublicationId: null,
												currentVersion: 0,
											},
											publicationAvailable: true,
											publishable,
											sessionId: SESSION_ID,
											transport,
										}}
										editorialUnavailable={null}
									/>
								</section>
				</div>
			</main>

			<div className={workbenchStyles.shell} style={{ display: "grid", gap: "2rem" }}>
				<section aria-label="Controles sintéticos de falha" data-testid="session-editorial-failure-controls">
								<label>
									<input
										checked={editable}
										onChange={(event) => setEditable(event.currentTarget.checked)}
										type="checkbox"
									/>
									Permitir edição
								</label>
								<label>
									<input
										checked={publishable}
										onChange={(event) => setPublishable(event.currentTarget.checked)}
										type="checkbox"
									/>
									Permitir publicação
								</label>
								<button onClick={simulateTranscriptRevision} type="button">
									Simular nova revisão de transcrição
								</button>
								<button onClick={simulateRemoteDraft} type="button">
									Simular save concorrente
								</button>
								<button
									onClick={() => {
										loseNextResponseRef.current = true;
									}}
									type="button"
								>
									Perder próxima resposta de publicação
								</button>
								<button
									onClick={() => {
										failNextCoverPromotionRef.current = true;
									}}
									type="button"
								>
									Falhar próxima promoção da capa
								</button>
								<button
									onClick={() => {
										loseNextMoveResponseRef.current = true;
									}}
									type="button"
								>
									Perder próxima resposta de move
								</button>
								<output data-testid="synthetic-move-operation-ids">
									{moveOperationIds.join("|")}
								</output>
								<output data-testid="remote-draft-revision">{remoteRevision}</output>
							</section>
				<section
								aria-label="Superfície pública sintética"
								data-testid="synthetic-public-session"
							>
								<h2>Snapshot público</h2>
								{publicSnapshot ? (
									<article
										data-public-description={publicSnapshot.shortDescription}
										data-public-version={publicSnapshot.version}
									>
										<p>{publicSnapshot.arc}</p>
										<h3>{publicSnapshot.title}</h3>
										<time>{publicSnapshot.sessionDate}</time>
										<p>{publicSnapshot.shortDescription}</p>
										<StoryMarkdown
											source={publicSnapshot.fullSummary}
											title={publicSnapshot.title}
										/>
										<small>{publicSnapshot.coverAssetId}</small>
									</article>
								) : (
									<p>Nenhuma publicação pública.</p>
								)}
							</section>
			</div>
		</>
	);
}

export { PRIVATE_MARKER };
