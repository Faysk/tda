import { describe, expect, it } from "vitest";
import {
	buildPublishedLoreProfile,
	toPublicLoreIndexItem,
	type PublicCanonEntryRow,
	type PublicLoreEntityRow,
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

	it("does not invent profile sections when no public narrative text exists", () => {
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
