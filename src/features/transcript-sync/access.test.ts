import { describe, expect, it } from "vitest";
import {
	authorizeImportBoundTarget,
	authorizeImportCampaignScope,
	authorizeImportRequest,
	type ImportAuthorizationQueries,
	type ImportTarget,
} from "./access";
import type { ImportIdentity } from "./contract";
import type { EditAccessContext, EditGrant } from "../edit/access/policy";

const identity: ImportIdentity = {
	campaignId: "campaign",
	sessionId: "session",
	sourceSystem: "local_companion",
	sourceSessionId: "source",
	publicationId: "hash",
	transcriptSha256: "hash",
};
const target: ImportTarget = { ...identity };
const grant: EditGrant = {
	action: "campaign.transcript.import",
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

describe("import campaign scope authorization", () => {
	it("requires physical action, profile and explicit grant before target resolution", () => {
		expect(authorizeImportCampaignScope(context, "yuhara-main", false)).toEqual({
			ok: false,
			reason: "import_capability_undefined",
		});
		expect(
			authorizeImportCampaignScope(
				{ ...context, profileId: null },
				"yuhara-main",
				true,
			),
		).toEqual({ ok: false, reason: "forbidden" });
		expect(authorizeImportCampaignScope(context, null, true)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(authorizeImportCampaignScope(context, "yuhara-main", true)).toEqual({
			ok: true,
			actor: { authUserId: "operator", profileId: "profile" },
		});
		for (const action of [
			"campaign.local.process",
			"campaign.upload.manage",
			"campaign.content.edit",
			"project.jobs.run",
		]) {
			expect(
				authorizeImportCampaignScope(
					{ ...context, grants: [{ ...grant, action }] },
					"yuhara-main",
					true,
				),
			).toEqual({ ok: false, reason: "forbidden" });
		}
	});

	it("does not expand expired, foreign, eligible or future scopes", () => {
		for (const patch of [
			{ scopeId: "other" },
			{ status: "eligible" },
			{ status: "revoked" },
			{ endsAt: "2001-01-01T00:00:00Z" },
			{ startsAt: "2999-01-01T00:00:00Z" },
			{ scopeType: "session", scopeId: "session" },
		]) {
			expect(
				authorizeImportCampaignScope(
					{ ...context, grants: [{ ...grant, ...patch }] },
					"yuhara-main",
					true,
				),
			).toEqual({ ok: false, reason: "forbidden" });
		}
	});

	it("project tda requires the exact action", () => {
		expect(
			authorizeImportCampaignScope(
				{
					...context,
					grants: [{ ...grant, scopeType: "project", scopeId: "tda" }],
				},
				"yuhara-main",
				true,
			),
		).toEqual({
			ok: true,
			actor: { authUserId: "operator", profileId: "profile" },
		});
		expect(
			authorizeImportCampaignScope(
				{
					...context,
					grants: [
						{ ...grant, scopeType: "project", scopeId: "project/tda" },
					],
				},
				"yuhara-main",
				true,
			),
		).toEqual({ ok: false, reason: "forbidden" });
	});
});

describe("authorized import target binding", () => {
	const actor = { authUserId: "operator", profileId: "profile" };

	it("rejects missing or mismatched targets only after scope authorization", () => {
		expect(authorizeImportBoundTarget(actor, identity, null)).toEqual({
			ok: false,
			reason: "not_found",
		});
		for (const patch of [
			{ campaignId: "other" },
			{ sourceSystem: "craig" },
			{ sourceSessionId: "other" },
			{ sessionId: "other" },
		]) {
			expect(
				authorizeImportBoundTarget(actor, identity, { ...target, ...patch }),
			).toEqual({ ok: false, reason: "not_found" });
		}
	});

	it("returns the already-authorized actor for the exact bound target", () => {
		expect(authorizeImportBoundTarget(actor, identity, target)).toEqual({
			ok: true,
			actor,
		});
	});
});


describe("import authorization query order", () => {
	function queries(
		overrides: Partial<ImportAuthorizationQueries> = {},
	): ImportAuthorizationQueries {
		return {
			physicalAction: async () => ({ ok: true, exists: true }),
			campaignSlug: async () => ({ ok: true, value: "yuhara-main" }),
			target: async () => ({ ok: true, value: target }),
			...overrides,
		};
	}

	it("never resolves the target session for a denied operator", async () => {
		const calls: string[] = [];
		const denied = { ...context, grants: [] };
		const result = await authorizeImportRequest(denied, identity, {
			physicalAction: async () => {
				calls.push("action");
				return { ok: true, exists: true };
			},
			campaignSlug: async () => {
				calls.push("campaign");
				return { ok: true, value: "yuhara-main" };
			},
			target: async () => {
				calls.push("target");
				return { ok: true, value: target };
			},
		});

		expect(result).toEqual({ ok: false, reason: "forbidden" });
		expect(calls).toEqual(["action", "campaign"]);
	});

	it("keeps missing and existing targets opaque until scope is authorized", async () => {
		for (const targetResult of [
			{ ok: true as const, value: target },
			{ ok: false as const, reason: "not_found" as const },
		]) {
			let targetCalls = 0;
			const result = await authorizeImportRequest(
				{ ...context, grants: [] },
				identity,
				queries({
					target: async () => {
						targetCalls += 1;
						return targetResult;
					},
				}),
			);
			expect(result).toEqual({ ok: false, reason: "forbidden" });
			expect(targetCalls).toBe(0);
		}
	});

	it("distinguishes not_found only after the exact scope is authorized", async () => {
		const calls: string[] = [];
		const result = await authorizeImportRequest(context, identity, {
			physicalAction: async () => {
				calls.push("action");
				return { ok: true, exists: true };
			},
			campaignSlug: async () => {
				calls.push("campaign");
				return { ok: true, value: "yuhara-main" };
			},
			target: async () => {
				calls.push("target");
				return { ok: false, reason: "not_found" };
			},
		});

		expect(result).toEqual({ ok: false, reason: "not_found" });
		expect(calls).toEqual(["action", "campaign", "target"]);
	});

	it("fails closed before target lookup when the physical capability is absent", async () => {
		const campaignSlug = async () => {
			throw new Error("campaign lookup must not run");
		};
		const targetLookup = async () => {
			throw new Error("target lookup must not run");
		};

		expect(
			await authorizeImportRequest(
				context,
				identity,
				queries({
					physicalAction: async () => ({ ok: true, exists: false }),
					campaignSlug,
					target: targetLookup,
				}),
			),
		).toEqual({ ok: false, reason: "import_capability_undefined" });
	});
});
