import { describe, expect, it } from "vitest";
import {
	authorizeImportBoundTarget,
	authorizeImportCampaignScope,
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
const target: ImportTarget = { ...identity, campaignSlug: "yuhara-main" };
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
