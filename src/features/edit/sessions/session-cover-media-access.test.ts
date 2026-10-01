import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), authorize: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./repository", () => ({ resolveEditSessionCampaign: mocks.resolve }));
vi.mock("@/features/auth/server", () => ({ authorizeCampaignCapabilityServer: mocks.authorize }));
vi.mock("@/integrations/supabase/server", () => ({ editDataClient: mocks.client }));
import { authorizeSessionCoverTarget } from "./session-cover-media-access";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.resolve.mockResolvedValue({ campaignId: "campaign-b-id", technicalSlug: "campaign-b", sessionId: "session-b", lifecycle: "active" });
	mocks.authorize.mockResolvedValue({ ok: true, authUserId: "auth", profileId: "profile" });
	mocks.client.mockReturnValue({});
});

describe("session cover ownership", () => {
	it("resolves and reauthorizes the actual campaign before issuing its storage target", async () => {
		const result = await authorizeSessionCoverTarget("session-b", "campaign-b");
		expect(result).toMatchObject({ ok: true, target: { campaignId: "campaign-b-id", campaignSlug: "campaign-b" } });
		expect(mocks.authorize).toHaveBeenCalledWith({ action: "campaign.content.edit", campaignSlug: "campaign-b" });
	});
	it("rejects a B session supplied in A context before accessing storage", async () => {
		expect(await authorizeSessionCoverTarget("session-b", "campaign-a")).toEqual({ ok: false, reason: "not_found" });
		expect(mocks.authorize).not.toHaveBeenCalled();
		expect(mocks.client).not.toHaveBeenCalled();
	});
	it("does not silently select another campaign for legacy clients", async () => {
		expect(await authorizeSessionCoverTarget("session-b")).toEqual({ ok: false, reason: "not_found" });
	});
	it("preserves denial from campaign authorization", async () => {
		mocks.authorize.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
		expect(await authorizeSessionCoverTarget("session-b", "campaign-b")).toEqual({ ok: false, reason: "forbidden" });
		expect(mocks.client).not.toHaveBeenCalled();
	});
});
