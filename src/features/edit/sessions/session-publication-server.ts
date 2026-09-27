import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
} from "./session-cover-media";
import {
	promoteSessionCoverToPublic,
} from "./session-cover-media-server";
import {
	sessionPublicationIdentity,
	type SessionPublicationCommitInput,
	type SessionPublicationConfirmation,
	type SessionPublicationReceipt,
} from "./session-publication-model";

type SessionRow = Readonly<{
	id: unknown;
	source_session_id: unknown;
	current_publication_id: unknown;
	current_editorial_draft_id: unknown;
	current_transcript_revision_id: unknown;
}>;

type DraftRow = Readonly<{
	id: unknown;
	revision: unknown;
	base_transcript_revision_id: unknown;
	cover_asset_id: unknown;
	arc: unknown;
	title: unknown;
	summary_short: unknown;
	summary_full: unknown;
}>;

type AssetRow = Readonly<{
	id: unknown;
	status: unknown;
	role_hint: unknown;
	staged_bucket: unknown;
	object_key: unknown;
	sha256: unknown;
	mime_type: unknown;
	byte_size: unknown;
	width: unknown;
	height: unknown;
	read_back_verified: unknown;
	public_bucket: unknown;
	public_object_key: unknown;
	public_delivery_verified: unknown;
	public_verified_at: unknown;
}>;

type VersionRow = Readonly<{ version_number: unknown }>;

function stringValue(value: unknown, limit = 300_000): string {
	return typeof value === "string" && value.length <= limit ? value : "";
}

function uuid(value: unknown): string | null {
	const text = stringValue(value, 100);
	return isSessionCoverUuid(text) ? text.toLowerCase() : null;
}

function positiveInteger(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadPublicationState(
	client: SupabaseClient,
	sessionId: string,
): Promise<
	| Readonly<{
			ok: true;
			confirmation: SessionPublicationConfirmation;
			draft: DraftRow;
			asset: AssetRow;
	  }>
	| Readonly<{ ok: false; reason: string }>
> {
	const { data: sessionRaw, error: sessionError } = await client
		.from("sessions")
		.select(
			"id,source_session_id,current_publication_id,current_editorial_draft_id,current_transcript_revision_id,campaigns!inner(slug)",
		)
		.eq("id", sessionId)
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (sessionError) return { ok: false, reason: "dependency_unavailable" };
	if (!sessionRaw) return { ok: false, reason: "not_found" };

	const session = sessionRaw as unknown as SessionRow;
	const resolvedSessionId = uuid(session.id);
	const draftId = uuid(session.current_editorial_draft_id);
	const transcriptRevisionId = uuid(session.current_transcript_revision_id);
	const currentPublicationId = session.current_publication_id
		? uuid(session.current_publication_id)
		: null;
	const sourceSessionId = stringValue(session.source_session_id, 220);
	if (!resolvedSessionId || !sourceSessionId)
		return { ok: false, reason: "not_found" };
	if (!draftId) return { ok: false, reason: "draft_not_saved" };
	if (!transcriptRevisionId)
		return { ok: false, reason: "transcript_not_ready" };

	const { data: draftRaw, error: draftError } = await client
		.from("session_editorial_drafts")
		.select(
			"id,revision,base_transcript_revision_id,cover_asset_id,arc,title,summary_short,summary_full",
		)
		.eq("id", draftId)
		.eq("session_id", resolvedSessionId)
		.maybeSingle();
	if (draftError) return { ok: false, reason: "dependency_unavailable" };
	if (!draftRaw) return { ok: false, reason: "draft_not_saved" };
	const draft = draftRaw as unknown as DraftRow;

	const draftRevision = positiveInteger(draft.revision);
	const baseTranscriptRevisionId = uuid(draft.base_transcript_revision_id);
	const coverAssetId = uuid(draft.cover_asset_id);
	const title = stringValue(draft.title, 500);
	const arc = stringValue(draft.arc, 300);
	const summaryShort = stringValue(draft.summary_short, 4000);
	const summaryFull = stringValue(draft.summary_full, 200000);
	if (
		!draftRevision ||
		!baseTranscriptRevisionId ||
		baseTranscriptRevisionId !== transcriptRevisionId
	) {
		return { ok: false, reason: "stale_transcript" };
	}
	if (!title.trim() || !summaryShort.trim() || !summaryFull.trim())
		return { ok: false, reason: "draft_not_ready" };
	if (!coverAssetId) return { ok: false, reason: "cover_not_ready" };

	const { data: assetRaw, error: assetError } = await client
		.from("media_assets")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("id", coverAssetId)
		.maybeSingle();
	if (assetError) return { ok: false, reason: "dependency_unavailable" };
	if (!assetRaw) return { ok: false, reason: "cover_not_ready" };
	const asset = assetRaw as unknown as AssetRow;
	const status =
		asset.status === "staged" || asset.status === "verified_public"
			? asset.status
			: null;
	const sha256 = isSessionCoverSha256(asset.sha256) ? asset.sha256 : null;
	const mimeType = isSessionCoverMime(asset.mime_type) ? asset.mime_type : null;
	const bytes = positiveInteger(asset.byte_size);
	const width = positiveInteger(asset.width);
	const height = positiveInteger(asset.height);
	const stagedBucket = stringValue(asset.staged_bucket, 100);
	const objectKey = stringValue(asset.object_key, 1000);
	if (
		!status ||
		asset.role_hint !== "session_cover" ||
		asset.read_back_verified !== true ||
		!sha256 ||
		!mimeType ||
		!bytes ||
		!width ||
		!height ||
		!stagedBucket ||
		!objectKey
	) {
		return { ok: false, reason: "cover_not_ready" };
	}

	let currentVersionNumber: number | null = null;
	if (currentPublicationId) {
		const { data: versionRaw, error: versionError } = await client
			.from("session_publication_versions")
			.select("version_number")
			.eq("id", currentPublicationId)
			.eq("session_id", resolvedSessionId)
			.maybeSingle();
		if (versionError)
			return { ok: false, reason: "dependency_unavailable" };
		const version = versionRaw as VersionRow | null;
		currentVersionNumber = version
			? positiveInteger(version.version_number)
			: null;
		if (!currentVersionNumber)
			return { ok: false, reason: "publication_pointer_invalid" };
	}

	return {
		ok: true,
		confirmation: {
			sessionId: resolvedSessionId,
			sourceSessionId,
			expectedCurrentPublicationId: currentPublicationId,
			currentVersionNumber,
			draftId,
			draftRevision,
			transcriptRevisionId,
			coverAssetId,
			coverState: status,
			coverSha256: sha256,
			coverMimeType: mimeType,
			coverBytes: bytes,
			coverWidth: width,
			coverHeight: height,
			coverStagedBucket: stagedBucket,
			coverObjectKey: objectKey,
			arc,
			title,
			shortDescriptionChars: summaryShort.length,
			fullSummaryChars: summaryFull.length,
		},
		draft,
		asset,
	};
}

export async function prepareSessionPublication(
	sessionId: string,
): Promise<
	| Readonly<{ ok: true; confirmation: SessionPublicationConfirmation }>
	| Readonly<{ ok: false; reason: string }>
> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };
	const state = await loadPublicationState(client, sessionId);
	if (!state.ok) return state;
	return { ok: true, confirmation: state.confirmation };
}

function payloadHash(input: Parameters<typeof sessionPublicationIdentity>[0]): string {
	return createHash("sha256")
		.update(sessionPublicationIdentity(input), "utf8")
		.digest("hex");
}

function parseReceipt(value: unknown): SessionPublicationReceipt | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	const receiptId = uuid(row.receiptId);
	const sessionId = uuid(row.sessionId);
	const publicationId = uuid(row.publicationId);
	const operationId = uuid(row.operationId);
	const versionNumber = positiveInteger(row.versionNumber);
	const sha = isSessionCoverSha256(row.payloadSha256)
		? row.payloadSha256
		: null;
	const committedAt = stringValue(row.committedAt, 80);
	if (
		!receiptId ||
		!sessionId ||
		!publicationId ||
		!operationId ||
		!versionNumber ||
		!sha ||
		!committedAt ||
		Number.isNaN(Date.parse(committedAt))
	)
		return null;
	return {
		receiptId,
		sessionId,
		publicationId,
		versionNumber,
		operationId,
		payloadSha256: sha,
		committedAt,
	};
}

export async function commitSessionPublication(input: {
	authUserId: string;
	profileId: string;
	commit: SessionPublicationCommitInput;
}): Promise<
	| Readonly<{
			ok: true;
			receipt: SessionPublicationReceipt;
			sourceSessionId: string;
			cachePending: boolean;
	  }>
	| Readonly<{ ok: false; reason: string }>
> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const state = await loadPublicationState(client, input.commit.sessionId);
	if (!state.ok) return state;
	const expected = state.confirmation;
	if (
		expected.expectedCurrentPublicationId !==
			input.commit.expectedCurrentPublicationId ||
		expected.draftId !== input.commit.draftId ||
		expected.draftRevision !== input.commit.draftRevision ||
		expected.transcriptRevisionId !== input.commit.transcriptRevisionId ||
		expected.coverAssetId !== input.commit.coverAssetId
	) {
		return { ok: false, reason: "stale_confirmation" };
	}

	const promoted = await promoteSessionCoverToPublic({
		campaignSlug: CAMPAIGN_SLUG,
		sessionId: expected.sessionId,
		stagedBucket: expected.coverStagedBucket,
		objectKey: expected.coverObjectKey,
		sha256: expected.coverSha256,
		mimeType: expected.coverMimeType,
		bytes: expected.coverBytes,
		width: expected.coverWidth,
		height: expected.coverHeight,
	});

	const { data: updatedAsset, error: assetUpdateError } = await client
		.from("media_assets")
		.update({
			status: "verified_public",
			public_bucket: promoted.publicBucket,
			public_object_key: promoted.publicObjectKey,
			public_delivery_verified: true,
			public_verified_at: promoted.verifiedAt,
			updated_at: promoted.verifiedAt,
		})
		.eq("id", expected.coverAssetId)
		.eq("status", state.asset.status)
		.eq("sha256", expected.coverSha256)
		.select("id")
		.maybeSingle();

	if (assetUpdateError) return { ok: false, reason: "dependency_unavailable" };
	if (!updatedAsset && state.asset.status !== "verified_public") {
		// A concurrent idempotent promoter may have won; re-read below through RPC.
		const { data: raced } = await client
			.from("media_assets")
			.select("status,public_object_key,public_delivery_verified")
			.eq("id", expected.coverAssetId)
			.maybeSingle();
		if (
			!raced ||
			raced.status !== "verified_public" ||
			raced.public_delivery_verified !== true ||
			raced.public_object_key !== promoted.publicObjectKey
		) {
			return { ok: false, reason: "cover_promote_conflict" };
		}
	}

	const draft = state.draft;
	const title = stringValue(draft.title, 500);
	const arc = stringValue(draft.arc, 300);
	const summaryShort = stringValue(draft.summary_short, 4000);
	const summaryFull = stringValue(draft.summary_full, 200000);
	const sha = payloadHash({
		sessionId: expected.sessionId,
		draftId: expected.draftId,
		draftRevision: expected.draftRevision,
		transcriptRevisionId: expected.transcriptRevisionId,
		coverAssetId: expected.coverAssetId,
		coverPublicUrl: promoted.publicUrl,
		coverSha256: expected.coverSha256,
		arc,
		title,
		summaryShort,
		summaryFull,
	});
	const rpcInput = {
		campaignId: (
			await client
				.from("campaigns")
				.select("id")
				.eq("slug", CAMPAIGN_SLUG)
				.maybeSingle()
		).data?.id,
		sessionId: expected.sessionId,
		operationId: input.commit.operationId,
		expectedCurrentPublicationId: input.commit.expectedCurrentPublicationId,
		draftId: expected.draftId,
		draftRevision: expected.draftRevision,
		transcriptRevisionId: expected.transcriptRevisionId,
		coverAssetId: expected.coverAssetId,
		coverPublicUrl: promoted.publicUrl,
		coverSha256: expected.coverSha256,
		payloadSha256: sha,
	};
	if (!rpcInput.campaignId)
		return { ok: false, reason: "dependency_unavailable" };

	async function call(lookupOnly: boolean) {
		return client.rpc("publish_session_editorial_snapshot_atomic", {
			p_auth_user_id: input.authUserId,
			p_actor_profile_id: input.profileId,
			p_input: rpcInput,
			p_lookup_only: lookupOnly,
		});
	}

	let { data, error } = await call(false);
	if (error) {
		const lookup = await call(true);
		if (!lookup.error) {
			data = lookup.data;
			error = null;
		}
	}
	if (error || !data || typeof data !== "object" || Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };
	const result = data as Record<string, unknown>;
	if (result.ok !== true) {
		return {
			ok: false,
			reason:
				typeof result.reason === "string"
					? result.reason
					: "dependency_unavailable",
		};
	}
	const receipt = parseReceipt(result.receipt);
	if (!receipt) return { ok: false, reason: "invalid_receipt" };

	return {
		ok: true,
		receipt,
		sourceSessionId: expected.sourceSessionId,
		cachePending: false,
	};
}
