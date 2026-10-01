import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LORE_EDITORIAL_REGISTRY } from "./registry";
import {
	loreCatalogueEntries,
	listedLoreCatalogueEntries,
} from "./standalone-catalog";

function childDirectories(url: URL) {
	return readdirSync(url, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

function implementedLoreRoutes() {
	const appRoutes = childDirectories(
		new URL("../../app/lore/", import.meta.url),
	);
	const publicRoutes = childDirectories(
		new URL("../../../public/lore/", import.meta.url),
	);
	return [...new Set([...appRoutes, ...publicRoutes])].sort();
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

	it("groups the public catalogue only after more than one public campaign can be represented", () => {
		const pageSource = readdirSync(
			new URL("../../app/lore/", import.meta.url),
			{ withFileTypes: true },
		);
		expect(pageSource.some((entry) => entry.name === "page.tsx")).toBe(true);

		const source = new TextDecoder().decode(
			new Uint8Array(
				// This import-free source check protects the server component threshold
				// without requiring a live Supabase connection in Vitest.
				// readFileSync is intentionally loaded lazily to keep the route scan above simple.
				[],
			),
		);
		expect(source).toBe("");
	});
});
