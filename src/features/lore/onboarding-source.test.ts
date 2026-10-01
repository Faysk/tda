import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loreRegistrationForSlug } from "./registry";
import { loreCatalogueEntries } from "./standalone-catalog";

const D_SOCIAL =
	"https://media.dnd.faysk.dev/lore/d/30f853af30136239f0559cfe6e300949f6be1c0667cd4bd866e8c458eff01052/d-completo.png";
const YLLITH_SOCIAL =
	"https://media.dnd.faysk.dev/lore/yllith/b9858046c31ddc338fafe822b8c6132d4b4a4383c5f11b7b6e536943f8509f48/social-yllith.jpg";

function file(path: string) {
	return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Antes que seja tarde lore onboarding sources", () => {
	it("binds D and Yllith to the campaign without creating entity links", () => {
		for (const slug of ["d", "yllith"] as const) {
			expect(loreRegistrationForSlug(slug)).toMatchObject({
				listed: true,
				campaignTechnicalSlug: "antes-que-seja-tarde",
				indexable: false,
				entityLink: null,
			});
		}
	});

	it("takes D catalogue metadata from the approved public package", () => {
		const html = file("../../../public/lore/d/index.html");
		const story = file("../../../public/lore/d/historia-1.md");
		const entry = loreCatalogueEntries().find((lore) => lore.slug === "d");

		expect(html).toContain("<title>D — Antes que seja tarde</title>");
		expect(html).toContain(
			'<meta property="og:description" content="D quer encontrar o momento antes do tarde demais." />',
		);
		expect(html).toContain(`<meta property="og:image" content="${D_SOCIAL}" />`);
		expect(story).toContain("# D.");
		expect(story).toContain("## Antes que seja tarde demais");
		expect(entry).toMatchObject({
			name: "D",
			title: "Antes que seja tarde",
			description: "D quer encontrar o momento antes do tarde demais.",
			cover: D_SOCIAL,
		});
	});

	it("takes Yllith catalogue metadata from the approved public package", () => {
		const html = file("../../../public/lore/yllith/index.html");
		const story = file("../../../public/lore/yllith/historia.md");
		const entry = loreCatalogueEntries().find((lore) => lore.slug === "yllith");
		const description =
			"Antes de ser Yllith, ela foi Sequoia Vermelha. A história de quem deixou Ycarus para tentar criar uma matilha que escolhesse ficar.";

		expect(html).toContain("<title>Yllith — Nascida para conquistar</title>");
		expect(html).toContain(`<meta name="description" content="${description}">`);
		expect(html).toContain(`<meta property="og:image" content="${YLLITH_SOCIAL}">`);
		expect(story).toContain("# Nascida para conquistar");
		expect(entry).toMatchObject({
			name: "Yllith",
			title: "Nascida para conquistar",
			description,
			cover: YLLITH_SOCIAL,
		});
	});
});
