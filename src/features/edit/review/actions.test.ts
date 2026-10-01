import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorize: vi.fn(),
	editDataClient: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error("NEXT_REDIRECT:" + url);
	}),
	revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorize,
}));
vi.mock("@/integrations/supabase/server", () => ({
	editDataClient: mocks.editDataClient,
}));

import { reviewCanonCandidateFormAction } from "./actions";

const CANDIDATE = "70707070-7070-4070-8070-707070707070";

function form(
	overrides: Record<string, string> = {},
) {
	const data = new FormData();
	for (const [key, value] of Object.entries({
		campaignSlug: "campaign-b",
		candidateId: CANDIDATE,
		decision: "rejected",
		reviewerNotes: "Synthetic note",
		...overrides,
	}))
		data.set(key, value);
	return data;
}

function client(
	lifecycle: "active" | "archived" | null = "active",
	rpcData: unknown = { ok: true, status: "reviewed" },
) {
	const maybeSingle = vi.fn().mockResolvedValue({
		data: lifecycle ? { lifecycle } : null,
		error: null,
	});
	const eq = vi.fn().mockReturnValue({ maybeSingle });
	const select = vi.fn().mockReturnValue({ eq });
	const from = vi.fn().mockReturnValue({ select });
	const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: null });
	return { value: { from, rpc }, rpc };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authorize.mockResolvedValue({
		ok: true,
		authUserId: "auth-user",
		profileId: "11111111-1111-4111-8111-111111111111",
	});
});

describe("campaign-scoped narrative review action", () => {
	it("reauthorizes the posted campaign and forwards the same identity to the atomic RPC", async () => {
		const db = client();
		mocks.editDataClient.mockReturnValue(db.value);

		await expect(reviewCanonCandidateFormAction(form())).rejects.toThrow(
			"NEXT_REDIRECT:/edit/revisao?campanha=campaign-b&resultado=rejected",
		);
		expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
			action: "narrative.review.manage",
			campaignSlug: "campaign-b",
		});
		expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
			"review_canon_candidate_atomic",
			expect.objectContaining({
				p_campaign_slug: "campaign-b",
				p_candidate_id: CANDIDATE,
			}),
		);
	});

	it("keeps a candidate from campaign A undecidable when posted in campaign B context", async () => {
		const db = client("active", { ok: false, reason: "not_found" });
		mocks.editDataClient.mockReturnValue(db.value);

		await expect(reviewCanonCandidateFormAction(form())).rejects.toThrow(
			"NEXT_REDIRECT:/edit/revisao?campanha=campaign-b&erro=not_found",
		);
		expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
			"review_canon_candidate_atomic",
			expect.objectContaining({ p_campaign_slug: "campaign-b" }),
		);
	});

	it("fails a stale tab immediately after permission revocation", async () => {
		mocks.authorize.mockResolvedValue({ ok: false, reason: "forbidden" });

		await expect(reviewCanonCandidateFormAction(form())).rejects.toThrow(
			"NEXT_REDIRECT:/edit/revisao?campanha=campaign-b&erro=forbidden",
		);
		expect(mocks.editDataClient).not.toHaveBeenCalled();
	});

	it("blocks new decisions when the selected campaign has been archived", async () => {
		const db = client("archived");
		mocks.editDataClient.mockReturnValue(db.value);

		await expect(reviewCanonCandidateFormAction(form())).rejects.toThrow(
			"NEXT_REDIRECT:/edit/revisao?campanha=campaign-b&erro=campaign_archived",
		);
		expect(db.rpc).not.toHaveBeenCalled();
	});

	it("does not use an untrusted campaign value as authority", async () => {
		await expect(
			reviewCanonCandidateFormAction(
				form({ campaignSlug: "../campaign-a" }),
			),
		).rejects.toThrow(
			"NEXT_REDIRECT:/edit/revisao?erro=invalid_payload",
		);
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.editDataClient).not.toHaveBeenCalled();
	});
});
