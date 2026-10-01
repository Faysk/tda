import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LORE_EDITORIAL_REGISTRY } from "./registry";
import {
	loreCatalogueEntries,
	listedLoreCatalogueEntries,
} from "./standalone-catalog";

function implementedAppLoreRoutes() {
	const root = new URL("../../app/lore/", import.meta.url);
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter(
			(entry) =>
				existsSync(new URL(`${entry.name}/page.tsx`, root)) ||
				existsSync(new URL(`${entry.name}/route.ts`, root)),
		)
		.map((entry) => entry.name);
}

function implementedStaticLoreRoutes() {
	const root = new URL("../../../public/lore/", import.meta.url);
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.filter((entry) => existsSync(new URL(`${entry.name}/index.html`, root)))
		.map((entry) => entry.name);
}

function implementedLoreRoutes() {
	const appRoutes = implementedAppLoreRoutes();
	const staticRoutes = implementedStaticLoreRoutes();
	const implementations = [...appRoutes, ...staticRoutes];

	expect(new Set(implementations).size).toBe(
		implementations.length,
		"a lore slug must not be implemented by both app and static delivery",
	);

	return implementations.sort();
}

describe("lore route, registry and catalogue contract", () => {
	it("requires every public lore route to have exactly one explicit editorial registration", () => {
		const routes = implementedLoreRoutes();
		const registrations = LORE_EDITORIAL_REGISTRY.map((entry) => entry.slug);
		const uniqueRegistrations = new Set(registrations);

		expect(uniqueRegistrations.size).toBe(registrations.length);
		expect([...uniqueRegistrations].sort()).toEqual(routes);

		for (const slug of routes) {
			expect(
				LORE_EDITORIAL_REGISTRY.filter((entry) => entry.slug === slug),
				`public lore route ${slug} must have exactly one editorial registration`,
			).toHaveLength(1);
		}
	});

	it("fails closed when a curated listing has no implemented route", () => {
		const routes = new Set(implementedLoreRoutes());
		for (const registration of LORE_EDITORIAL_REGISTRY) {
			if (!registration.listed) continue;
			expect(
				routes.has(registration.slug),
				`listed lore ${registration.slug} must have an implemented /lore route`,
			).toBe(true);
		}
	});

	it("keeps direct-only public routes explicit instead of discovering them accidentally", () => {
		const routes = new Set(implementedLoreRoutes());
		const directOnly = LORE_EDITORIAL_REGISTRY.filter((entry) => !entry.listed);

		expect(directOnly.length).toBeGreaterThan(0);
		for (const registration of directOnly) {
			expect(routes.has(registration.slug)).toBe(true);
			expect(registration.indexable).toBe(false);
		}
	});

	it("requires every curated card to use valid public media metadata", () => {
		const listedSlugs = new Set(
			listedLoreCatalogueEntries().map((entry) => entry.slug),
		);

		for (const entry of loreCatalogueEntries()) {
			expect(listedSlugs.has(entry.slug)).toBe(true);
			const cover = new URL(entry.cover);
			expect(cover.protocol).toBe("https:");
			expect(cover.hostname).toBe("media.dnd.faysk.dev");
			expect(cover.pathname).toMatch(/^\/lore\//u);
		}
	});

	it("groups the catalogue only after more than one public campaign is represented", () => {
		const source = readFileSync(
			new URL("../../app/lore/page.tsx", import.meta.url),
			"utf8",
		);
		expect(source).toContain("const grouped = publicCampaigns.length > 1;");
	});
});
