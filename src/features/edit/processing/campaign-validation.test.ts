import { describe, expect, it, vi } from "vitest";
import {
	ProcessingCampaignValidationError,
	validateProcessingCampaignForEnqueue,
} from "./campaign-validation";

describe("processing campaign enqueue guard", () => {
	it("accepts a server-authorized active campaign", async () => {
		const transport = vi.fn(async () =>
			new Response(JSON.stringify({ ok: true, campaignSlug: "campaign-a" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		await expect(
			validateProcessingCampaignForEnqueue(
				"campaign-a",
				undefined,
				transport as typeof fetch,
			),
		).resolves.toBeUndefined();
		expect(transport).toHaveBeenCalledOnce();
	});

	it("fails closed when the campaign was archived or authorization changed after the form opened", async () => {
		const transport = vi.fn(async () =>
			new Response(
				JSON.stringify({ ok: false, reason: "campaign_unavailable" }),
				{
					status: 409,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		await expect(
			validateProcessingCampaignForEnqueue(
				"campaign-a",
				undefined,
				transport as typeof fetch,
			),
		).rejects.toMatchObject<Partial<ProcessingCampaignValidationError>>({
			code: "campaign_unavailable",
		});
	});

	it("treats network and malformed dependency responses as unavailable instead of enqueueing optimistically", async () => {
		const unavailable = vi.fn(async () => {
			throw new Error("offline");
		});
		await expect(
			validateProcessingCampaignForEnqueue(
				"campaign-a",
				undefined,
				unavailable as typeof fetch,
			),
		).rejects.toMatchObject<Partial<ProcessingCampaignValidationError>>({
			code: "dependency_unavailable",
		});

		const malformed = vi.fn(async () => new Response("<html>nope</html>", { status: 503 }));
		await expect(
			validateProcessingCampaignForEnqueue(
				"campaign-a",
				undefined,
				malformed as typeof fetch,
			),
		).rejects.toMatchObject<Partial<ProcessingCampaignValidationError>>({
			code: "dependency_unavailable",
		});
	});
});
