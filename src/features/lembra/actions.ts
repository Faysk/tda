"use server";

import { randomUUID } from "node:crypto";
import { getLembraIdentity } from "./access";
import {
	isLembraUuid,
	type LembraReference,
	type LembraUploadIntent,
	validLembraDescription,
	validLembraTitle,
	validLembraUploadIntent,
} from "./model";
import {
	insertLembraReference,
	loadLembraReferenceRow,
	presentLembraRow,
	retireLembraReference,
	setLembraFavorite,
	updateLembraReferenceMetadata,
} from "./repository";
import {
	finalizeLembraPendingUpload,
	lembraPersistenceEnabled,
	presignLembraPendingUpload,
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
			uploadUrl: string;
			expiresAt: string;
			method: "PUT";
			headers: Readonly<{ "Content-Type": LembraUploadIntent["mimeType"] }>;
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

	try {
		const referenceId = randomUUID();
		const uploadId = randomUUID();
		const signed = presignLembraPendingUpload({
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
): Promise<LembraReferenceResult> {
	if (!lembraPersistenceEnabled()) {
		return { ok: false, reason: "media_unavailable" };
	}
	if (
		!isLembraUuid(referenceId) ||
		!isLembraUuid(uploadId) ||
		!validLembraUploadIntent(intent) ||
		!validLembraTitle(titleInput) ||
		!validLembraDescription(descriptionInput)
	) {
		return { ok: false, reason: "invalid_payload" };
	}

	const access = await getLembraIdentity();
	if (!access.ok) return access;

	const client = lembraDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const title = titleInput.trim();
	const description = descriptionInput.trim();

	try {
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
				existing.description !== description
			) {
				return { ok: false, reason: "conflict" };
			}
			const reference = presentLembraRow(
				existing,
				access.identity.authUserId,
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
		});
		const reference = presentLembraRow(row, access.identity.authUserId);
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
): Promise<LembraReferenceResult> {
	if (
		!lembraPersistenceEnabled() ||
		!isLembraUuid(referenceId) ||
		!validLembraTitle(titleInput) ||
		!validLembraDescription(descriptionInput)
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
		const row = await updateLembraReferenceMetadata(
			client,
			referenceId,
			titleInput.trim(),
			descriptionInput.trim(),
		);
		if (!row) return { ok: false, reason: "not_found" };
		const reference = presentLembraRow(row, access.identity.authUserId);
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
		if (!row || row.status !== "active") {
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
