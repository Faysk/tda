import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({
	authorizeCampaignCapabilityServer: mocks.authorize,
}));
vi.mock("./repository", () => ({ readStatistics: mocks.read }));
import { getTranscriptStatistics } from "./server";

beforeEach(() => {
	vi.clearAllMocks();
});
describe("statistics server boundary", () => {
	it.each([
		"unauthenticated",
		"profile_unresolved",
		"forbidden",
		"dependency_unavailable",
	])("denies %s before any private query", async (reason) => {
		mocks.authorize.mockResolvedValue({ ok: false, reason });
		expect(await getTranscriptStatistics("yuhara-main")).toEqual({
			ok: false,
			reason,
		});
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("requires only read once and forwards the exact campaign", async () => {
		mocks.authorize.mockResolvedValue({ ok: true });
		mocks.read.mockResolvedValue({ sessions: [] });
		expect(await getTranscriptStatistics("second-campaign")).toEqual({
			ok: true,
			value: { sessions: [] },
		});
		expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({
			action: "campaign.transcript.read",
			campaignSlug: "second-campaign",
		});
		expect(mocks.read).toHaveBeenCalledExactlyOnceWith("second-campaign");
	});
	it("does not reuse an allowed response after revocation", async () => {
		mocks.authorize
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
		mocks.read.mockResolvedValue({ sessions: [] });
		expect((await getTranscriptStatistics("a")).ok).toBe(true);
		expect((await getTranscriptStatistics("a")).ok).toBe(false);
		expect(mocks.read).toHaveBeenCalledTimes(1);
	});
	it("does not leak dependency errors or return a partial result", async () => {
		mocks.authorize.mockResolvedValue({ ok: true });
		mocks.read.mockRejectedValue(new Error("PRIVATE CONTENT"));
		expect(await getTranscriptStatistics("a")).toEqual({
			ok: false,
			reason: "dependency_unavailable",
		});
	});
	it("rejects filter injection", async () => {
		expect(await getTranscriptStatistics("a,slug.eq.b")).toEqual({
			ok: false,
			reason: "validation",
		});
		expect(mocks.authorize).not.toHaveBeenCalled();
	});
});
