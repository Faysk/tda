import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ directory: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/campaigns/server", () => ({ readPublicCampaignDirectory: mocks.directory }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import MundoEntryPage from "./page";
beforeEach(() => vi.clearAllMocks());
it("keeps retry focus encoded and exposes recovery when directory reading fails", async () => {
 mocks.directory.mockResolvedValue({ ok: false, reason: "unavailable" });
 const html = renderToStaticMarkup(await MundoEntryPage({ searchParams: Promise.resolve({ foco: "a&b" }) }));
 expect(html).toContain('href="/mundo?foco=a%26b"');
 expect(html).toContain("Tentar novamente");
 expect(html).toContain("Voltar ao início");
 expect(mocks.redirect).not.toHaveBeenCalled();
});
it("does not redirect an empty directory into a different campaign", async () => {
 mocks.directory.mockResolvedValue({ ok: true, campaigns: [] });
 const html = renderToStaticMarkup(await MundoEntryPage({ searchParams: Promise.resolve({}) }));
 expect(html).toContain("Ainda não há campanhas públicas para explorar.");
 expect(mocks.redirect).not.toHaveBeenCalled();
});
