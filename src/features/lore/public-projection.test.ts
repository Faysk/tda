import { describe, expect, it } from "vitest";
import type { LoreCampaignContext } from "./model";
import {
	buildPublishedLoreProfile,
	toPublicLoreIndexItem,
	type PublicCanonEntryRow,
	type PublicLoreEntityRow,
	type PublicLoreSessionRow,
} from "./public-projection";

const campaignA: LoreCampaignContext = {
	routeKey: "campaign-a",
	technicalSlug: "campaign-a-tech",
	name: "Campaign A",
};

const campaignB: LoreCampaignContext = {
	routeKey: "campaign-b",
	technicalSlug: "campaign-b-tech",
	name: "Campaign B",
};

function entity(overrides: Partial<PublicLoreEntityRow> = {}): PublicLoreEntityRow {
	return {
		id: "private-database-id",
		name: "Dandelion",
		slug: "dandelion",
		entity_type: "pc",
		status: "active",
		visibility: "public_web",
		summary: "Uma memória publicada.",
		aliases: [],
		...overrides,
	};
}

function canon(overrides: Partial<PublicCanonEntryRow> = {}): PublicCanonEntryRow {
	return {
		title: "Uma lembrança",
		content: "Conteúdo aprovado para publicação.",
		entry_type: "fact",
		visibility: "public_web",
		status: "active",
		...overrides,
	};
}

function session(overrides: Partial<PublicLoreSessionRow> = {}): PublicLoreSessionRow {
	return {
		id: "private-session-uuid",
		source_session_id: "public-session-id",
		title: "O Retorno do Bardo",
		session_date: "2026-07-01",
		arc: "A Forja de Thalindra",
		summary_short: "Uma sessão publicada associada ao personagem.",
		status: "published",
		campaigns: { slug: campaignA.technicalSlug },
		...overrides,
	};
}

describe("public lore projection", () => {
	it("rejects entities that are not explicitly public_web", () => {
		expect(
			toPublicLoreIndexItem(entity({ visibility: "private_players" }), campaignA),
		).toBeNull();
		expect(
			buildPublishedLoreProfile(entity({ visibility: "private_master" }), campaignA),
		).toBeNull();
	});

	it("uses campaign + slug as public identity without leaking the database UUID", () => {
		const profile = buildPublishedLoreProfile(entity(), campaignA);
		expect(profile?.identity.id).toBe("campaign-a:dandelion");
		expect(profile?.campaign).toEqual(campaignA);
		expect(JSON.stringify(profile)).not.toContain("private-database-id");
	});

	it("keeps equal slugs in different campaigns on distinct routes and identities", () => {
		const row = entity({ slug: "same" });
		expect(toPublicLoreIndexItem(row, campaignA)?.href).toBe(
			"/campanhas/campaign-a/personagens/same",
		);
		expect(toPublicLoreIndexItem(row, campaignB)?.href).toBe(
			"/campanhas/campaign-b/personagens/same",
		);
		expect(buildPublishedLoreProfile(row, campaignA)?.identity.id).toBe(
			"campaign-a:same",
		);
		expect(buildPublishedLoreProfile(row, campaignB)?.identity.id).toBe(
			"campaign-b:same",
		);
	});

	it("projects only active public canon entries", () => {
		const profile = buildPublishedLoreProfile(entity(), campaignA, [
			canon(),
			canon({ title: "Privado", visibility: "private_players" }),
			canon({ title: "Arquivado", status: "archived" }),
		]);
		const serialized = JSON.stringify(profile);
		expect(serialized).toContain("Uma lembrança");
		expect(serialized).not.toContain("Privado");
		expect(serialized).not.toContain("Arquivado");
	});

	it("projects only published sessions from the exact campaign", () => {
		const profile = buildPublishedLoreProfile(
			entity({ summary: null }),
			campaignA,
			[],
			[
				session(),
				session({ title: "Rascunho", status: "ready_for_review" }),
				session({
					title: "Outra campanha",
					campaigns: { slug: campaignB.technicalSlug },
				}),
			],
		);
		const serialized = JSON.stringify(profile);
		expect(serialized).toContain("O Retorno do Bardo");
		expect(serialized).toContain(
			"/campanhas/campaign-a/sessoes/public-session-id",
		);
		expect(serialized).toContain("01 de julho de 2026");
		expect(serialized).not.toContain("Rascunho");
		expect(serialized).not.toContain("Outra campanha");
	});

	it("does not invent sections when no public narrative or session data exists", () => {
		const profile = buildPublishedLoreProfile(
			entity({ summary: null }),
			campaignA,
		);
		expect(profile?.sections).toEqual([]);
		expect(profile?.presentation.motion.preset).toBe("still");
	});

	it("builds route-safe index items only for supported public entity types", () => {
		expect(toPublicLoreIndexItem(entity(), campaignA)).toEqual({
			slug: "dandelion",
			entityType: "pc",
			name: "Dandelion",
			summary: "Uma memória publicada.",
			href: "/campanhas/campaign-a/personagens/dandelion",
			campaign: campaignA,
		});
		expect(
			toPublicLoreIndexItem(entity({ entity_type: "other" }), campaignA),
		).toBeNull();
	});
});
