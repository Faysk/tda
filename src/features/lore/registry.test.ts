import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	LORE_EDITORIAL_REGISTRY,
	loreRegistrationForSlug,
} from "./registry";

describe("lore editorial registry", () => {
	it("curates D under Antes que seja tarde without inventing an entity", () => {
		expect(loreRegistrationForSlug("d")).toEqual({
			slug: "d",
			delivery: "standalone",
			listed: true,
			campaignTechnicalSlug: "antes-que-seja-tarde",
			indexable: false,
			entityLink: null,
		});
	});

	it("qualifies existing standalone entity links by campaign", () => {
		expect(loreRegistrationForSlug("astel")?.entityLink).toEqual({
			campaignTechnicalSlug: "yuhara-main",
			entityType: "pc",
			entitySlug: "astel",
		});
		expect(loreRegistrationForSlug("noah")?.entityLink).toEqual({
			campaignTechnicalSlug: "yuhara-main",
			entityType: "pc",
			entitySlug: "noah",
		});
	});

	it("curates Seika and Yllith under the new campaign without inventing entities", () => {
		for (const slug of ["seika", "yllith"] as const) {
			expect(loreRegistrationForSlug(slug)).toEqual({
				slug,
				delivery: "standalone",
				listed: true,
				campaignTechnicalSlug: "antes-que-seja-tarde",
				indexable: false,
				entityLink: null,
			});
		}
		expect(
			LORE_EDITORIAL_REGISTRY.filter((lore) => lore.listed).map(
				(lore) => lore.slug,
			),
		).toEqual(["pipipi", "astel", "noah", "d", "seika", "yllith"]);
	});

	it("preserves D standalone canonical and social URL metadata", () => {
		const html = readFileSync(
			new URL("../../../public/lore/d/index.html", import.meta.url),
			"utf8",
		);
		expect(html).toContain(
			'<link rel="canonical" href="https://dnd.faysk.dev/lore/d" />',
		);
		expect(html).toContain(
			'<meta property="og:url" content="https://dnd.faysk.dev/lore/d" />',
		);
		expect(html).not.toContain("/campanhas/antes-que-seja-tarde/lore/d");
	});
});
