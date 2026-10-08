import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
const mocks = vi.hoisted(() => ({
	access: vi.fn(),
	routes: vi.fn(),
	queue: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/features/auth/server", () => ({ currentAccess: mocks.access }));
vi.mock("@/features/campaigns/authorized-routes", async (original) => ({
	...(await original<
		typeof import("@/features/campaigns/authorized-routes")
	>()),
	readAuthorizedCampaignRoutes: mocks.routes,
}));
vi.mock("@/features/edit/review/server", () => ({
	loadCanonReviewQueue: mocks.queue,
}));
vi.mock("@/features/edit/review/actions", () => ({
	reviewCanonCandidateFormAction: vi.fn(),
}));
import ReviewPage from "./page";
const campaigns = [
	{
		technicalSlug: "yuhara-main",
		routeKey: "destino-sem-fim",
		name: "Destino Sem Fim",
		lifecycle: "active",
	},
	{
		technicalSlug: "antes-que-seja-tarde",
		routeKey: "passos-retomados",
		name: "Passos Retomados",
		lifecycle: "active",
	},
];
beforeEach(() => {
	vi.clearAllMocks();
	mocks.access.mockResolvedValue({
		state: "authenticated",
		context: {
			authUserId: "verified",
			profileId: "profile",
			grants: [
				EDIT_CAPABILITIES.reviewRead,
				EDIT_CAPABILITIES.reviewManage,
			].map((action) => ({
				action,
				scopeType: "project",
				scopeId: "tda",
				status: "active",
				startsAt: "2020-01-01",
				endsAt: null,
			})),
		},
	});
	mocks.routes.mockResolvedValue({ ok: true, campaigns });
	mocks.queue.mockResolvedValue({
		ok: true,
		candidates: Array.from({ length: 45 }, (_, index) => ({
			id: `candidate-${index}`,
			title: `Título ${index}`,
			claim: `Afirmação ${index}`,
			candidateType: "fact",
			confidence: null,
			createdAt: null,
			sessionTitle: "Sintética",
			sessionDate: null,
			sourceCount: 0,
			sources: [],
		})),
	});
});
describe("campaign-qualified review rendering", () => {
	it.each(campaigns)(
		"opens $routeKey and keeps data/forms in technical scope",
		async (campaign) => {
			const html = renderToStaticMarkup(
				await ReviewPage({
					searchParams: Promise.resolve({
						campanha: campaign.routeKey,
						pagina: "2",
					}),
				}),
			);
			expect(mocks.queue).toHaveBeenCalledWith(campaign.technicalSlug);
			expect((html.match(/name="candidateId"/gu) ?? []).length).toBe(20);
			expect(html).toContain(
				`type="hidden" name="campaignSlug" value="${campaign.technicalSlug}"`,
			);
			expect(html).toContain("21–40 de 45 candidatos");
			expect(html).toContain(`/edit/${campaign.routeKey}/revisao?pagina=3`);
		},
	);
	it("rejects an unlisted campaign before loading any claims", async () => {
		const html = renderToStaticMarkup(
			await ReviewPage({
				searchParams: Promise.resolve({ campanha: "private-ungranted" }),
			}),
		);
		expect(mocks.queue).not.toHaveBeenCalled();
		expect(html).toContain("Escolha a campanha");
		expect(html).not.toContain("Afirmação");
	});
	it("renders a distinct no-match state without decision forms", async () => {
		const html = renderToStaticMarkup(
			await ReviewPage({
				searchParams: Promise.resolve({
					campanha: "destino-sem-fim",
					busca: "missing",
				}),
			}),
		);
		expect(html).toContain("Nenhum resultado");
		expect(html).not.toContain('name="candidateId"');
		expect(html).not.toContain("Nenhum candidato pendente");
	});
});
