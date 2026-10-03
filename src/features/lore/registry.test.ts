import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	LORE_EDITORIAL_REGISTRY,
	loreRegistrationForSlug,
} from "./registry";

describe("lore editorial registry", () => {
	it("lists D after source approval without inventing an entity", () => {
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

	it("curates Seika under the new campaign without inventing an entity", () => {
		expect(loreRegistrationForSlug("seika")).toEqual({
			slug: "seika",
			delivery: "standalone",
			listed: true,
			campaignTechnicalSlug: "antes-que-seja-tarde",
			indexable: false,
			entityLink: null,
		});
		expect(loreRegistrationForSlug("yllith")).toEqual({
			slug: "yllith",
			delivery: "standalone",
			listed: true,
			campaignTechnicalSlug: "antes-que-seja-tarde",
			indexable: false,
			entityLink: null,
		});
		expect(
			LORE_EDITORIAL_REGISTRY.filter((lore) => lore.listed).map(
				(lore) => lore.slug,
			),
		).toEqual(["pipipi", "astel", "noah", "d", "seika", "yllith"]);
		for (const slug of ["d", "seika", "yllith"]) {
			expect(loreRegistrationForSlug(slug)?.campaignTechnicalSlug).toBe(
				"antes-que-seja-tarde",
			);
			expect(loreRegistrationForSlug(slug)?.campaignTechnicalSlug).not.toBe(
				"yuhara-main",
			);
		}
	});

	it("preserves approved standalone sources, canonicals and social metadata for D and Yllith", () => {
		const dHtml = readFileSync(new URL("../../../public/lore/d/index.html", import.meta.url), "utf8");
		const dStory = readFileSync(new URL("../../../public/lore/d/historia-1.md", import.meta.url), "utf8");
		const yllithHtml = readFileSync(new URL("../../../public/lore/yllith/index.html", import.meta.url), "utf8");
		const yllithStory = readFileSync(new URL("../../../public/lore/yllith/historia.md", import.meta.url), "utf8");

		expect(dHtml).toContain('<link rel="canonical" href="https://dnd.faysk.dev/lore/d" />');
		expect(dHtml).toContain('<meta property="og:url" content="https://dnd.faysk.dev/lore/d" />');
		expect(dHtml).toContain("https://media.dnd.faysk.dev/lore/d/30f853af30136239f0559cfe6e300949f6be1c0667cd4bd866e8c458eff01052/d-completo.png");
		expect(dStory).toContain("# D.");
		expect(dHtml).not.toContain("/campanhas/antes-que-seja-tarde/lore/d");

		expect(yllithHtml).toContain('<link rel="canonical" href="https://dnd.faysk.dev/lore/yllith">');
		expect(yllithHtml).toContain('<meta property="og:url" content="https://dnd.faysk.dev/lore/yllith">');
		expect(yllithHtml).toContain("https://media.dnd.faysk.dev/lore/yllith/b9858046c31ddc338fafe822b8c6132d4b4a4383c5f11b7b6e536943f8509f48/social-yllith.jpg");
		expect(yllithStory).toContain("# Nascida para conquistar");
		expect(yllithHtml).not.toContain("/campanhas/antes-que-seja-tarde/lore/yllith");
	});
});
