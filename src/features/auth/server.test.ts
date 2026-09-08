import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	getUser: vi.fn(),
	load: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
	cookies: async () => ({ getAll: () => [] }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./client", () => ({
	authClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/features/edit/access/repository", () => ({
	loadEditAccessContext: mocks.load,
}));
vi.mock(
	"@/features/edit/access/policy",
	async () => import("../edit/access/policy"),
);
vi.mock("@/features/sessions/model", () => ({ CAMPAIGN_SLUG: "yuhara-main" }));
import {
	authorizeCampaignCapabilityServer,
	getVerifiedServerIdentity,
	currentAccess,
	requireCapability,
} from "./server";
const input = {
	action: "campaign.content.edit",
	campaignSlug: "yuhara-main",
} as const;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getUser.mockResolvedValue({
		data: { user: { id: "verified", user_metadata: { role: "owner" } } },
		error: null,
	});
	mocks.load.mockResolvedValue({
		authUserId: "verified",
		profileId: "profile",
		grants: [],
	});
});
describe("verified identity and authorization", () => {
	it("denies forged metadata and uses only the verified auth user", async () => {
		expect(await authorizeCampaignCapabilityServer(input)).toEqual({
			ok: false,
			reason: "forbidden",
		});
		expect(mocks.load).toHaveBeenCalledWith("verified");
	});
	it("denies expired or invalid sessions before profile lookup", async () => {
		mocks.getUser.mockResolvedValue({
			data: { user: null },
			error: { status: 401 },
		});
		expect(await authorizeCampaignCapabilityServer(input)).toEqual({
			ok: false,
			reason: "unauthenticated",
		});
		expect(mocks.load).not.toHaveBeenCalled();
	});
	it("distinguishes unavailable service from invalid identity", async () => {
		mocks.getUser.mockRejectedValue(new Error("timeout"));
		expect(await getVerifiedServerIdentity()).toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
	});
	it("preserves unlinked and no-grants account states", async () => {
		mocks.load.mockResolvedValueOnce({
			authUserId: "verified",
			profileId: null,
			grants: [],
		});
		expect((await currentAccess()).state).toBe("authenticated_unlinked");
		expect((await currentAccess()).state).toBe(
			"authenticated_linked_no_grants",
		);
	});
	it("routes unavailable checks separately from forbidden access", async () => {
		mocks.getUser.mockRejectedValueOnce(new Error("timeout"));
		await expect(requireCapability(input.action, "/edit")).rejects.toThrow(
			"redirect:/conta?acesso=indisponivel",
		);
		expect(mocks.redirect).toHaveBeenCalledWith(
			"/conta?acesso=indisponivel",
		);
	});
	it("routes authenticated users without the capability to access denied", async () => {
		await expect(requireCapability(input.action, "/edit")).rejects.toThrow(
			"redirect:/conta?acesso=negado",
		);
		expect(mocks.redirect).toHaveBeenCalledWith("/conta?acesso=negado");
	});
	it("allows exact active capability and rejects other campaign", async () => {
		mocks.load.mockResolvedValue({
			authUserId: "verified",
			profileId: "profile",
			grants: [
				{
					action: input.action,
					scopeType: "campaign",
					scopeId: "yuhara-main",
					status: "active",
					startsAt: "2020-01-01",
					endsAt: null,
				},
			],
		});
		expect(await authorizeCampaignCapabilityServer(input)).toEqual({
			ok: true,
			authUserId: "verified",
			profileId: "profile",
		});
		expect(
			await authorizeCampaignCapabilityServer({
				...input,
				campaignSlug: "other",
			}),
		).toEqual({ ok: false, reason: "forbidden" });
	});
});
