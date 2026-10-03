import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { presentLembraRow, type LembraReferenceRow } from "./repository";

const hiddenCampaignId = "22222222-2222-4222-8222-222222222222";

const row: LembraReferenceRow = {
	id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	title: "Mapa antigo",
	description: "Referência global",
	status: "active",
	staged_bucket: "tda-media-preview",
	object_key:
		"lembra/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png",
	sha256: "c".repeat(64),
	mime_type: "image/png",
	byte_size: 1024,
	width: 800,
	height: 600,
	read_back_verified: true,
	created_by_auth_user_id: "viewer-auth",
	created_by_name: "Faysk",
	created_at: "2026-10-03T12:00:00.000Z",
	updated_at: "2026-10-03T12:00:00.000Z",
	retired_at: null,
	campaign_id: hiddenCampaignId,
};

describe("Lembra reference campaign projection", () => {
	it("makes an undiscoverable classification indistinguishable from Geral", () => {
		const reference = presentLembraRow(row, "other-auth", null);

		expect(reference?.campaign).toBeNull();
		expect(JSON.stringify(reference)).not.toContain(hiddenCampaignId);
		expect(JSON.stringify(reference)).not.toContain("campaign_id");
	});

	it("reveals only the minimal authorized campaign classification", () => {
		const campaign = {
			id: hiddenCampaignId,
			name: "Passos Retomados",
			lifecycle: "active" as const,
		};
		const reference = presentLembraRow(row, "viewer-auth", campaign);

		expect(reference?.campaign).toEqual(campaign);
		expect(reference).not.toHaveProperty("campaignId");
		expect(JSON.stringify(reference)).not.toContain("technicalSlug");
		expect(JSON.stringify(reference)).not.toContain("routeKey");
		expect(JSON.stringify(reference)).not.toContain("visibility");
	});
});
