import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getIdentity: vi.fn(),
	resolveCampaign: vi.fn(),
	loadCampaignContext: vi.fn(),
	loadRow: vi.fn(),
	updateMetadata: vi.fn(),
	presentRow: vi.fn(),
	lembraEnabled: vi.fn(),
	client: vi.fn(),
	insertReference: vi.fn(),
	retireReference: vi.fn(),
	setFavorite: vi.fn(),
	finalizeUpload: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./access", () => ({
	getLembraIdentity: mocks.getIdentity,
}));
vi.mock("./campaign-directory", () => ({
	resolveLembraCampaignSelection: mocks.resolveCampaign,
	loadLembraCampaignContext: mocks.loadCampaignContext,
}));
vi.mock("./repository", () => ({
	loadLembraReferenceRow: mocks.loadRow,
	updateLembraReferenceMetadata: mocks.updateMetadata,
	presentLembraRow: mocks.presentRow,
	insertLembraReference: mocks.insertReference,
	retireLembraReference: mocks.retireReference,
	setLembraFavorite: mocks.setFavorite,
}));
vi.mock("./server", () => ({
	lembraPersistenceEnabled: mocks.lembraEnabled,
	finalizeLembraPendingUpload: mocks.finalizeUpload,
}));
vi.mock("@/integrations/supabase/server", () => ({
	lembraDataClient: mocks.client,
}));

import { updateLembraReferenceAction } from "./actions";

const REFERENCE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HIDDEN_CAMPAIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const VISIBLE_CAMPAIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UPDATED_AT = "2026-10-03T03:00:00.000Z";

function currentRow(campaignId: string | null) {
	return {
		id: REFERENCE_ID,
		status: "active",
		updated_at: UPDATED_AT,
		campaign_id: campaignId,
	};
}

describe("Lembra campaign mutation authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.lembraEnabled.mockReturnValue(true);
		mocks.client.mockReturnValue({});
		mocks.getIdentity.mockResolvedValue({
			ok: true,
			identity: {
				authUserId: "auth-a",
				displayName: "U2",
			},
		});
		mocks.presentRow.mockImplementation((row: unknown) => ({
			id: REFERENCE_ID,
			title: "Renamed",
			description: "",
			author: "U2",
			authorAuthUserId: "auth-a",
			createdAt: UPDATED_AT,
			updatedAt: UPDATED_AT,
			imageUrl: "/fixture.png",
			mine: true,
			campaign: null,
			...(row ? {} : {}),
		}));
	});

	it("preserves an undiscoverable private classification during ordinary metadata edits", async () => {
		mocks.loadRow.mockResolvedValue(currentRow(HIDDEN_CAMPAIGN));
		mocks.resolveCampaign.mockResolvedValue(null);
		mocks.updateMetadata.mockResolvedValue(currentRow(HIDDEN_CAMPAIGN));

		const result = await updateLembraReferenceAction(
			REFERENCE_ID,
			"Renamed",
			"",
			{ mode: "preserve" },
			UPDATED_AT,
		);

		expect(result.ok).toBe(true);
		expect(mocks.updateMetadata).toHaveBeenCalledWith(
			{},
			REFERENCE_ID,
			"Renamed",
			"",
			HIDDEN_CAMPAIGN,
			UPDATED_AT,
		);
	});

	it("denies a forged clear when the current private classification is hidden", async () => {
		mocks.loadRow.mockResolvedValue(currentRow(HIDDEN_CAMPAIGN));
		mocks.resolveCampaign.mockResolvedValue(null);

		await expect(
			updateLembraReferenceAction(
				REFERENCE_ID,
				"Renamed",
				"",
				{ mode: "clear" },
				UPDATED_AT,
			),
		).resolves.toEqual({ ok: false, reason: "invalid_payload" });
		expect(mocks.updateMetadata).not.toHaveBeenCalled();
	});

	it("denies replacing a hidden classification even when the requested target is otherwise known", async () => {
		mocks.loadRow.mockResolvedValue(currentRow(HIDDEN_CAMPAIGN));
		mocks.resolveCampaign.mockResolvedValueOnce(null);

		await expect(
			updateLembraReferenceAction(
				REFERENCE_ID,
				"Renamed",
				"",
				{ mode: "set", campaignId: VISIBLE_CAMPAIGN },
				UPDATED_AT,
			),
		).resolves.toEqual({ ok: false, reason: "invalid_payload" });
		expect(mocks.resolveCampaign).toHaveBeenCalledTimes(1);
		expect(mocks.updateMetadata).not.toHaveBeenCalled();
	});

	it("allows explicit clear when the current classification is discoverable", async () => {
		mocks.loadRow.mockResolvedValue(currentRow(VISIBLE_CAMPAIGN));
		mocks.resolveCampaign.mockResolvedValue({
			id: VISIBLE_CAMPAIGN,
			name: "Destino Sem Fim",
			lifecycle: "active",
		});
		mocks.updateMetadata.mockResolvedValue(currentRow(null));

		const result = await updateLembraReferenceAction(
			REFERENCE_ID,
			"Renamed",
			"",
			{ mode: "clear" },
			UPDATED_AT,
		);

		expect(result.ok).toBe(true);
		expect(mocks.updateMetadata).toHaveBeenCalledWith(
			{},
			REFERENCE_ID,
			"Renamed",
			"",
			null,
			UPDATED_AT,
		);
	});
});
