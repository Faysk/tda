import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditAccessContext } from "@/features/edit/access/policy";

const mocks = vi.hoisted(() => ({
	editDataClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.editDataClient,
}));

import {
	authorizedCampaignGrantScope,
	readAuthorizedCampaignAccess,
} from "./authorized";

const NOW = new Date("2026-10-01T00:00:00Z");

beforeEach(() => {
	vi.clearAllMocks();
});

function context(
	grants: EditAccessContext["grants"],
): EditAccessContext {
	return {
		authUserId: "auth-user",
		profileId: "11111111-1111-4111-8111-111111111111",
		grants,
	};
}

function grant(
	action: string,
	scopeType: string,
	scopeId: string,
	overrides: Partial<EditAccessContext["grants"][number]> = {},
) {
	return {
		action,
		scopeType,
		scopeId,
		status: "active",
		startsAt: "2026-01-01T00:00:00Z",
		endsAt: null,
		...overrides,
	};
}

describe("authorized campaign discovery scope", () => {
	it("keeps transcript A/B grants explicit and ignores unrelated capabilities", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "campaign", "campaign-b"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
					grant("narrative.review.read", "campaign", "private-c"),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({
			projectWide: false,
			campaignSlugs: ["campaign-a", "campaign-b"],
		});
	});

	it("lets an exact project/tda grant cover N campaigns without enumerating them from grants", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "project", "tda"),
					grant("campaign.transcript.read", "campaign", "campaign-a"),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({ projectWide: true, campaignSlugs: [] });
	});

	it("does not treat another project, stale, future or revoked grants as discovery authority", () => {
		expect(
			authorizedCampaignGrantScope(
				context([
					grant("campaign.transcript.read", "project", "dnd-scribe"),
					grant("campaign.transcript.read", "campaign", "expired", {
						endsAt: "2026-09-30T23:59:59Z",
					}),
					grant("campaign.transcript.read", "campaign", "future", {
						startsAt: "2026-10-02T00:00:00Z",
					}),
					grant("campaign.transcript.read", "campaign", "revoked", {
						status: "revoked",
					}),
				]),
				"campaign.transcript.read",
				NOW,
			),
		).toEqual({ projectWide: false, campaignSlugs: [] });
	});
});


function campaignQuery(result: Readonly<{ data: unknown; error: unknown }>) {
	const query: Record<string, unknown> = {};
	for (const method of ["select", "order", "eq", "in"]) {
		query[method] = vi.fn(() => query);
	}
	// biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are intentionally thenable to match the client contract.
	query.then = (
		resolve: (value: Readonly<{ data: unknown; error: unknown }>) => unknown,
		reject: (reason: unknown) => unknown,
	) => Promise.resolve(result).then(resolve, reject);
	return query as {
		select: ReturnType<typeof vi.fn>;
		order: ReturnType<typeof vi.fn>;
		eq: ReturnType<typeof vi.fn>;
		in: ReturnType<typeof vi.fn>;
	};
}

describe("authorized campaign access directory", () => {
	it("queries only candidate A/B slugs and filters an unexpected private row again before projection", async () => {
		const query = campaignQuery({
			data: [
				{ slug: "campaign-a", name: "Campanha A", lifecycle: "active" },
				{ slug: "campaign-b", name: "Campanha B", lifecycle: "active" },
				{ slug: "private-c", name: "Privada C", lifecycle: "active" },
			],
			error: null,
		});
		mocks.editDataClient.mockReturnValue({ from: vi.fn(() => query) });
		const access = context([
			grant("campaign.content.edit", "campaign", "campaign-a"),
			grant("campaign.transcript.read", "campaign", "campaign-b"),
		]);

		await expect(
			readAuthorizedCampaignAccess(access, [
				"campaign.content.edit",
				"campaign.transcript.read",
			]),
		).resolves.toEqual({
			ok: true,
			campaigns: [
				{
					technicalSlug: "campaign-a",
					name: "Campanha A",
					lifecycle: "active",
					capabilities: ["campaign.content.edit"],
				},
				{
					technicalSlug: "campaign-b",
					name: "Campanha B",
					lifecycle: "active",
					capabilities: ["campaign.transcript.read"],
				},
			],
		});
		expect(query.in).toHaveBeenCalledWith("slug", ["campaign-a", "campaign-b"]);
	});

	it("lets an exact project/tda capability discover all returned active campaigns", async () => {
		const query = campaignQuery({
			data: [
				{ slug: "campaign-a", name: "Campanha A", lifecycle: "active" },
				{ slug: "campaign-b", name: "Campanha B", lifecycle: "active" },
			],
			error: null,
		});
		mocks.editDataClient.mockReturnValue({ from: vi.fn(() => query) });
		const access = context([
			grant("campaign.transcript.read", "project", "tda"),
		]);

		const result = await readAuthorizedCampaignAccess(access, [
			"campaign.transcript.read",
		]);
		expect(result).toEqual({
			ok: true,
			campaigns: [
				{
					technicalSlug: "campaign-a",
					name: "Campanha A",
					lifecycle: "active",
					capabilities: ["campaign.transcript.read"],
				},
				{
					technicalSlug: "campaign-b",
					name: "Campanha B",
					lifecycle: "active",
					capabilities: ["campaign.transcript.read"],
				},
			],
		});
		expect(query.in).not.toHaveBeenCalled();
	});

	it("fails closed on a directory dependency error", async () => {
		const query = campaignQuery({
			data: null,
			error: { message: "database unavailable" },
		});
		mocks.editDataClient.mockReturnValue({ from: vi.fn(() => query) });
		await expect(
			readAuthorizedCampaignAccess(
				context([
					grant("campaign.content.edit", "campaign", "campaign-a"),
				]),
				["campaign.content.edit"],
			),
		).resolves.toEqual({ ok: false, reason: "dependency_unavailable" });
	});
});
