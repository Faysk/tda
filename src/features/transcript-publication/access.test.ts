import { describe, expect, it } from "vitest";
import type {
	EditAccessContext,
	EditGrant,
} from "../edit/access/policy";
import {
	authorizePublicationCampaignScope,
	authorizePublicationRequest,
	type PublicationAuthorizationQueries,
} from "./access";

const target = {
	campaignSlug: "yuhara-main",
	sourceSessionId: "sessao-00001",
};
const grant: EditGrant = {
	action: "campaign.transcript.publish",
	scopeType: "campaign",
	scopeId: "yuhara-main",
	status: "active",
	startsAt: "2000-01-01T00:00:00Z",
	endsAt: null,
};
const context: EditAccessContext = {
	authUserId: "operator",
	profileId: "profile",
	grants: [grant],
};

function queries(
	overrides: Partial<PublicationAuthorizationQueries> = {},
): PublicationAuthorizationQueries {
	return {
		physicalAction: async () => ({ ok: true, exists: true }),
		target: async () => ({
			ok: true,
			value: { campaignId: "campaign", sessionId: "session" },
		}),
		...overrides,
	};
}

describe("transcript publication authorization", () => {
	it("requires the physical publish action and exact grant", () => {
		expect(
			authorizePublicationCampaignScope(context, "yuhara-main", false),
		).toEqual({
			ok: false,
			reason: "publish_capability_undefined",
		});
		expect(
			authorizePublicationCampaignScope(
				{ ...context, grants: [] },
				"yuhara-main",
				true,
			),
		).toEqual({ ok: false, reason: "forbidden" });
		expect(
			authorizePublicationCampaignScope(context, "yuhara-main", true),
		).toEqual({
			ok: true,
			actor: { authUserId: "operator", profileId: "profile" },
		});
	});

	it("never resolves a target before campaign scope authorization", async () => {
		const calls: string[] = [];
		const result = await authorizePublicationRequest(
			{ ...context, grants: [] },
			target,
			{
				physicalAction: async () => {
					calls.push("action");
					return { ok: true, exists: true };
				},
				target: async () => {
					calls.push("target");
					return {
						ok: true,
						value: { campaignId: "campaign", sessionId: "session" },
					};
				},
			},
		);
		expect(result).toEqual({ ok: false, reason: "forbidden" });
		expect(calls).toEqual(["action"]);
	});

	it("does not resolve a target when the physical action is absent", async () => {
		let targetCalls = 0;
		const result = await authorizePublicationRequest(
			context,
			target,
			queries({
				physicalAction: async () => ({ ok: true, exists: false }),
				target: async () => {
					targetCalls += 1;
					return {
						ok: true,
						value: { campaignId: "campaign", sessionId: "session" },
					};
				},
			}),
		);
		expect(result).toEqual({
			ok: false,
			reason: "publish_capability_undefined",
		});
		expect(targetCalls).toBe(0);
	});

	it("returns not_found only after the exact scope is authorized", async () => {
		const result = await authorizePublicationRequest(
			context,
			target,
			queries({
				target: async () => ({ ok: false, reason: "not_found" }),
			}),
		);
		expect(result).toEqual({ ok: false, reason: "not_found" });
	});

	it("accepts the project tda scope but no action alias", () => {
		expect(
			authorizePublicationCampaignScope(
				{
					...context,
					grants: [
						{
							...grant,
							scopeType: "project",
							scopeId: "tda",
						},
					],
				},
				"yuhara-main",
				true,
			),
		).toMatchObject({ ok: true });
		expect(
			authorizePublicationCampaignScope(
				{
					...context,
					grants: [
						{
							...grant,
							action: "campaign.transcript.import",
						},
					],
				},
				"yuhara-main",
				true,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});
});
