import { describe, expect, it } from "vitest";
import { worldPublicProfileRoute } from "./public-profile-route";

describe("World public profile routes", () => {
	it("derives the public lore route for an active public entity", () => {
		expect(
			worldPublicProfileRoute({
				entityType: "pc",
				slug: "dandelion",
				status: "active",
				visibility: "public_web",
			}),
		).toBe("/personagens/dandelion");
	});

	it("reuses the lore route map for other supported entity types", () => {
		expect(
			worldPublicProfileRoute({
				entityType: "npc",
				slug: "ivory",
				status: "active",
				visibility: "public_web",
			}),
		).toBe("/npcs/ivory");
		expect(
			worldPublicProfileRoute({
				entityType: "quest",
				slug: "a questao",
				status: "active",
				visibility: "public_web",
			}),
		).toBe("/quests/a%20questao");
	});

	it("does not expose a route for private or non-active entities", () => {
		expect(
			worldPublicProfileRoute({
				entityType: "pc",
				slug: "dandelion",
				status: "active",
				visibility: "private_players",
			}),
		).toBeUndefined();
		expect(
			worldPublicProfileRoute({
				entityType: "pc",
				slug: "dandelion",
				status: "archived",
				visibility: "public_web",
			}),
		).toBeUndefined();
	});

	it("does not invent routes for unsupported entity types or missing slugs", () => {
		expect(
			worldPublicProfileRoute({
				entityType: "organization",
				slug: "familia-nightshade",
				status: "active",
				visibility: "public_web",
			}),
		).toBeUndefined();
		expect(
			worldPublicProfileRoute({
				entityType: "other",
				slug: "misterio",
				status: "active",
				visibility: "public_web",
			}),
		).toBeUndefined();
		expect(
			worldPublicProfileRoute({
				entityType: "song",
				slug: null,
				status: "active",
				visibility: "public_web",
			}),
		).toBeUndefined();
	});
});
