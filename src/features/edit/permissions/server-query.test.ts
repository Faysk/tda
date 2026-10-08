import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	identity: vi.fn(),
	access: vi.fn(),
	directory: vi.fn(),
	routes: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({
	getVerifiedServerIdentity: mocks.identity,
}));
vi.mock("../access/repository", () => ({
	loadEditAccessContext: mocks.access,
}));
vi.mock("./repository", () => ({ readPermissionsDirectory: mocks.directory }));
vi.mock("@/features/campaigns/authorized-routes", () => ({
	readAuthorizedCampaignRoutes: mocks.routes,
	resolveAuthorizedCampaignReference: (campaigns: { routeKey: string; technicalSlug: string }[], reference: string) => campaigns.find((campaign) => campaign.routeKey === reference || campaign.technicalSlug === reference) ?? null,
}));
import { getPermissionsForEdit } from "./server-query";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.routes.mockResolvedValue({ ok: true, campaigns: [] });
});
describe("server entry point", () => {
	it.each(["unauthenticated", "dependency_unavailable"])(
		"does not read the directory when identity is %s",
		async (reason) => {
			mocks.identity.mockResolvedValue({ ok: false, reason });
			expect(
				await getPermissionsForEdit({ campaignSlug: "yuhara-main" }),
			).toEqual({ ok: false, reason });
			expect(mocks.access).not.toHaveBeenCalled();
			expect(mocks.directory).not.toHaveBeenCalled();
		},
	);
	it("ignores forged caller fields and uses only server identity", async () => {
		mocks.identity.mockResolvedValue({ ok: true, authUserId: "verified" });
		mocks.access.mockResolvedValue({
			authUserId: "verified",
			profileId: "normal",
			grants: [],
		});
		const malicious = {
			campaignSlug: "yuhara-main",
			authUserId: "owner",
			profileId: "owner",
			user_metadata: { role: "master" },
			action: "campaign.transcript.read",
		};
		expect(await getPermissionsForEdit(malicious)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(mocks.access).toHaveBeenCalledExactlyOnceWith("verified");
		expect(mocks.directory).not.toHaveBeenCalled();
	});
});
