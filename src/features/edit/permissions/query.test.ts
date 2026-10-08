import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditGrant,
} from "../access/policy";
import { queryPermissions } from "./query";

const actorProfileId = "11111111-1111-4111-8111-111111111111";
const grant: EditGrant = {
	action: EDIT_CAPABILITIES.permissionsManage,
	scopeType: "campaign",
	scopeId: "yuhara-main",
	status: "active",
	startsAt: "2020-01-01",
	endsAt: null,
};
const directory = {
	campaign: { slug: "yuhara-main", name: "Sintética" },
	actorProfileId,
	people: [],
	roles: [],
	history: [],
	checkedAt: "2026-09-28T00:00:00Z",
};

function setup(
	grants: readonly EditGrant[] = [grant],
	profileId: string | null = actorProfileId,
) {
	const context: EditAccessContext = {
		authUserId: "verified",
		profileId,
		grants,
	};
	return {
		resolveAccessContext: vi.fn().mockResolvedValue(context),
		readDirectory: vi.fn().mockResolvedValue(directory),
	};
}

describe("permissions boundary", () => {
	it("does not resolve addresses before the server profile is linked", async () => {
		const dependencies = { ...setup([], null), resolveCampaignReference: vi.fn() };
		expect(await queryPermissions("verified", { campaignSlug: "destino-sem-fim" }, dependencies)).toEqual({ ok: false, reason: "profile_unresolved" });
		expect(dependencies.resolveCampaignReference).not.toHaveBeenCalled();
	});
	it("resolves a public address before checking the technical permission scope", async () => {
		const dependencies = { ...setup(), resolveCampaignReference: vi.fn().mockResolvedValue("yuhara-main") };
		expect(await queryPermissions("verified", { campaignSlug: "destino-sem-fim" }, dependencies)).toEqual({ ok: true, value: directory });
		expect(dependencies.readDirectory).toHaveBeenCalledWith("yuhara-main", actorProfileId, [EDIT_CAPABILITIES.permissionsManage]);
	});
	it("does not let address resolution grant authority", async () => {
		const dependencies = { ...setup([]), resolveCampaignReference: vi.fn().mockResolvedValue("yuhara-main") };
		expect(await queryPermissions("verified", { campaignSlug: "destino-sem-fim" }, dependencies)).toEqual({ ok: false, reason: "forbidden" });
		expect(dependencies.readDirectory).not.toHaveBeenCalled();
	});
	it("rejects anonymous access before all data reads", async () => {
		const dependencies = setup();
		expect(
			await queryPermissions(
				null,
				{ campaignSlug: "yuhara-main" },
				dependencies,
			),
		).toEqual({ ok: false, reason: "unauthenticated" });
		expect(dependencies.resolveAccessContext).not.toHaveBeenCalled();
		expect(dependencies.readDirectory).not.toHaveBeenCalled();
	});

	it.each([
		{ action: "campaign.transcript.read" },
		{ action: "campaign.access.manage" },
		{ action: "project.rbac.manage" },
		{ scopeId: "other" },
		{ scopeType: "project", scopeId: "project/tda" },
		{ scopeType: "project", scopeId: "dnd-scribe" },
		{ scopeType: "session" },
		{ status: "eligible" },
		{ status: "revoked" },
		{ endsAt: "2020-01-01" },
	])("denies unauthorized grant %j without reading directory", async (override) => {
		const dependencies = setup([{ ...grant, ...override }]);
		expect(
			await queryPermissions(
				"verified",
				{ campaignSlug: "yuhara-main" },
				dependencies,
			),
		).toEqual({ ok: false, reason: "forbidden" });
		expect(dependencies.readDirectory).not.toHaveBeenCalled();
	});

	it("passes the verified actor and only effective actor actions to the repository", async () => {
		const dependencies = setup([
			grant,
			{
				action: EDIT_CAPABILITIES.transcriptRead,
				scopeType: "campaign",
				scopeId: "yuhara-main",
				status: "active",
				startsAt: "2020-01-01",
				endsAt: null,
			},
			{
				action: EDIT_CAPABILITIES.sessionPublish,
				scopeType: "campaign",
				scopeId: "other",
				status: "active",
				startsAt: "2020-01-01",
				endsAt: null,
			},
		]);
		expect(
			await queryPermissions(
				"verified",
				{ campaignSlug: "yuhara-main" },
				dependencies,
			),
		).toEqual({ ok: true, value: directory });
		expect(dependencies.readDirectory).toHaveBeenCalledExactlyOnceWith(
			"yuhara-main",
			actorProfileId,
			[
				"campaign.permissions.manage",
				"campaign.transcript.read",
			],
		);
	});

	it("fails closed if the repository projects another actor or campaign", async () => {
		for (const value of [
			{ ...directory, actorProfileId: "22222222-2222-4222-8222-222222222222" },
			{ ...directory, campaign: { slug: "other", name: "PRIVATE" } },
		]) {
			const dependencies = setup();
			dependencies.readDirectory.mockResolvedValue(value);
			expect(
				await queryPermissions(
					"verified",
					{ campaignSlug: "yuhara-main" },
					dependencies,
				),
			).toEqual({ ok: false, reason: "dependency_unavailable" });
		}
	});

	it.each(["bad,or(scope_id.eq.other)", "", "A", "a".repeat(81)])(
		"rejects malformed scope %s",
		async (campaignSlug) => {
			const dependencies = setup();
			expect(
				await queryPermissions("verified", { campaignSlug }, dependencies),
			).toEqual({ ok: false, reason: "validation" });
			expect(dependencies.resolveAccessContext).not.toHaveBeenCalled();
		},
	);
});
