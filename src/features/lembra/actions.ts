"use server";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import { authorizeLembraWrite, type LembraAccessFailure } from "./access";
import {
	isLembraUuid,
	type LembraReference,
	type LembraUploadIntent,
	validLembraDescription,
	validLembraTitle,
	validLembraUploadIntent,
} from "./model";
import {
	loadLembraReferenceRow,
	presentLembraRows,
	resolveLembraCampaignId,
	type LembraReferenceRow,
} from "./repository";
import {
	finalizeLembraPendingUpload,
	lembraPersistenceEnabled,
	presignLembraPendingUpload,
	type VerifiedLembraUpload,
} from "./server";

export type LembraMutationFailure =
	| LembraAccessFailure
	| "media_unavailable"
	| "invalid_payload"
	| "campaign_unavailable"
	| "upload_failed"
	| "conflict";

export type RequestLembraUploadResult =
	| Readonly<{
			ok: true;
			referenceId: string;
			uploadId: string;
			uploadUrl: string;
			expiresAt: string;
			method: "PUT";
			headers: Readonly<{ "Content-Type": LembraUploadIntent["mimeType"] }>;
	  }>
	| Readonly<{ ok: false; reason: LembraMutationFailure }>;

export type FinalizeLembraUploadResult =
	| Readonly<{ ok: true; reference: LembraReference }>
	| Readonly<{ ok: false; reason: LembraMutationFailure }>;

function sameUpload(row: LembraReferenceRow, upload: VerifiedLembraUpload) {
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

async function persistReference({
	client,
	campaignId,
	profileId,
	referenceId,
	title,
	description,
	upload,
}: {
	client: SupabaseClient;
	campaignId: string;
	profileId: string;
	referenceId: string;
	title: string;
	description: string;
	upload: VerifiedLembraUpload;
}): Promise<LembraReferenceRow> {
	const existing = await loadLembraReferenceRow(client, campaignId, referenceId);
	if (existing) {
		if (
			!sameUpload(existing, upload) ||
			existing.created_by !== profileId ||
			existing.title !== title ||
			existing.description !== description
		) {
			throw new Error("lembra_reference_identity_conflict");
		}
		return existing;
	}

	const { data, error } = await client
		.from("lembra_references")
		.insert({
			id: referenceId,
			campaign_id: campaignId,
			title,
			description,
			status: "active",
			staged_bucket: upload.bucket,
			object_key: upload.objectKey,
			sha256: upload.sha256,
			mime_type: upload.mimeType,
			byte_size: upload.bytes,
			width: upload.width,
			height: upload.height,
			read_back_verified: true,
			created_by: profileId,
		})
		.select(
			"id,campaign_id,title,description,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,created_by,created_at,updated_at",
		)
		.maybeSingle();

	if (!error && data) return data as LembraReferenceRow;

	const raced = await loadLembraReferenceRow(client, campaignId, referenceId);
	if (
		raced &&
		sameUpload(raced, upload) &&
		raced.created_by === profileId &&
		raced.title === title &&
		raced.description === description
	) {
		return raced;
	}
	throw new Error(`lembra_reference_insert:${error?.message ?? "unknown"}`);
}

export async function requestLembraUploadAction(
	intent: LembraUploadIntent,
): Promise<RequestLembraUploadResult> {
	if (!lembraPersistenceEnabled()) return { ok: false, reason: "media_unavailable" };
	if (!validLembraUploadIntent(intent)) return { ok: false, reason: "invalid_payload" };

	const authorization = await authorizeLembraWrite();
	if (!authorization.ok) return authorization;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	try {
		const campaignId = await resolveLembraCampaignId(client);
		if (!campaignId) return { ok: false, reason: "campaign_unavailable" };

		const referenceId = randomUUID();
		const uploadId = randomUUID();
		const signed = presignLembraPendingUpload({
			campaignSlug: CAMPAIGN_SLUG,
			referenceId,
			uploadId,
			sha256: intent.sha256,
			mimeType: intent.mimeType,
		});
		return {
			ok: true,
			referenceId,
			uploadId,
			uploadUrl: signed.url,
			expiresAt: signed.expiresAt,
			method: "PUT",
			headers: signed.headers,
		};
	} catch (error) {
		console.error(
			"Lembra upload intent failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function finalizeLembraUploadAction(
	referenceId: string,
	uploadId: string,
	intent: LembraUploadIntent,
	titleInput: string,
	descriptionInput: string,
): Promise<FinalizeLembraUploadResult> {
	if (!lembraPersistenceEnabled()) return { ok: false, reason: "media_unavailable" };
	if (
		!isLembraUuid(referenceId) ||
		!isLembraUuid(uploadId) ||
		!validLembraUploadIntent(intent) ||
		!validLembraTitle(titleInput) ||
		!validLembraDescription(descriptionInput)
	) {
		return { ok: false, reason: "invalid_payload" };
	}

	const authorization = await authorizeLembraWrite();
	if (!authorization.ok) return authorization;

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const title = titleInput.trim();
	const description = descriptionInput.trim();

	try {
		const campaignId = await resolveLembraCampaignId(client);
		if (!campaignId) return { ok: false, reason: "campaign_unavailable" };

		const upload = await finalizeLembraPendingUpload({
			campaignSlug: CAMPAIGN_SLUG,
			referenceId,
			uploadId,
			expectedSha256: intent.sha256,
			expectedMimeType: intent.mimeType,
			expectedBytes: intent.bytes,
		});
		const row = await persistReference({
			client,
			campaignId,
			profileId: authorization.profileId,
			referenceId,
			title,
			description,
			upload,
		});
		const [reference] = await presentLembraRows(client, [row], authorization.profileId);
		if (!reference) return { ok: false, reason: "upload_failed" };
		return { ok: true, reference };
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown_error";
		console.error("Lembra upload finalization failed", message);
		return {
			ok: false,
			reason: message === "lembra_reference_identity_conflict" ? "conflict" : "upload_failed",
		};
	}
}
