import { beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ access: vi.fn(), campaigns: vi.fn(), list: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({ currentAccess: fixtures.access }));
vi.mock("@/features/campaigns/sessions", async () => ({
  ...(await import("@/features/campaigns/session-routes")),
  readEditableSessionCampaigns: fixtures.campaigns,
}));
vi.mock("@/features/edit/sessions/repository", () => ({ listEditSessionLibrary: fixtures.list }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
  notFound: () => { throw new Error("not-found"); },
}));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.access.mockResolvedValue({ state: "authenticated", context: { profileId: "test-profile", grants: [] } });
  fixtures.campaigns.mockResolvedValue({ ok: true, campaigns: [{ id: "campaign-id", technicalSlug: "yuhara-main", routeKey: "destino-sem-fim", name: "Destino Sem Fim", lifecycle: "active", visibility: "private" }] });
});
it("canonicalizes an authorized legacy library while retaining its filters", async () => {
  await expect(Page({ params: Promise.resolve({ campaignSlug: "yuhara-main" }), searchParams: Promise.resolve({ q: "sessao 20", estado: "approved" }) })).rejects.toThrow("redirect:/edit/destino-sem-fim/sessoes?q=sessao+20&estado=approved");
  expect(fixtures.list).not.toHaveBeenCalled();
});
it("does not read campaign data before authentication", async () => {
  fixtures.access.mockResolvedValue({ state: "anonymous" });
  await expect(Page({ params: Promise.resolve({ campaignSlug: "destino-sem-fim" }), searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/entrar?next=%2Fedit%2Fdestino-sem-fim%2Fsessoes");
  expect(fixtures.campaigns).not.toHaveBeenCalled();
  expect(fixtures.list).not.toHaveBeenCalled();
});
it("rejects references absent from the authorized campaign list", async () => {
  fixtures.campaigns.mockResolvedValue({ ok: true, campaigns: [] });
  await expect(Page({ params: Promise.resolve({ campaignSlug: "destino-sem-fim" }), searchParams: Promise.resolve({}) })).rejects.toThrow("not-found");
  expect(fixtures.list).not.toHaveBeenCalled();
});
it("reads the canonical library using the stable technical identity", async () => {
  fixtures.list.mockResolvedValue([]);
  await Page({ params: Promise.resolve({ campaignSlug: "destino-sem-fim" }), searchParams: Promise.resolve({}) });
  expect(fixtures.list).toHaveBeenCalledWith("yuhara-main");
});
