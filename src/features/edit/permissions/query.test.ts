import { describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditGrant,
} from "../access/policy";
import { queryPermissions } from "./query";

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
	people: [],
	checkedAt: "2026-09-07T00:00:00Z",
};
function setup(
	grants: readonly EditGrant[] = [grant],
	profileId: string | null = "profile",
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
		{ scopeType: "resource" },
		{ status: "eligible" },
		{ status: "revoked" },
		{ status: "ended" },
		{ startsAt: "2099-01-01" },
		{ endsAt: "2020-01-01" },
		{ startsAt: "invalid" },
	])(
		"denies unauthorized grant %j without reading directory",
		async (override) => {
			const dependencies = setup([{ ...grant, ...override }]);
			expect(
				await queryPermissions(
					"verified",
					{ campaignSlug: "yuhara-main" },
					dependencies,
				),
			).toEqual({ ok: false, reason: "forbidden" });
			expect(dependencies.readDirectory).not.toHaveBeenCalled();
		},
	);
	it("login without grants or linked profile never authorizes", async () => {
		for (const profileId of [null, "profile"]) {
			const dependencies = setup([], profileId);
			expect(
				(
					await queryPermissions(
						"verified",
						{ campaignSlug: "yuhara-main" },
						dependencies,
					)
				).ok,
			).toBe(false);
			expect(dependencies.readDirectory).not.toHaveBeenCalled();
		}
	});
	it.each([grant, { ...grant, scopeType: "project", scopeId: "tda" }])(
		"allows the exact approved direct or inherited action",
		async (allowed) => {
			const dependencies = setup([allowed]);
			expect(
				await queryPermissions(
					"verified",
					{ campaignSlug: "yuhara-main" },
					dependencies,
				),
			).toEqual({ ok: true, value: directory });
			expect(dependencies.readDirectory).toHaveBeenCalledExactlyOnceWith(
				"yuhara-main",
			);
		},
	);
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
	it("fails closed for null, mismatched, or failed dependencies with no raw error", async () => {
		for (const value of [
			null,
			{ authUserId: "another", profileId: "profile", grants: [grant] },
		]) {
			const dependencies = setup();
			dependencies.resolveAccessContext.mockResolvedValue(value);
			expect(
				await queryPermissions(
					"verified",
					{ campaignSlug: "yuhara-main" },
					dependencies,
				),
			).toEqual({ ok: false, reason: "dependency_unavailable" });
			expect(dependencies.readDirectory).not.toHaveBeenCalled();
		}
		for (const stage of ["resolveAccessContext", "readDirectory"] as const) {
			const dependencies = setup();
			dependencies[stage].mockRejectedValue(
				new Error("private secret SQL detail"),
			);
			expect(
				await queryPermissions(
					"verified",
					{ campaignSlug: "yuhara-main" },
					dependencies,
				),
			).toEqual({ ok: false, reason: "dependency_unavailable" });
		}
	});
	it("does not leak a dependency response from another campaign", async () => {
		const dependencies = setup();
		dependencies.readDirectory.mockResolvedValue({
			...directory,
			campaign: { slug: "other", name: "PRIVATE" },
		});
		expect(
			await queryPermissions(
				"verified",
				{ campaignSlug: "yuhara-main" },
				dependencies,
			),
		).toEqual({ ok: false, reason: "dependency_unavailable" });
	});
	it("distinguishes authorized empty data from a nonexistent campaign", async () => {
		const dependencies = setup();
		dependencies.readDirectory.mockResolvedValue(null);
		expect(
			await queryPermissions(
				"verified",
				{ campaignSlug: "yuhara-main" },
				dependencies,
			),
		).toEqual({ ok: false, reason: "not_found" });
	});
});
