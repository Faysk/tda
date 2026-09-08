import { describe, expect, it } from "vitest";
import {
	buildPublishedLoreProfile,
	toPublicLoreIndexItem,
	type PublicCanonEntryRow,
	type PublicLoreEntityRow,
	type PublicLoreSessionRow,
} from "./public-projection";

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
		campaigns: { slug: "yuhara-main" },
		...overrides,
	};
}

describe("public lore projection", () => {
	it("rejects entities that are not explicitly public_web", () => {
		expect(toPublicLoreIndexItem(entity({ visibility: "private_players" }))).toBeNull();
		expect(buildPublishedLoreProfile(entity({ visibility: "private_master" }))).toBeNull();
	});

	it("uses slug as the public identifier instead of leaking the database UUID", () => {
		const profile = buildPublishedLoreProfile(entity());
		expect(profile?.identity.id).toBe("dandelion");
		expect(JSON.stringify(profile)).not.toContain("private-database-id");
	});

	it("projects only active public canon entries", () => {
		const profile = buildPublishedLoreProfile(entity(), [
			canon(),
			canon({ title: "Privado", visibility: "private_players" }),
			canon({ title: "Arquivado", status: "archived" }),
		]);
		const serialized = JSON.stringify(profile);
		expect(serialized).toContain("Uma lembrança");
		expect(serialized).not.toContain("Privado");
		expect(serialized).not.toContain("Arquivado");
	});

	it("projects only published campaign sessions without leaking internal session IDs", () => {
		const profile = buildPublishedLoreProfile(entity({ summary: null }), [], [
			session(),
			session({
				id: "private-draft-id",
				title: "Rascunho",
				status: "ready_for_review",
			}),
			session({
				id: "private-other-campaign-id",
				title: "Outra campanha",
				campaigns: { slug: "outra-campanha" },
			}),
		]);
		const serialized = JSON.stringify(profile);
		expect(serialized).toContain("O Retorno do Bardo");
		expect(serialized).toContain("/sessoes/public-session-id");
		expect(serialized).toContain("01 de julho de 2026");
		expect(serialized).not.toContain("Rascunho");
		expect(serialized).not.toContain("Outra campanha");
		expect(serialized).not.toContain("private-session-uuid");
		expect(serialized).not.toContain("private-draft-id");
		expect(serialized).not.toContain("private-other-campaign-id");
	});

	it("does not invent profile sections when no public narrative or session data exists", () => {
		const profile = buildPublishedLoreProfile(entity({ summary: null }), []);
		expect(profile?.sections).toEqual([]);
		expect(profile?.presentation.motion.preset).toBe("still");
	});

	it("builds route-safe index items only for supported public entity types", () => {
		expect(toPublicLoreIndexItem(entity())).toEqual({
			slug: "dandelion",
			entityType: "pc",
			name: "Dandelion",
			summary: "Uma memória publicada.",
			href: "/personagens/dandelion",
		});
		expect(toPublicLoreIndexItem(entity({ entity_type: "other" }))).toBeNull();
	});
});
