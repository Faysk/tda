import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./authorized", () => ({ readAuthorizedCampaigns: mocks.authorized }));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.client,
}));
import {
	readAuthorizedCampaignRoutes,
	resolveAuthorizedCampaignReference,
} from "./authorized-routes";
const context: EditAccessContext = {
	authUserId: "verified",
	profileId: "profile",
	grants: [],
};
const campaigns = [
	{
		technicalSlug: "yuhara-main",
		name: "Destino Sem Fim",
		lifecycle: "active",
	},
	{
		technicalSlug: "antes-que-seja-tarde",
		name: "Passos Retomados",
		lifecycle: "active",
	},
] as const;
const rows = [
	{ slug: "yuhara-main", public_slug: "destino-sem-fim" },
	{ slug: "antes-que-seja-tarde", public_slug: "passos-retomados" },
];
function database(data: unknown, error: unknown = null) {
	const scope = vi.fn().mockResolvedValue({ data, error });
	mocks.client.mockReturnValue({
		from: vi
			.fn()
			.mockReturnValue({ select: vi.fn().mockReturnValue({ in: scope }) }),
	});
	return scope;
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.authorized.mockResolvedValue({ ok: true, campaigns });
});
describe("authorized campaign addresses", () => {
	it("reports a dependency failure when the authorized directory throws", async () => {
		mocks.authorized.mockRejectedValue(
			new Error("synthetic dependency failure"),
		);
		expect(
			await readAuthorizedCampaignRoutes(context, EDIT_CAPABILITIES.reviewRead),
		).toEqual({ ok: false, reason: "dependency_unavailable" });
	});
	it("projects only authorized identities and resolves both public names and technical compatibility", async () => {
		const scope = database(rows);
		const result = await readAuthorizedCampaignRoutes(
			context,
			EDIT_CAPABILITIES.transcriptRead,
		);
		expect(scope).toHaveBeenCalledWith(
			"slug",
			campaigns.map((campaign) => campaign.technicalSlug),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		for (const [index, row] of rows.entries()) {
			expect(
				resolveAuthorizedCampaignReference(result.campaigns, row.public_slug)
					?.technicalSlug,
			).toBe(campaigns[index]?.technicalSlug);
			expect(
				resolveAuthorizedCampaignReference(result.campaigns, row.slug)
					?.routeKey,
			).toBe(row.public_slug);
		}
		expect(
			resolveAuthorizedCampaignReference(result.campaigns, "private-ungranted"),
		).toBeNull();
	});
	it("does not query addresses when no campaign is authorized", async () => {
		mocks.authorized.mockResolvedValue({ ok: true, campaigns: [] });
		expect(
			await readAuthorizedCampaignRoutes(context, EDIT_CAPABILITIES.reviewRead),
		).toEqual({ ok: true, campaigns: [] });
		expect(mocks.client).not.toHaveBeenCalled();
	});
	it.each([
		[],
		[rows[0]],
		[...rows, rows[0]],
		[...rows, { slug: "ungranted", public_slug: "private" }],
		[rows[0], { ...rows[1], public_slug: rows[0]?.public_slug }],
		[rows[0], { ...rows[1], public_slug: "../private" }],
		null,
	])(
		"fails closed for an incomplete or ambiguous projection %j",
		async (data) => {
			database(data);
			expect(
				await readAuthorizedCampaignRoutes(
					context,
					EDIT_CAPABILITIES.reviewRead,
				),
			).toEqual({ ok: false, reason: "dependency_unavailable" });
		},
	);
	it("preserves authorization dependency failures", async () => {
		mocks.authorized.mockResolvedValue({
			ok: false,
			reason: "profile_unresolved",
		});
		expect(
			await readAuthorizedCampaignRoutes(context, EDIT_CAPABILITIES.reviewRead),
		).toEqual({ ok: false, reason: "profile_unresolved" });
		expect(mocks.client).not.toHaveBeenCalled();
	});
});
