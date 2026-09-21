"use client";

import type { LocalReview } from "./protocol";

export type PublicationReceiptView = Readonly<{
	receiptId: string;
	revisionId: string;
	revisionNumber: number;
	committedAt: string;
}>;

export class PublicationClientError extends Error {
	constructor(
		readonly code:
			| "unauthenticated"
			| "forbidden"
			| "publish_capability_undefined"
			| "invalid_payload"
			| "approved_review_required"
			| "too_large"
			| "not_found"
			| "conflict"
			| "dependency_unavailable"
			| "unconfirmed",
	) {
		super(code);
		this.name = "PublicationClientError";
	}
}

type Transport = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function requestBody(review: LocalReview, operationId: string) {
	const target = review.publicationTarget;
	if (!target) throw new PublicationClientError("invalid_payload");
	if (review.status !== "approved_local")
		throw new PublicationClientError("approved_review_required");
	return {
		schemaVersion: "tda_transcript_publication_request_v1",
		operationId,
		binding: {
			schemaVersion: "tda_publication_target_v1",
			campaignSlug: target.campaignSlug,
			sourceSessionId: target.sourceSessionId,
			sourceId: review.sourceId,
			runId: review.runId,
			jobId: target.jobId,
			attempt: target.attempt,
			transcriptSha256: review.baseTranscriptSha256,
		},
		review: {
			sourceId: review.sourceId,
			runId: review.runId,
			baseTranscriptSha256: review.baseTranscriptSha256,
			draftRevision: review.draftRevision,
			draftSha256: review.draftSha256,
			status: review.status,
			lineage: review.lineage,
			warnings: review.warnings,
			review: review.review,
			segments: review.segments,
		},
	};
}

function parseFailure(value: unknown): PublicationClientError["code"] {
	if (!value || typeof value !== "object")
		return "dependency_unavailable";
	const reason = (value as { reason?: unknown }).reason;
	return typeof reason === "string" &&
		[
			"unauthenticated",
			"forbidden",
			"publish_capability_undefined",
			"invalid_payload",
			"approved_review_required",
			"too_large",
			"not_found",
			"conflict",
			"dependency_unavailable",
		].includes(reason)
		? (reason as PublicationClientError["code"])
		: "dependency_unavailable";
}

async function parseReceipt(response: Response): Promise<PublicationReceiptView> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new PublicationClientError("dependency_unavailable");
	}
	if (!response.ok) throw new PublicationClientError(parseFailure(body));
	if (!body || typeof body !== "object")
		throw new PublicationClientError("dependency_unavailable");
	const receipt = (body as { receipt?: unknown }).receipt;
	if (!receipt || typeof receipt !== "object")
		throw new PublicationClientError("dependency_unavailable");
	const value = receipt as Record<string, unknown>;
	if (
		value.schemaVersion !== "tda_transcript_publication_receipt_v1" ||
		value.status !== "committed" ||
		typeof value.receiptId !== "string" ||
		typeof value.revisionId !== "string" ||
		!Number.isSafeInteger(value.revisionNumber) ||
		(value.revisionNumber as number) < 1 ||
		typeof value.committedAt !== "string"
	)
		throw new PublicationClientError("dependency_unavailable");
	return {
		receiptId: value.receiptId,
		revisionId: value.revisionId,
		revisionNumber: value.revisionNumber as number,
		committedAt: value.committedAt,
	};
}

async function post(
	path: string,
	body: string,
	transport: Transport,
): Promise<Response> {
	return transport(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
		body,
	});
}

export async function publishApprovedLocalReview(
	review: LocalReview,
	operationId: string,
	transport: Transport = fetch,
): Promise<PublicationReceiptView> {
	const body = JSON.stringify(requestBody(review, operationId));
	try {
		return await parseReceipt(
			await post("/api/transcript-publications", body, transport),
		);
	} catch (cause) {
		if (cause instanceof PublicationClientError) throw cause;
	}

	// A network failure after the POST is ambiguous: the atomic commit may have
	// succeeded. Read back the same operation instead of creating a new revision.
	try {
		return await parseReceipt(
			await post("/api/transcript-publications/receipt", body, transport),
		);
	} catch (cause) {
		if (
			cause instanceof PublicationClientError &&
			cause.code !== "not_found"
		)
			throw cause;
		throw new PublicationClientError("unconfirmed");
	}
}
