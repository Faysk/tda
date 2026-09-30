import type { SessionAssembly } from "./session-composer-protocol";
import type {
	CraigSource,
	LocalJob,
	LocalRunSummary,
	SessionParticipantMapping,
	SessionWorkspace,
	TranscriptionProfileId,
} from "./protocol";

export const SESSION_TRANSCRIPTION_MAX_SOURCES = 64;

export type SessionTranscriptionBridge = Readonly<{
	ensureSessionWorkspace: (
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) => Promise<SessionWorkspace>;
	attachSessionSource: (
		campaignId: string,
		sessionId: string,
		sourceId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) => Promise<SessionWorkspace>;
	deriveSessionTimeline: (
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) => Promise<SessionWorkspace>;
	localRuns: (
		sourceId: string,
		signal: AbortSignal,
	) => Promise<readonly LocalRunSummary[]>;
	selectSessionPartRun: (
		campaignId: string,
		sessionId: string,
		partId: string,
		runId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) => Promise<SessionWorkspace>;
	transcription: (
		input: Readonly<{
			campaignId: string;
			sessionId: string;
			sourceId: string;
			profileId: TranscriptionProfileId;
			glossary: string;
			context: string;
		}>,
		key: string,
		signal: AbortSignal,
	) => Promise<LocalJob>;
	sessionParticipants: (
		campaignId: string,
		sessionId: string,
		signal: AbortSignal,
	) => Promise<SessionParticipantMapping>;
	buildSessionAssembly: (
		campaignId: string,
		sessionId: string,
		expectedRevision: number,
		signal: AbortSignal,
	) => Promise<SessionAssembly>;
}>;

export type SessionTranscriptionIntervention =
	| "multiple_eligible_runs"
	| "timeline"
	| "participants"
	| "assembly";

export type SessionTranscriptionOutcome =
	| Readonly<{
			state: "queued";
			workspace: SessionWorkspace;
			queuedSourceIds: readonly string[];
			waitingSourceIds: readonly string[];
			reusedRunCount: number;
	  }>
	| Readonly<{
			state: "needs_intervention";
			workspace: SessionWorkspace;
			reason: SessionTranscriptionIntervention;
			sourceId?: string;
			serverCode?: string;
	  }>
	| Readonly<{
			state: "assembled";
			workspace: SessionWorkspace;
			assembly: SessionAssembly;
			reusedRunCount: number;
	  }>;

type BridgeFailure = Readonly<{
	serverCode?: unknown;
	code?: unknown;
}>;

function failureCode(cause: unknown): string | null {
	if (!cause || typeof cause !== "object") return null;
	const row = cause as BridgeFailure;
	return typeof row.serverCode === "string"
		? row.serverCode
		: typeof row.code === "string"
			? row.code
			: null;
}

function uniqueSources(sources: readonly CraigSource[]): CraigSource[] {
	if (sources.length < 1 || sources.length > SESSION_TRANSCRIPTION_MAX_SOURCES)
		throw new Error("SESSION_TRANSCRIPTION_SOURCE_COUNT_INVALID");
	const seen = new Set<string>();
	const result: CraigSource[] = [];
	for (const source of sources) {
		if (seen.has(source.sourceId)) continue;
		seen.add(source.sourceId);
		result.push(source);
	}
	if (!result.length) throw new Error("SESSION_TRANSCRIPTION_SOURCE_COUNT_INVALID");
	return result;
}

async function attachSources(
	bridge: SessionTranscriptionBridge,
	input: Readonly<{
		campaignId: string;
		sessionId: string;
		sources: readonly CraigSource[];
		signal: AbortSignal;
	}>,
): Promise<SessionWorkspace> {
	let workspace = await bridge.ensureSessionWorkspace(
		input.campaignId,
		input.sessionId,
		input.signal,
	);
	for (const source of uniqueSources(input.sources)) {
		if (workspace.parts.some((part) => part.sourceId === source.sourceId)) continue;
		workspace = await bridge.attachSessionSource(
			input.campaignId,
			input.sessionId,
			source.sourceId,
			workspace.revision,
			input.signal,
		);
	}
	return workspace;
}

async function deriveTrustedTimeline(
	bridge: SessionTranscriptionBridge,
	workspace: SessionWorkspace,
	signal: AbortSignal,
): Promise<SessionWorkspace> {
	if (
		workspace.timeline.state === "ready" ||
		workspace.parts.some(
			(part) => part.sourceStartConfidence !== "trusted_absolute",
		)
	)
		return workspace;
	try {
		return await bridge.deriveSessionTimeline(
			workspace.campaignId,
			workspace.sessionId,
			workspace.revision,
			signal,
		);
	} catch {
		return workspace;
	}
}

export async function advanceSessionTranscription(input: Readonly<{
	bridge: SessionTranscriptionBridge;
	campaignId: string;
	sessionId: string;
	sources: readonly CraigSource[];
	profileId: TranscriptionProfileId;
	context: string;
	glossary: string;
	idempotencyKeyForSource: (sourceId: string) => Promise<string> | string;
	signal: AbortSignal;
}>): Promise<SessionTranscriptionOutcome> {
	const sources = uniqueSources(input.sources);
	let workspace = await attachSources(input.bridge, { ...input, sources });
	workspace = await deriveTrustedTimeline(input.bridge, workspace, input.signal);

	const queuedSourceIds: string[] = [];
	const waitingSourceIds: string[] = [];
	let reusedRunCount = 0;

	for (const initialPart of workspace.parts) {
		const part =
			workspace.parts.find((item) => item.partId === initialPart.partId) ??
			initialPart;
		const runs = await input.bridge.localRuns(part.sourceId, input.signal);
		const selected = part.selectedRunId
			? runs.find((run) => run.runId === part.selectedRunId)
			: undefined;
		if (selected?.profileId === input.profileId) {
			reusedRunCount += 1;
			continue;
		}

		const eligible = runs.filter((run) => run.profileId === input.profileId);
		if (eligible.length > 1) {
			return {
				state: "needs_intervention",
				workspace,
				reason: "multiple_eligible_runs",
				sourceId: part.sourceId,
			};
		}
		if (eligible.length === 1) {
			workspace = await input.bridge.selectSessionPartRun(
				workspace.campaignId,
				workspace.sessionId,
				part.partId,
				eligible[0].runId,
				workspace.revision,
				input.signal,
			);
			reusedRunCount += 1;
			continue;
		}

		try {
			await input.bridge.transcription(
				{
					campaignId: input.campaignId,
					sessionId: input.sessionId,
					sourceId: part.sourceId,
					profileId: input.profileId,
					context: input.context,
					glossary: input.glossary,
				},
				await input.idempotencyKeyForSource(part.sourceId),
				input.signal,
			);
			queuedSourceIds.push(part.sourceId);
		} catch (cause) {
			if (failureCode(cause) === "TRANSCRIPTION_WORK_ALREADY_ACTIVE") {
				waitingSourceIds.push(part.sourceId);
				continue;
			}
			throw cause;
		}
	}

	if (queuedSourceIds.length || waitingSourceIds.length) {
		return {
			state: "queued",
			workspace,
			queuedSourceIds,
			waitingSourceIds,
			reusedRunCount,
		};
	}

	workspace = await deriveTrustedTimeline(input.bridge, workspace, input.signal);
	if (workspace.timeline.state !== "ready") {
		return {
			state: "needs_intervention",
			workspace,
			reason: "timeline",
		};
	}

	const mapping = await input.bridge.sessionParticipants(
		workspace.campaignId,
		workspace.sessionId,
		input.signal,
	);
	if (mapping.approvalBlocked) {
		return {
			state: "needs_intervention",
			workspace,
			reason: "participants",
		};
	}

	try {
		const assembly = await input.bridge.buildSessionAssembly(
			workspace.campaignId,
			workspace.sessionId,
			workspace.revision,
			input.signal,
		);
		return {
			state: "assembled",
			workspace,
			assembly,
			reusedRunCount,
		};
	} catch (cause) {
		return {
			state: "needs_intervention",
			workspace,
			reason: "assembly",
			...(failureCode(cause) ? { serverCode: failureCode(cause) ?? undefined } : {}),
		};
	}
}
