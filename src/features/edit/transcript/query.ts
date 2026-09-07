import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import type {
	EditTranscriptPage,
	ReadTranscriptPageInput,
	TranscriptCursor,
} from "./repository";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;

export type TranscriptPageRequest = Readonly<{
	authUserId: string | null;
	campaignSlug: string;
	sessionId: string;
	limit?: number;
	cursor?: TranscriptCursor | null;
}>;

export type TranscriptQueryFailure =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "validation"
	| "dependency_unavailable"
	| "not_found";

export type TranscriptQueryResult =
	| Readonly<{ ok: true; value: EditTranscriptPage }>
	| Readonly<{ ok: false; reason: TranscriptQueryFailure }>;

export type TranscriptQueryDependencies = Readonly<{
	resolveAccessContext: (
		authUserId: string,
	) => Promise<EditAccessContext | null>;
	readPage: (
		input: ReadTranscriptPageInput,
	) => Promise<EditTranscriptPage | null>;
}>;

function validCursor(cursor: TranscriptCursor | null | undefined): boolean {
	return (
		!cursor ||
		(Number.isSafeInteger(cursor.startMs) &&
			cursor.startMs >= 0 &&
			UUID_PATTERN.test(cursor.id))
	);
}

function normalizeLimit(limit: number | undefined): number | null {
	if (limit === undefined) return 100;
	return Number.isSafeInteger(limit) && limit >= 1 && limit <= 200 ? limit : null;
}

export async function queryTranscriptPage(
	request: TranscriptPageRequest,
	dependencies: TranscriptQueryDependencies,
): Promise<TranscriptQueryResult> {
	if (!request.authUserId) {
		return { ok: false, reason: "unauthenticated" };
	}

	const limit = normalizeLimit(request.limit);
	if (
		!limit ||
		!CAMPAIGN_SLUG_PATTERN.test(request.campaignSlug) ||
		!UUID_PATTERN.test(request.sessionId) ||
		!validCursor(request.cursor)
	) {
		return { ok: false, reason: "validation" };
	}

	const context = await dependencies.resolveAccessContext(request.authUserId);
	if (!context) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	const access = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.transcriptRead,
		request.campaignSlug,
	);
	if (!access.ok) {
		return { ok: false, reason: access.reason };
	}

	const page = await dependencies.readPage({
		campaignSlug: request.campaignSlug,
		sessionId: request.sessionId,
		limit,
		cursor: request.cursor ?? null,
	});

	return page
		? { ok: true, value: page }
		: { ok: false, reason: "not_found" };
}
