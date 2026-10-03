import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED = {
	appPages: [
		"src/app/campanhas/[campaignSlug]/faccoes/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/faccoes/page.tsx",
		"src/app/campanhas/[campaignSlug]/lugares/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/lugares/page.tsx",
		"src/app/campanhas/[campaignSlug]/mundo/page.tsx",
		"src/app/campanhas/[campaignSlug]/musicas/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/musicas/page.tsx",
		"src/app/campanhas/[campaignSlug]/npcs/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/npcs/page.tsx",
		"src/app/campanhas/[campaignSlug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/personagens/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/personagens/page.tsx",
		"src/app/campanhas/[campaignSlug]/quests/[slug]/page.tsx",
		"src/app/campanhas/[campaignSlug]/quests/page.tsx",
		"src/app/campanhas/[campaignSlug]/sessoes/[sessionId]/page.tsx",
		"src/app/campanhas/[campaignSlug]/sessoes/page.tsx",
		"src/app/campanhas/page.tsx",
		"src/app/campanhas/sessoes/page.tsx",
		"src/app/conta/page.tsx",
		"src/app/diario/page.tsx",
		"src/app/edit/[campaignSlug]/mundo/page.tsx",
		"src/app/edit/[campaignSlug]/permissions/page.tsx",
		"src/app/edit/[campaignSlug]/processamento/page.tsx",
		"src/app/edit/[campaignSlug]/revisao/page.tsx",
		"src/app/edit/[campaignSlug]/sessoes/[id]/page.tsx",
		"src/app/edit/[campaignSlug]/sessoes/page.tsx",
		"src/app/edit/[campaignSlug]/transcricoes/page.tsx",
		"src/app/edit/campanhas/page.tsx",
		"src/app/edit/mundo/page.tsx",
		"src/app/edit/page.tsx",
		"src/app/edit/processamento/page.tsx",
		"src/app/edit/revisao/page.tsx",
		"src/app/edit/sessoes/[id]/page.tsx",
		"src/app/edit/sessoes/page.tsx",
		"src/app/entrar/page.tsx",
		"src/app/faccoes/[slug]/page.tsx",
		"src/app/faccoes/page.tsx",
		"src/app/lembra/page.tsx",
		"src/app/lore/page.tsx",
		"src/app/lore/pipipi/page.tsx",
		"src/app/lugares/[slug]/page.tsx",
		"src/app/lugares/page.tsx",
		"src/app/mundo/page.tsx",
		"src/app/musicas/[slug]/page.tsx",
		"src/app/musicas/page.tsx",
		"src/app/npcs/[slug]/page.tsx",
		"src/app/npcs/page.tsx",
		"src/app/page.tsx",
		"src/app/personagens/[slug]/page.tsx",
		"src/app/personagens/page.tsx",
		"src/app/quests/[slug]/page.tsx",
		"src/app/quests/page.tsx",
		"src/app/sessoes/[id]/page.tsx",
		"src/app/sessoes/page.tsx",
		"src/app/transcricoes/page.tsx",
	],
	specialSurfaces: [
		"src/app/conta/loading.tsx",
		"src/app/diario/loading.tsx",
		"src/app/edit/[campaignSlug]/permissions/loading.tsx",
		"src/app/edit/processamento/loading.tsx",
		"src/app/edit/revisao/loading.tsx",
		"src/app/error.tsx",
		"src/app/lembra/error.tsx",
		"src/app/lembra/loading.tsx",
		"src/app/mundo/loading.tsx",
		"src/app/not-found.tsx",
		"src/app/transcricoes/loading.tsx",
	],
	standaloneHtml: [
		"public/diario/astel/index.html",
		"public/diario/astel/leitura.html",
		"public/lore/astel/index.html",
		"public/lore/d/index.html",
		"public/lore/noah/index.html",
		"public/lore/yllith/index.html",
	],
};

function normalize(path) {
	return path.split(sep).join("/");
}

function walk(root, directory) {
	const absolute = join(root, directory);
	const paths = [];
	for (const entry of readdirSync(absolute, { withFileTypes: true })) {
		const child = join(absolute, entry.name);
		if (entry.isDirectory()) {
			paths.push(...walk(root, normalize(relative(root, child))));
		} else {
			paths.push(normalize(relative(root, child)));
		}
	}
	return paths;
}

export function collectLayoutSurfaceInventory(root = process.cwd()) {
	const app = walk(root, "src/app");
	const publicFiles = walk(root, "public");
	return {
		appPages: app
			.filter((path) => path.endsWith("/page.tsx") || path === "src/app/page.tsx")
			.filter((path) => !path.includes("/e2e-fixtures/"))
			.sort(),
		specialSurfaces: app
			.filter((path) => /\/(?:error|loading|not-found)\.tsx$/u.test(path))
			.filter((path) => !path.includes("/e2e-fixtures/"))
			.sort(),
		standaloneHtml: publicFiles
			.filter((path) => /^public\/(?:lore|diario)\/.*\.html$/u.test(path))
			.sort(),
	};
}

export function assertLayoutSurfaceInventory(root = process.cwd()) {
	const actual = collectLayoutSurfaceInventory(root);
	for (const key of Object.keys(EXPECTED)) {
		assert.deepEqual(
			actual[key],
			EXPECTED[key],
			`Layout surface inventory drifted in ${key}. Update the #1080/#1091 ownership map and this gate deliberately.`,
		);
	}
	return actual;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const result = assertLayoutSurfaceInventory();
	console.log(
		`LAYOUT_SURFACE_INVENTORY_OK appPages=${result.appPages.length} special=${result.specialSurfaces.length} standalone=${result.standaloneHtml.length}`,
	);
}
