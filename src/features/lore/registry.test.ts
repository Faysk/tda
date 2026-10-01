import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	LORE_EDITORIAL_REGISTRY,
	loreRegistrationForSlug,
} from "./registry";

describe("lore editorial registry", () => {
	it("links D editorially without listing it or inventing an entity", () => {
		expect(loreRegistrationForSlug("d")).toEqual({
			slug: "d",
			delivery: "standalone",
			listed: false,
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

	it("curates Seika under the new campaign without inventing an entity", () => {
		expect(loreRegistrationForSlug("seika")).toEqual({
			slug: "seika",
			delivery: "standalone",
			listed: true,
			campaignTechnicalSlug: "antes-que-seja-tarde",
			indexable: false,
			entityLink: null,
		});
		expect(loreRegistrationForSlug("yllith")?.campaignTechnicalSlug).toBeNull();
		expect(
			LORE_EDITORIAL_REGISTRY.filter((lore) => lore.listed).map(
				(lore) => lore.slug,
			),
		).toEqual(["pipipi", "astel", "noah", "seika"]);
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
