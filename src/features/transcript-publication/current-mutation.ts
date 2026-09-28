import type {
	AuthorizedPublicationActor,
	PublicationDependencies,
} from "./consumer";
import { UUID, type PublicationFailure } from "./canonical";

export const CURRENT_MUTATION_EVENT_VERSION =
	"tda_transcript_publication_event_v1" as const;

export type CurrentMutationInput = Readonly<{
	operationId: string;
	revisionId: string | null;
	expectedCurrentRevisionId: string | null;
}>;

export type CurrentMutationEvent = Readonly<{
	schemaVersion: typeof CURRENT_MUTATION_EVENT_VERSION;
	eventId: string;
	campaignId: string;
	sessionId: string;
	operationId: string;
	action: "restore" | "unpublish";
	revisionId: string | null;
	previousRevisionId: string | null;
	committedAt: string;
}>;

export type CurrentMutationResult =
	| Readonly<{ ok: true; event: CurrentMutationEvent }>
	| Readonly<{ ok: false; reason: PublicationFailure }>;

type Dependencies = Readonly<{
	origin: () => string | null;
	identity: () => Promise<
		| { ok: true; authUserId: string }
		| {
				ok: false;
				reason: "unauthenticated" | "dependency_unavailable";
		  }
	>;
	publication: PublicationDependencies;
	mutate: (
		actor: AuthorizedPublicationActor,
		input: CurrentMutationInput,
	) => Promise<CurrentMutationResult>;
}>;

type ParsedRequest = Readonly<{
	target: {
		campaignSlug: string;
		sourceSessionId: string;
	};
	expectedActorProfileId: string;
	input: CurrentMutationInput;
}>;

function response(result: CurrentMutationResult): Response {
	const status = result.ok
		? 200
		: (
				{
					unauthenticated: 401,
					forbidden: 403,
					publish_capability_undefined: 503,
					invalid_payload: 400,
					approved_review_required: 422,
					too_large: 413,
					not_found: 404,
					conflict: 409,
					stale_current: 409,
					dependency_unavailable: 503,
				} as const
			)[result.reason];
	return Response.json(result, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

async function boundedJson(request: Request): Promise<unknown | null> {
	if (!request.body) return null;
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 2048) {
				await reader.cancel();
				return null;
			}
			chunks.push(chunk.value);
		}
		return JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
		);
	} catch {
		return null;
	} finally {
		reader.releaseLock();
	}
}

function nullableUuid(value: unknown): value is string | null {
	return value === null || (typeof value === "string" && UUID.test(value));
}

function parseRequest(value: unknown): ParsedRequest | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const raw = value as Record<string, unknown>;
	if (
		Object.keys(raw).length !== 6 ||
		typeof raw.campaignSlug !== "string" ||
		!/^[A-Za-z0-9_-]{1,128}$/u.test(raw.campaignSlug) ||
		typeof raw.sourceSessionId !== "string" ||
		!/^[A-Za-z0-9_-]{1,160}$/u.test(raw.sourceSessionId) ||
		typeof raw.operationId !== "string" ||
		!UUID.test(raw.operationId) ||
		typeof raw.expectedActorProfileId !== "string" ||
		!UUID.test(raw.expectedActorProfileId) ||
		!nullableUuid(raw.revisionId) ||
		!nullableUuid(raw.expectedCurrentRevisionId)
	)
		return null;
	return {
		target: {
			campaignSlug: raw.campaignSlug,
			sourceSessionId: raw.sourceSessionId,
		},
		expectedActorProfileId: raw.expectedActorProfileId,
		input: {
			operationId: raw.operationId,
			revisionId: raw.revisionId,
			expectedCurrentRevisionId: raw.expectedCurrentRevisionId,
		},
	};
}

function confirmedEvent(
	result: CurrentMutationResult,
	actor: AuthorizedPublicationActor,
	input: CurrentMutationInput,
): boolean {
	if (!result.ok) return false;
	const event = result.event;
	const action = input.revisionId === null ? "unpublish" : "restore";
	return (
		event.schemaVersion === CURRENT_MUTATION_EVENT_VERSION &&
		UUID.test(event.eventId) &&
		event.campaignId === actor.campaignId &&
		event.sessionId === actor.sessionId &&
		event.operationId === input.operationId &&
		event.action === action &&
		event.revisionId === input.revisionId &&
		nullableUuid(event.previousRevisionId) &&
		Number.isFinite(Date.parse(event.committedAt))
	);
}

export function createCurrentPublicationMutationHandler(deps: Dependencies) {
	return async (request: Request): Promise<Response> => {
		try {
			const origin = deps.origin();
			if (!origin)
				return response({ ok: false, reason: "dependency_unavailable" });
			if (request.method !== "POST" || request.headers.get("origin") !== origin)
				return response({ ok: false, reason: "forbidden" });
			if (
				request.headers.get("content-type")?.split(";")[0].trim() !==
				"application/json"
			)
				return response({ ok: false, reason: "invalid_payload" });

			const identity = await deps.identity();
			if (!identity.ok) return response(identity);
			const parsed = parseRequest(await boundedJson(request));
			if (!parsed) return response({ ok: false, reason: "invalid_payload" });

			const access = await deps.publication.authorize(
				identity.authUserId,
				parsed.target,
			);
			if (!access.ok) return response(access);
			if (
				access.actor.authUserId !== identity.authUserId ||
				access.actor.profileId !== parsed.expectedActorProfileId
			)
				return response({ ok: false, reason: "forbidden" });

			const result = await deps.mutate(access.actor, parsed.input);
			if (!result.ok) return response(result);
			return confirmedEvent(result, access.actor, parsed.input)
				? response(result)
				: response({ ok: false, reason: "dependency_unavailable" });
		} catch {
			return response({ ok: false, reason: "dependency_unavailable" });
		}
	};
}
