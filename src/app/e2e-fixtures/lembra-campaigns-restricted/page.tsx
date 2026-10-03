import { notFound } from "next/navigation";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import type {
	LembraCampaignClassification,
	LembraReference,
} from "@/features/lembra/model";

export const dynamic = "force-dynamic";

const IMAGE =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='12' viewBox='0 0 16 12'%3E%3Crect width='16' height='12' fill='%23d7aa61'/%3E%3C/svg%3E";

const PUBLIC_CAMPAIGN: LembraCampaignClassification = {
	id: "11111111-1111-4111-8111-111111111111",
	name: "Campanha A",
	lifecycle: "active",
};

const REFERENCES: readonly LembraReference[] = [
	{
		id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		title: "Geral explícita",
		description: "Sem classificação de campanha",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-10-03T12:00:00.000Z",
		updatedAt: "2026-10-03T12:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: null,
	},
	{
		id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		title: "Referência redigida",
		description: "O cliente não recebe metadata da classificação privada",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-10-03T11:00:00.000Z",
		updatedAt: "2026-10-03T11:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		// This represents a server-redacted private classification. The browser
		// receives exactly the same campaign projection as an unclassified item.
		campaign: null,
	},
	{
		id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
		title: "Referência pública A",
		description: "Classificação pública visível",
		author: "Fixture",
		authorAuthUserId: "fixture",
		createdAt: "2026-10-03T10:00:00.000Z",
		updatedAt: "2026-10-03T10:00:00.000Z",
		imageUrl: IMAGE,
		width: 16,
		height: 12,
		mine: false,
		campaign: PUBLIC_CAMPAIGN,
	},
];

export default function RestrictedLembraCampaignE2EFixture() {
	if (process.env.TDA_E2E_FIXTURES !== "true") notFound();

	return (
		<LembraExperience
			initialReferences={REFERENCES}
			initialCampaigns={[PUBLIC_CAMPAIGN]}
		/>
	);
}
