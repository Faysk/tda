import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({
	rpc: vi.fn(),
	serverAuthClient: vi.fn(),
}));

vi.mock("@/features/auth/server", () => ({
	serverAuthClient: auth.serverAuthClient,
}));

import {
	loadDiscoverableLembraCampaigns,
	resolveDiscoverableLembraCampaign,
} from "./campaign-discovery";

type CampaignFixture = Readonly<{
	id: string;
	slug: string;
	name: string;
	lifecycle: "active" | "archived";
	visibility: "public" | "private";
}>;

const A: CampaignFixture = {
	id: "11111111-1111-4111-8111-111111111111",
	slug: "campaign-a",
	name: "Campanha A",
	lifecycle: "active",
	visibility: "public",
};
const B: CampaignFixture = {
	id: "22222222-2222-4222-8222-222222222222",
	slug: "campaign-b",
	name: "Campanha B privada",
	lifecycle: "active",
	visibility: "private",
};
const C: CampaignFixture = {
	id: "33333333-3333-4333-8333-333333333333",
	slug: "campaign-c",
	name: "Campanha C arquivada",
	lifecycle: "archived",
	visibility: "private",
};

function rpcRow(campaign: CampaignFixture) {
	return {
		id: campaign.id,
		technicalSlug: campaign.slug,
		routeKey: `route-${campaign.slug}`,
		name: campaign.name,
		lifecycle: campaign.lifecycle,
		visibility: campaign.visibility,
	};
}

function fakeCampaignClient(rows: readonly CampaignFixture[]) {
	function query(current: readonly CampaignFixture[]) {
		return Object.assign(
			Promise.resolve({ data: [...current], error: null }),
			{
				select() {
					return query(current);
				},
				eq(column: string, value: unknown) {
					return query(
						current.filter(
							(row) => row[column as keyof CampaignFixture] === value,
						),
					);
				},
				order() {
					return query(current);
				},
				maybeSingle() {
					return Promise.resolve({
						data: current.length === 1 ? current[0] : null,
						error: null,
					});
				},
			},
		);
	}

	return {
		from(table: string) {
			if (table !== "campaigns") throw new Error(`unexpected table: ${table}`);
			return query(rows);
		},
	};
}

describe("Lembra privacy-safe campaign discovery", () => {
	beforeEach(() => {
		auth.rpc.mockReset();
		auth.serverAuthClient.mockReset();
		auth.serverAuthClient.mockResolvedValue({ rpc: auth.rpc });
	});

	it("projects public A plus only the private campaigns returned by hardened discovery", async () => {
		auth.rpc.mockResolvedValue({
			data: [rpcRow(A), rpcRow(B), rpcRow(C)],
			error: null,
		});

		const campaigns = await loadDiscoverableLembraCampaigns(
			fakeCampaignClient([A, B, C]) as never,
		);

		expect(auth.rpc).toHaveBeenCalledWith("campaign_edit_directory");
		expect(campaigns).toEqual([
			{ id: A.id, name: A.name, lifecycle: "active" },
			{ id: B.id, name: B.name, lifecycle: "active" },
			{ id: C.id, name: C.name, lifecycle: "archived" },
		]);
		expect(campaigns.every((campaign) => !("technicalSlug" in campaign))).toBe(
			true,
		);
		expect(campaigns.every((campaign) => !("routeKey" in campaign))).toBe(true);
		expect(campaigns.every((campaign) => !("visibility" in campaign))).toBe(
			true,
		);
	});

	it("keeps B and C completely undiscoverable when the RPC omits them", async () => {
		auth.rpc.mockResolvedValue({ data: [rpcRow(A)], error: null });

		const campaigns = await loadDiscoverableLembraCampaigns(
			fakeCampaignClient([A, B, C]) as never,
		);

		expect(campaigns).toEqual([
			{ id: A.id, name: A.name, lifecycle: "active" },
		]);
	});

	it("fails a forged private UUID closed while allowing the same target after authorization", async () => {
		auth.rpc.mockResolvedValueOnce({ data: [rpcRow(A)], error: null });
		await expect(
			resolveDiscoverableLembraCampaign(
				fakeCampaignClient([A, B, C]) as never,
				B.id,
			),
		).resolves.toBeNull();

		auth.rpc.mockResolvedValueOnce({
			data: [rpcRow(A), rpcRow(B)],
			error: null,
		});
		await expect(
			resolveDiscoverableLembraCampaign(
				fakeCampaignClient([A, B, C]) as never,
				B.id,
			),
		).resolves.toEqual({
			id: B.id,
			name: B.name,
			lifecycle: "active",
		});
	});

	it("observes revocation on the next resolution instead of trusting a stale projection", async () => {
		auth.rpc
			.mockResolvedValueOnce({
				data: [rpcRow(A), rpcRow(B)],
				error: null,
			})
			.mockResolvedValueOnce({ data: [rpcRow(A)], error: null });

		await expect(
			loadDiscoverableLembraCampaigns(
				fakeCampaignClient([A, B, C]) as never,
			),
		).resolves.toContainEqual({
			id: B.id,
			name: B.name,
			lifecycle: "active",
		});

		await expect(
			resolveDiscoverableLembraCampaign(
				fakeCampaignClient([A, B, C]) as never,
				B.id,
			),
		).resolves.toBeNull();
	});
});
