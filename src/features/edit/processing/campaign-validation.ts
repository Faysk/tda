"use client";

export type ProcessingCampaignValidationFailure =
	| "campaign_unavailable"
	| "dependency_unavailable";

export class ProcessingCampaignValidationError extends Error {
	constructor(
		public readonly code: ProcessingCampaignValidationFailure,
	) {
		super(code);
		this.name = "ProcessingCampaignValidationError";
	}
}

export async function validateProcessingCampaignForEnqueue(
	campaignSlug: string,
	signal?: AbortSignal,
	transport: typeof fetch = fetch,
): Promise<void> {
	let response: Response;
	try {
		response = await transport("/api/edit/processing/campaign-context", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			cache: "no-store",
			redirect: "error",
			referrerPolicy: "no-referrer",
			body: JSON.stringify({ campaignSlug }),
			signal,
		});
	} catch {
		throw new ProcessingCampaignValidationError("dependency_unavailable");
	}
	if (response.ok) return;

	let reason: unknown = null;
	try {
		const body = (await response.json()) as { reason?: unknown };
		reason = body.reason;
	} catch {
		// Invalid server payload fails closed as dependency unavailable.
	}
	throw new ProcessingCampaignValidationError(
		reason === "campaign_unavailable"
			? "campaign_unavailable"
			: "dependency_unavailable",
	);
}
