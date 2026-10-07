import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ access: vi.fn(), require: vi.fn(), campaigns: vi.fn(), session: vi.fn(), snapshot: vi.fn(), moved: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({ currentAccess: f.access, requireCampaignCapability: f.require }));
vi.mock("@/features/campaigns/sessions", async () => ({ ...(await import("@/features/campaigns/session-routes")), readEditableSessionCampaigns: f.campaigns }));
vi.mock("@/features/edit/sessions/repository", () => ({ findEditSessionBySourceId: f.session }));
vi.mock("@/features/edit/transcript/repository", () => ({ readTranscriptSnapshot: f.snapshot }));
vi.mock("@/features/edit/sessions/session-campaign-move-repository", () => ({ readRecentSessionCampaignMoveDestination: f.moved, sessionCampaignMoveBackendReady: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); }, notFound: () => { throw new Error("not-found"); } }));
import Page from "./page";
const params = (campaignSlug: string) => ({ params: Promise.resolve({ campaignSlug, id: "session-20" }) });
beforeEach(() => {
 vi.clearAllMocks();
 const context = { profileId: "test-profile", grants: [] };
 f.access.mockResolvedValue({ state: "authenticated", context });
 f.require.mockResolvedValue(context);
 f.campaigns.mockResolvedValue({ ok: true, campaigns: [{ id: "campaign-id", technicalSlug: "yuhara-main", routeKey: "destino-sem-fim", name: "Destino Sem Fim", lifecycle: "active", visibility: "private" }] });
 f.session.mockResolvedValue({ id: "session-id", sourceSessionId: "session-20" });
 f.snapshot.mockResolvedValue(null);
 f.moved.mockResolvedValue(null);
});
it("canonicalizes the authorized technical alias before reading a private transcript", async () => {
 await expect(Page(params("yuhara-main"))).rejects.toThrow("redirect:/edit/destino-sem-fim/sessoes/session-20");
 expect(f.require).toHaveBeenCalledWith("campaign.transcript.read", "yuhara-main", "/edit/destino-sem-fim/sessoes/session-20");
 expect(f.session).not.toHaveBeenCalled();
});
it("uses the stable identity to read an authorized canonical session", async () => {
 await Page(params("destino-sem-fim"));
 expect(f.session).toHaveBeenCalledWith("yuhara-main", "session-20");
 expect(f.snapshot).toHaveBeenCalledWith({ campaignSlug: "yuhara-main", sessionId: "session-id" });
});
it("does not resolve campaigns or read private content before authentication", async () => {
 f.access.mockResolvedValue({ state: "anonymous" });
 await expect(Page(params("destino-sem-fim"))).rejects.toThrow("redirect:/entrar?next=%2Fedit%2Fdestino-sem-fim%2Fsessoes%2Fsession-20");
 expect(f.campaigns).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled();
});
it("keeps unknown campaign references closed", async () => {
 await expect(Page(params("unrelated"))).rejects.toThrow("not-found");
 expect(f.require).not.toHaveBeenCalled(); expect(f.session).not.toHaveBeenCalled();
});
it("does not redirect or read a transcript when the campaign capability is denied", async () => {
 f.require.mockRejectedValue(new Error("denied"));
 await expect(Page(params("yuhara-main"))).rejects.toThrow("denied");
 expect(f.session).not.toHaveBeenCalled(); expect(f.snapshot).not.toHaveBeenCalled();
});
