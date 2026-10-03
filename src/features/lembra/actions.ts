"use server";

import { randomUUID } from "node:crypto";
import { getLembraIdentity } from "./access";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import type { EditAccessContext } from "@/features/edit/access/policy";
import {
	LEMBRA_UPLOAD_CHUNK_BYTES,
	isLembraUuid,
	type LembraCampaignUpdateIntent,
	type LembraReference,
	type LembraUploadIntent,
	validLembraCampaignId,
	validLembraCampaignUpdateIntent,
	validLembraDescription,
	validLembraTitle,
	validLembraUpdatedAt,
	validLembraUploadIntent,
} from "./model";
import {
	insertLembraReference,
	loadLembraCampaignClassification,
	loadLembraReferenceRow,
	presentLembraRow,
	retireLembraReference,
	setLembraFavorite,
	updateLembraReferenceMetadata,
} from "./repository";
import {
	finalizeLembraPendingUpload,
	lembraPersistenceEnabled,
	type VerifiedLembraUpload,
} from "./server";
import { lembraDataClient } from "@/integrations/supabase/server";

export type LembraMutationFailure =
	| "unauthenticated"
	| "dependency_unavailable"
	| "media_unavailable"
	| "invalid_payload"
	| "not_found"
	| "upload_failed"
	| "conflict";

export type RequestLembraUploadResult =
	| Readonly<{
			ok: true;
			referenceId: string;
			uploadId: string;
			chunkBytes: number;
	  }>
	| Readonly<{ ok: false; reason: LembraMutationFailure }>;

export type LembraReferenceResult =
	| Readonly<{ ok: true; reference: LembraReference }>
	| Readonly<{ ok: false; reason: LembraMutationFailure }>;

export type LembraBooleanResult =
	| Readonly<{ ok: true }>
	| Readonly<{ ok: false; reason: LembraMutationFailure }>;

function sameUpload(
	row: Awaited<ReturnType<typeof loadLembraReferenceRow>>,
	upload: VerifiedLembraUpload,
) {
	if (!row) return false;
	return (
		row.status === "active" &&
		row.staged_bucket === upload.bucket &&
		row.object_key === upload.objectKey &&
		row.sha256 === upload.sha256 &&
		row.mime_type === upload.mimeType &&
		Number(row.byte_size) === upload.bytes &&
		row.width === upload.width &&
		row.height === upload.height &&
		row.read_back_verified === true
	);
}

async function resolveCampaignSelection(
	client: ReturnType<typeof lembraDataClient>,
	campaignId: string | null,
	context: EditAccessContext,
	options: Readonly<{
		allowArchivedCurrent?: string | null;
	}> = {},
) {
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	if (campaignId === null) return { ok: true as const, campaign: null };
	const campaign = await loadLembraCampaignClassification(client, campaignId, context);
	if (!campaign) return { ok: false as const, reason: "invalid_payload" as const };
	if (
		campaign.lifecycle === "archived" &&
		options.allowArchivedCurrent !== campaign.id
	) {
		return { ok: false as const, reason: "invalid_payload" as const };
	}
	return { ok: true as const, campaign };
}

export async function requestLembraUploadAction(
	intent: LembraUploadIntent,
): Promise<RequestLembraUploadResult> {
	if (!lembraPersistenceEnabled()) {
		return { ok: false, reason: "media_unavailable" };
	}
	if (!validLembraUploadIntent(intent)) {
		return { ok: false, reason: "invalid_payload" };
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;

	return {
		ok: true,
		referenceId: randomUUID(),
		uploadId: randomUUID(),
		chunkBytes: LEMBRA_UPLOAD_CHUNK_BYTES,
	};
}

export async function finalizeLembraUploadAction(
	referenceId: string,
	uploadId: string,
	intent: LembraUploadIntent,
	titleInput: string,
	descriptionInput: string,
	campaignIdInput: string | null,
): Promise<LembraReferenceResult> {
	if (!lembraPersistenceEnabled()) {
		return { ok: false, reason: "media_unavailable" };
	}
	if (
		!isLembraUuid(referenceId) ||
		!isLembraUuid(uploadId) ||
		!validLembraUploadIntent(intent) ||
		!validLembraTitle(titleInput) ||
		!validLembraDescription(descriptionInput) ||
		!validLembraCampaignId(campaignIdInput)
	) {
		return { ok: false, reason: "invalid_payload" };
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;

	const client = lembraDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };
	let context: EditAccessContext | null;
	try {
		context = await loadEditAccessContext(access.identity.authUserId);
	} catch {
		context = null;
	}
	if (!context) return { ok: false, reason: "dependency_unavailable" };

	const title = titleInput.trim();
	const description = descriptionInput.trim();

	try {
		const campaignResult = await resolveCampaignSelection(client, campaignIdInput, context);
		if (!campaignResult.ok) return campaignResult;

		const upload = await finalizeLembraPendingUpload({
			referenceId,
			uploadId,
			expectedSha256: intent.sha256,
			expectedMimeType: intent.mimeType,
			expectedBytes: intent.bytes,
		});

		const existing = await loadLembraReferenceRow(client, referenceId);
		if (existing) {
			if (
				!sameUpload(existing, upload) ||
				existing.created_by_auth_user_id !== access.identity.authUserId ||
				existing.title !== title ||
				existing.description !== description ||
				existing.campaign_id !== campaignIdInput
			) {
				return { ok: false, reason: "conflict" };
			}
			const reference = presentLembraRow(
				existing,
				access.identity.authUserId,
				campaignResult.campaign,
			);
			return reference
				? { ok: true, reference }
				: { ok: false, reason: "upload_failed" };
		}

		const row = await insertLembraReference(client, {
			id: referenceId,
			title,
			description,
			stagedBucket: upload.bucket,
			objectKey: upload.objectKey,
			sha256: upload.sha256,
			mimeType: upload.mimeType,
			byteSize: upload.bytes,
			width: upload.width,
			height: upload.height,
			authUserId: access.identity.authUserId,
			authorName: access.identity.displayName,
			campaignId: campaignIdInput,
		});
		const reference = presentLembraRow(
			row,
			access.identity.authUserId,
			campaignResult.campaign,
		);
		return reference
			? { ok: true, reference }
			: { ok: false, reason: "upload_failed" };
	} catch (error) {
		console.error(
			"Lembra upload finalization failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "upload_failed" };
	}
}

export async function updateLembraReferenceAction(
	referenceId: string,
	titleInput: string,
	descriptionInput: string,
	campaignUpdate: LembraCampaignUpdateIntent,
	expectedUpdatedAt: string,
): Promise<LembraReferenceResult> {
	if (
		!lembraPersistenceEnabled() ||
		!isLembraUuid(referenceId) ||
		!validLembraTitle(titleInput) ||
		!validLembraDescription(descriptionInput) ||
		!validLembraCampaignUpdateIntent(campaignUpdate) ||
		!validLembraUpdatedAt(expectedUpdatedAt)
	) {
		return {
			ok: false,
			reason: lembraPersistenceEnabled()
				? "invalid_payload"
				: "media_unavailable",
		};
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;
	const client = lembraDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	try {
		const current = await loadLembraReferenceRow(client, referenceId);
		if (current?.status !== "active") return { ok: false, reason: "not_found" };
		if (current.updated_at !== expectedUpdatedAt) {
			return { ok: false, reason: "conflict" };
		}

		let context: EditAccessContext | null;
		try {
			context = await loadEditAccessContext(access.identity.authUserId);
		} catch {
			context = null;
		}
		if (!context) return { ok: false, reason: "dependency_unavailable" };

		const currentCampaign = current.campaign_id
			? await loadLembraCampaignClassification(client, current.campaign_id, context)
			: null;
		let nextCampaignId = current.campaign_id;
		let campaign = currentCampaign;

		if (campaignUpdate.kind === "set") {
			const campaignResult = await resolveCampaignSelection(
				client,
				campaignUpdate.campaignId,
				context,
				{ allowArchivedCurrent: current.campaign_id },
			);
			if (!campaignResult.ok) return campaignResult;
			nextCampaignId = campaignUpdate.campaignId;
			campaign = campaignResult.campaign;
		} else if (campaignUpdate.kind === "clear") {
			if (current.campaign_id === null || currentCampaign) {
				nextCampaignId = null;
				campaign = null;
			}
			// Hidden private classification stays untouched. This makes an
			// unauthorized direct clear indistinguishable from a normal metadata edit.
		}

		const row = await updateLembraReferenceMetadata(
			client,
			referenceId,
			titleInput.trim(),
			descriptionInput.trim(),
			nextCampaignId,
			expectedUpdatedAt,
		);
		if (!row) return { ok: false, reason: "conflict" };
		const reference = presentLembraRow(
			row,
			access.identity.authUserId,
			campaign,
		);
		return reference
			? { ok: true, reference }
			: { ok: false, reason: "not_found" };
	} catch (error) {
		console.error(
			"Lembra metadata update failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function retireLembraReferenceAction(
	referenceId: string,
): Promise<LembraBooleanResult> {
	if (!lembraPersistenceEnabled()) {
		return { ok: false, reason: "media_unavailable" };
	}
	if (!isLembraUuid(referenceId)) {
		return { ok: false, reason: "invalid_payload" };
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;
	const client = lembraDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	try {
		const retired = await retireLembraReference(client, referenceId);
		return retired
			? { ok: true }
			: { ok: false, reason: "not_found" };
	} catch (error) {
		console.error(
			"Lembra reference retirement failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function setLembraFavoriteAction(
	referenceId: string,
	favorite: boolean,
): Promise<LembraBooleanResult> {
	if (!lembraPersistenceEnabled()) {
		return { ok: false, reason: "media_unavailable" };
	}
	if (!isLembraUuid(referenceId) || typeof favorite !== "boolean") {
		return { ok: false, reason: "invalid_payload" };
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;
	const client = lembraDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	try {
		const row = await loadLembraReferenceRow(client, referenceId);
		if (row?.status !== "active") {
			return { ok: false, reason: "not_found" };
		}
		await setLembraFavorite(
			client,
			access.identity.authUserId,
			referenceId,
			favorite,
		);
		return { ok: true };
	} catch (error) {
		console.error(
			"Lembra favorite update failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}
