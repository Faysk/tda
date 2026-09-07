import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import {
	prepareTranscriptEdit,
	type PreparedTranscriptEdit,
	type TranscriptEditIssue,
} from "./model";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;

export type TranscriptMutationRequest = Readonly<{
	authUserId: string | null;
	campaignSlug: string;
	segmentId: string;
	expectedRevision: unknown;
	text: unknown;
	speaker: unknown;
	reviewStatus: unknown;
}>;

export type TranscriptMutationValidationIssue =
	| TranscriptEditIssue
	| "campaign_invalid"
	| "segment_id_invalid"
	| "expected_revision_invalid";

export type TranscriptMutationPersistenceInput = Readonly<{
	actorProfileId: string;
	campaignSlug: string;
	segmentId: string;
	expectedRevision: number;
	edit: PreparedTranscriptEdit;
}>;

export type TranscriptMutationPersistenceResult =
	| Readonly<{ status: "updated"; revision: number }>
	| Readonly<{ status: "conflict" }>
	| Readonly<{ status: "not_found" }>
	| Readonly<{ status: "dependency_unavailable" }>;

export type TranscriptMutationDependencies = Readonly<{
	resolveAccessContext: (
		authUserId: string,
	) => Promise<EditAccessContext | null>;
	persist: (
		input: TranscriptMutationPersistenceInput,
	) => Promise<TranscriptMutationPersistenceResult>;
}>;

export type TranscriptMutationResult =
	| Readonly<{ ok: true; revision: number }>
	| Readonly<{ ok: false; reason: "unauthenticated" }>
	| Readonly<{ ok: false; reason: "profile_unresolved" }>
	| Readonly<{ ok: false; reason: "forbidden" }>
	| Readonly<{
			ok: false;
			reason: "validation";
			issues: readonly TranscriptMutationValidationIssue[];
	  }>
	| Readonly<{ ok: false; reason: "conflict" }>
	| Readonly<{ ok: false; reason: "not_found" }>
	| Readonly<{ ok: false; reason: "dependency_unavailable" }>;

export async function mutateTranscriptSegment(
	request: TranscriptMutationRequest,
	dependencies: TranscriptMutationDependencies,
): Promise<TranscriptMutationResult> {
	if (!request.authUserId) {
		return { ok: false, reason: "unauthenticated" };
	}

	const issues: TranscriptMutationValidationIssue[] = [];
	if (!CAMPAIGN_SLUG_PATTERN.test(request.campaignSlug)) {
		issues.push("campaign_invalid");
	}
	if (!UUID_PATTERN.test(request.segmentId)) {
		issues.push("segment_id_invalid");
	}
	if (
		typeof request.expectedRevision !== "number" ||
		!Number.isSafeInteger(request.expectedRevision) ||
		request.expectedRevision < 0
	) {
		issues.push("expected_revision_invalid");
	}

	const prepared = prepareTranscriptEdit({
		text: request.text,
		speaker: request.speaker,
		reviewStatus: request.reviewStatus,
	});
	if (!prepared.ok) issues.push(...prepared.issues);

	if (issues.length || !prepared.ok) {
		return { ok: false, reason: "validation", issues };
	}

	const context = await dependencies.resolveAccessContext(request.authUserId);
	if (!context) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	const access = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.contentEdit,
		request.campaignSlug,
	);
	if (!access.ok) {
		return { ok: false, reason: access.reason };
	}

	const persistence = await dependencies.persist({
		actorProfileId: access.profileId,
		campaignSlug: request.campaignSlug,
		segmentId: request.segmentId,
		expectedRevision: request.expectedRevision,
		edit: prepared.value,
	});

	switch (persistence.status) {
		case "updated":
			return { ok: true, revision: persistence.revision };
		case "conflict":
			return { ok: false, reason: "conflict" };
		case "not_found":
			return { ok: false, reason: "not_found" };
		case "dependency_unavailable":
			return { ok: false, reason: "dependency_unavailable" };
	}
}
