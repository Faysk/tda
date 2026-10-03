"use client";

import { useRef } from "react";
import type {
	CampaignCreateInput,
	CampaignMutationResult,
	ManageableCampaign,
} from "@/features/campaigns/model";
import { LembraExperience } from "@/features/lembra/components/lembra-experience";
import type {
	LembraCampaignClassification,
	LembraReference,
} from "@/features/lembra/model";

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
		name: "Campanha Privada B",
		lifecycle: "active",
	},
	{
		id: "33333333-3333-4333-8333-333333333333",
		name: "Campanha Privada C",
		lifecycle: "archived",
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
	},
];

function createdCampaign(input: CampaignCreateInput): ManageableCampaign {
	return {
		id:
			input.visibility === "private"
				? "55555555-5555-4555-8555-555555555555"
				: "44444444-4444-4444-8444-444444444444",
		technicalSlug: input.technicalSlug,
		routeKey: input.routeKey,
		name: input.name.trim(),
		description: input.description.trim() || null,
		lifecycle: "active",
		visibility: input.visibility === "private" ? "private" : "public",
		archivedAt: null,
		updatedAt: "2026-10-03T04:00:00.000Z",
		coverImage: null,
		hasCoverBinding: false,
	};
}

async function syntheticCampaignCreateAction(
	input: CampaignCreateInput,
): Promise<CampaignMutationResult> {
	await Promise.resolve();

	if (input.technicalSlug === "existing-campaign") {
		return { ok: false, reason: "conflict" };
	}
	if (input.technicalSlug === "dependency-down") {
		return { ok: false, reason: "dependency_unavailable" };
	}
	if (input.name.trim().length < 2) {
		return { ok: false, reason: "validation", field: "name" };
	}
	if (input.visibility !== "public" && input.visibility !== "private") {
		return { ok: false, reason: "validation", field: "visibility" };
	}

	return { ok: true, campaign: createdCampaign(input) };
}

export function LembraCampaignFixtureClient({
	canManageCampaigns,
	discoverCreatedCampaign,
}: Readonly<{
	canManageCampaigns: boolean;
	discoverCreatedCampaign: boolean;
}>) {
	const createdRef = useRef<ManageableCampaign | null>(null);

	async function createCampaign(input: CampaignCreateInput): Promise<CampaignMutationResult> {
		const result = await syntheticCampaignCreateAction(input);
		if (result.ok) createdRef.current = result.campaign;
		return result;
	}

	async function refreshCampaignProjection() {
		const created = createdRef.current;
		const projected =
			discoverCreatedCampaign && created
				? [
						...CAMPAIGNS,
						{
							id: created.id,
							name: created.name,
							lifecycle: created.lifecycle,
						},
					]
				: CAMPAIGNS;
		return { ok: true as const, campaigns: projected };
	}

	return (
		<LembraExperience
			initialReferences={REFERENCES}
			initialCampaigns={CAMPAIGNS}
			canManageCampaigns={canManageCampaigns}
			campaignCreateAction={createCampaign}
			campaignProjectionRefreshAction={refreshCampaignProjection}
		/>
	);
}
