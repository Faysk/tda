import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), persist: vi.fn() }));
vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorize,
}));
vi.mock(
	"@/features/edit/access/policy",
	async () => import("../edit/access/policy"),
);
vi.mock("@/features/sessions/model", () => ({ CAMPAIGN_SLUG: "yuhara-main" }));
vi.mock("../edit/transcript/unsafe-mutation", () => ({
	unsafeUpdateTranscriptSegment: mocks.persist,
}));
import { updateTranscriptSegmentAction } from "../edit/transcript/actions";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.persist.mockResolvedValue({ ok: true });
});
describe("administrative operation entry point", () => {
	it.each([
		"unauthenticated",
		"profile_unresolved",
		"forbidden",
		"dependency_unavailable",
	])("never invokes persistence when %s", async (reason) => {
		mocks.authorize.mockResolvedValue({ ok: false, reason });
		const result = await updateTranscriptSegmentAction({
			sessionId: "private",
			segmentId: "private",
			text: "synthetic",
			speaker: "Mesa",
			reviewStatus: "approved",
		});
		expect(result.ok).toBe(false);
		expect(mocks.persist).not.toHaveBeenCalled();
	});
	it("uses the server decision before an authorized operation", async () => {
		mocks.authorize.mockResolvedValue({
			ok: true,
			authUserId: "verified",
			profileId: "verified-profile",
		});
		await updateTranscriptSegmentAction({
			sessionId: "synthetic-session",
			segmentId: "synthetic-segment",
			text: "synthetic",
			speaker: "Mesa",
			reviewStatus: "approved",
		});
		expect(mocks.authorize).toHaveBeenCalledWith({
			action: "campaign.content.edit",
			campaignSlug: "yuhara-main",
		});
		expect(mocks.persist).toHaveBeenCalledTimes(1);
	});
});
