import { notFound } from "next/navigation";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import type {
	LembraCampaignClassification,
	LembraReference,
} from "@/features/lembra/model";

export const dynamic = "force-dynamic";

const IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='12' viewBox='0 0 16 12'%3E%3Crect width='16' height='12' fill='%23d7aa61'/%3E%3C/svg%3E";

const CAMPAIGNS: readonly LembraCampaignClassification[] = [
	{
		id: "11111111-1111-4111-8111-111111111111",
		name: "Crônicas da Mesa",
		lifecycle: "active",
	},
	{
		id: "22222222-2222-4222-8222-222222222222",
		name: "Campanha Pública B",
		lifecycle: "active",
	},
	{
		id: "33333333-3333-4333-8333-333333333333",
		name: "Campanha Arquivada",
		lifecycle: "archived",
	},
	{
		id: "44444444-4444-4444-8444-444444444444",
		name: "Campanha Privada Descoberta",
		lifecycle: "active",
	},
];

const REFERENCES: readonly LembraReference[] = [
	{
		id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		title: "Geral",
		description: "Referência sem campanha",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-09-30T12:00:00.000Z",
		updatedAt: "2026-09-30T12:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: true,
		campaign: null,
		campaignRestricted: false,
	},
	{
		id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		title: "Mesa",
		description: "Referência da campanha principal",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-09-30T11:00:00.000Z",
		updatedAt: "2026-09-30T11:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: CAMPAIGNS[0],
		campaignRestricted: false,
	},
	{
		id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		title: "Histórica",
		description: "Referência classificada em campanha arquivada",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-09-30T10:00:00.000Z",
		updatedAt: "2026-09-30T10:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: CAMPAIGNS[2],
		campaignRestricted: false,
	},
	{
		id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
		title: "Privada visível",
		description: "Referência de uma campanha privada que este ator pode descobrir",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-09-30T09:00:00.000Z",
		updatedAt: "2026-09-30T09:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: CAMPAIGNS[3],
		campaignRestricted: false,
	},
	{
		id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
		title: "Vínculo protegido",
		description: "Referência global cujo vínculo de campanha não é descobrível por este ator",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-09-30T08:00:00.000Z",
		updatedAt: "2026-09-30T08:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: null,
		campaignRestricted: true,
	},
];

export default function LembraCampaignE2EFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<LembraExperience
			initialReferences={REFERENCES}
			initialCampaigns={CAMPAIGNS}
		/>
	);
}
