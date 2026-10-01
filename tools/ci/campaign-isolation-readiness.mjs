import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");

const RULES = [
	{
		issue: 1128,
		surface: "processing",
		description: "Processing must not regain implicit global campaign authority.",
		files: [
			{
				path: "src/app/edit/processamento/page.tsx",
				forbidden: [/CAMPAIGN_SLUG/u, /campaignId:\s*["']yuhara-main["']/u],
			},
			{
				path: "src/features/edit/processing/submission.tsx",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
		],
	},
	{
		issue: 1129,
		surface: "edit-sessions",
		description:
			"Edit session library/detail/move must resolve an explicit authorized campaign.",
		files: [
			{
				path: "src/app/edit/sessoes/page.tsx",
				forbidden: [
					/listEditSessionLibrary\(CAMPAIGN_SLUG\)/u,
					/import\s*\{[^}]*CAMPAIGN_SLUG[^}]*\}\s*from\s*["']@\/features\/sessions\/model["']/su,
				],
			},
		],
	},
	{
		issue: 1130,
		surface: "world",
		description:
			"World public/editorial routes, layout, leases and publish actions must be campaign-qualified.",
		files: [
			{ path: "src/app/mundo/page.tsx", forbidden: [/CAMPAIGN_SLUG/u] },
			{
				path: "src/features/world-explorer/world-edit-actions.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/features/world-explorer/layout-repository.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/features/world-explorer/world-graph-actions.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/features/world-explorer/world-layout-session-actions.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
		],
	},
	{
		issue: 1131,
		surface: "lore",
		description:
			"Lore/entity repositories must receive campaign context explicitly and keep standalone lore independent.",
		files: [
			{
				path: "src/features/lore/repository.ts",
				forbidden: [
					/const\s+CAMPAIGN_SLUG\s*=\s*["']yuhara-main["']/u,
					/\.eq\(["']slug["'],\s*CAMPAIGN_SLUG\)/u,
				],
			},
		],
	},
	{
		issue: 1133,
		surface: "transcripts-review",
		description:
			"Transcript statistics and narrative review must not silently default to the legacy campaign.",
		files: [
			{
				path: "src/app/transcricoes/page.tsx",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/app/edit/revisao/page.tsx",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/features/edit/review/server.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/features/edit/review/actions.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
		],
	},
	{
		issue: 1135,
		surface: "media",
		description:
			"Campaign-owned media actions must derive campaign identity from the authorized operation, not a global constant.",
		files: [
			{
				path: "src/features/world-explorer/world-entity-media-actions.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
		],
	},
	{
		issue: 1136,
		surface: "navigation",
		description:
			"Global/Edit navigation must preserve campaign context and never silently target the legacy campaign.",
		files: [
			{
				path: "src/features/edit/navigation-entry.ts",
				forbidden: [/CAMPAIGN_SLUG/u],
			},
			{
				path: "src/components/public-navigation-model.ts",
				forbidden: [
					/href:\s*["']\/sessoes["']/u,
					/href:\s*["']\/mundo["']\s*,\s*label:\s*["']Editar mundo["']/u,
					/CAMPAIGN_SLUG/u,
				],
			},
		],
	},
];

function readSource(root, path) {
	try {
		return { ok: true, source: readFileSync(resolve(root, path), "utf8") };
	} catch {
		return { ok: false, source: "" };
	}
}

export function scanCampaignIsolationReadiness(root = DEFAULT_ROOT) {
	const blockers = [];

	for (const rule of RULES) {
		const matches = [];
		for (const file of rule.files) {
			const loaded = readSource(root, file.path);
			if (!loaded.ok) {
				matches.push({
					path: file.path,
					reason: "missing_file",
				});
				continue;
			}

			for (const pattern of file.forbidden) {
				if (pattern.test(loaded.source)) {
					matches.push({
						path: file.path,
						reason: "forbidden_global_campaign_dependency",
						pattern: String(pattern),
					});
				}
			}
		}

		if (matches.length) {
			blockers.push({
				issue: rule.issue,
				surface: rule.surface,
				description: rule.description,
				matches,
			});
		}
	}

	return {
		schema: "tda.campaign-isolation-readiness.v1",
		ready: blockers.length === 0,
		synthetic: true,
		productionMutation: false,
		blockers,
	};
}

function main() {
	const requireReady = process.argv.includes("--require-ready");
	const json = process.argv.includes("--json");
	const result = scanCampaignIsolationReadiness();

	if (json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	} else if (result.ready) {
		console.log("CAMPAIGN_ISOLATION_READY blockers=0");
	} else {
		console.log(
			`CAMPAIGN_ISOLATION_BLOCKED blockers=${result.blockers.length} issues=${result.blockers.map((blocker) => `#${blocker.issue}`).join(",")}`,
		);
		for (const blocker of result.blockers) {
			console.log(
				`- #${blocker.issue} ${blocker.surface}: ${blocker.matches.map((match) => match.path).join(", ")}`,
			);
		}
	}

	if (requireReady && !result.ready) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
