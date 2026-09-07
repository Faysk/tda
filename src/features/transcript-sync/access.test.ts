import { describe, expect, it } from "vitest";
import { authorizeImportTarget, type ImportTarget } from "./access";
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
describe("import action and resource ownership", () => {
	it("requires physical action, profile and explicit grant", () => {
		expect(authorizeImportTarget(context, identity, target, false).ok).toBe(
			false,
		);
		expect(
			authorizeImportTarget(
				{ ...context, profileId: null },
				identity,
				target,
				true,
			).ok,
		).toBe(false);
		expect(authorizeImportTarget(context, identity, target, true).ok).toBe(
			true,
		);
		for (const action of [
			"campaign.local.process",
			"campaign.upload.manage",
			"campaign.content.edit",
			"project.jobs.run",
		])
			expect(
				authorizeImportTarget(
					{ ...context, grants: [{ ...grant, action }] },
					identity,
					target,
					true,
				).ok,
			).toBe(false);
	});
	it("rejects wrong campaign, source system, source identity and session", () => {
		for (const patch of [
			{ campaignId: "other" },
			{ sourceSystem: "craig" },
			{ sourceSessionId: "other" },
			{ sessionId: "other" },
		])
			expect(
				authorizeImportTarget(context, identity, { ...target, ...patch }, true),
			).toEqual({ ok: false, reason: "not_found" });
	});
	it("does not expand expired, foreign, eligible or future scopes", () => {
		for (const patch of [
			{ scopeId: "other" },
			{ status: "eligible" },
			{ status: "revoked" },
			{ endsAt: "2001-01-01T00:00:00Z" },
			{ startsAt: "2999-01-01T00:00:00Z" },
			{ scopeType: "session", scopeId: "session" },
		])
			expect(
				authorizeImportTarget(
					{ ...context, grants: [{ ...grant, ...patch }] },
					identity,
					target,
					true,
				).ok,
			).toBe(false);
	});
	it("project tda requires the exact action", () => {
		expect(
			authorizeImportTarget(
				{
					...context,
					grants: [{ ...grant, scopeType: "project", scopeId: "tda" }],
				},
				identity,
				target,
				true,
			).ok,
		).toBe(true);
		expect(
			authorizeImportTarget(
				{
					...context,
					grants: [{ ...grant, scopeType: "project", scopeId: "project/tda" }],
				},
				identity,
				target,
				true,
			).ok,
		).toBe(false);
	});
});
