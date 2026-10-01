import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), write: vi.fn() }));
vi.mock("@/features/world-explorer/world-entity-media-server", () => ({ worldEntityMediaEnabled: () => true }));
vi.mock("@/features/edit/sessions/session-cover-media-access", () => ({ authorizeSessionCoverTarget: mocks.authorize }));
vi.mock("@/features/edit/sessions/session-cover-media-server", () => ({ writeSessionCoverPendingUploadChunk: mocks.write }));
import { PUT } from "./route";
const sessionId = "11111111-1111-4111-8111-111111111111";
function request() {
	return new Request("https://dnd.faysk.dev/api/edit/session-cover/upload", {
		method: "PUT", headers: {
			"content-type": "application/octet-stream", "x-tda-campaign": "campaign-b",
			"x-tda-session": sessionId, "x-tda-upload-id": "22222222-2222-4222-8222-222222222222",
			"x-tda-content-sha256": "a".repeat(64), "x-tda-total-bytes": "24", "x-tda-part": "0",
		}, body: new Uint8Array(24),
	});
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.authorize.mockResolvedValue({ ok: true, target: { campaignSlug: "campaign-b" } });
	mocks.write.mockResolvedValue(undefined);
});
it("uploads bytes in the authorized B namespace and forwards the requested context", async () => {
	expect((await PUT(request())).status).toBe(204);
	expect(mocks.authorize).toHaveBeenCalledWith(sessionId, "campaign-b");
	expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ campaignSlug: "campaign-b", sessionId }));
});
it("never writes a chunk when the session does not belong to the requested campaign", async () => {
	mocks.authorize.mockResolvedValueOnce({ ok: false, reason: "not_found" });
	expect((await PUT(request())).status).toBe(404);
	expect(mocks.write).not.toHaveBeenCalled();
});
