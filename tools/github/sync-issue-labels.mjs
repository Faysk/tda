const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repository || !token) {
	throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
}

const [owner, repo] = repository.split("/");
if (!owner || !repo) {
	throw new Error(`Invalid GITHUB_REPOSITORY: ${repository}`);
}

const families = {
	types: {
		color: "1D76DB",
		labels: {
			"type:bug": "Implemented behavior violates a contract or expected invariant.",
			"type:feature": "New or expanded product capability.",
			"type:epic": "Parent outcome coordinating independently closable issues.",
			"type:ops": "Operational, infrastructure or maintenance work.",
			"type:release": "Release candidate, promotion or release evidence.",
			"type:test": "Test coverage, harness or quality gate.",
			"type:docs": "Documentation is the primary deliverable.",
			"type:security": "Security, authorization, signing or hardening work.",
			"type:performance": "Performance, cost, throughput or resource optimization.",
			"type:investigation": "Evidence-gathering work ending in a decision.",
		},
	},
	areas: {
		color: "0E8A7A",
		labels: {
			"area:processing": "End-to-end local processing domain.",
			"area:processing-web": "Web processing UI, bootstrap, submission and UX.",
			"area:companion": "Companion Agent/Desktop, ASR, worker, MSI and updater.",
			"area:transcripts": "Transcript review, revisions, publication and editorial contracts.",
			"area:auth": "Login, sessions, capabilities, RBAC and scopes.",
			"area:database": "PostgreSQL, migrations, RLS, grants and relational integrity.",
			"area:sessions": "Public sessions, participants, summaries and navigation.",
			"area:world": "World Explorer, relations, graph, maps and projections.",
			"area:entities": "Entities, NPCs, characters, provenance and narrative audience.",
			"area:media": "Media Storage, R2, uploads, assets and delivery.",
			"area:lore": "Lore content and dedicated narrative surfaces.",
			"area:design-system": "Design tokens, components, brand and accessibility.",
			"area:ux": "Cross-cutting user experience and information architecture.",
			"area:release": "Candidate, deploy, rollback and promotion pipeline.",
			"area:governance": "Repository governance, coordination and backlog policy.",
			"area:stats": "Statistics, operational cost and functional metrics.",
		},
	},
};

const labels = {
	...Object.fromEntries(
		Object.entries(families.types.labels).map(([name, description]) => [
			name,
			{ color: families.types.color, description },
		]),
	),
	...Object.fromEntries(
		Object.entries(families.areas.labels).map(([name, description]) => [
			name,
			{ color: families.areas.color, description },
		]),
	),
	"priority:P0": {
		color: "B60205",
		description: "Immediate action: severe active risk or unsafe release blocker.",
	},
	"priority:P1": {
		color: "D93F0B",
		description: "High priority: critical path, release blocker or important invariant.",
	},
	"priority:P2": {
		color: "FBCA04",
		description: "Medium priority: important but limited or with workaround.",
	},
	"priority:P3": {
		color: "0E8A16",
		description: "Low priority: maintenance, cleanup or non-urgent improvement.",
	},
	"status:blocked": {
		color: "7057FF",
		description: "Cannot progress until an explicit dependency is resolved.",
	},
	"status:planned": {
		color: "D4C5F9",
		description: "Approved direction intentionally scheduled for a later slice.",
	},
	"triage:needed": {
		color: "C5DEF5",
		description: "Needs backlog decision on priority, scope, ownership or relevance.",
	},
	audit: {
		color: "5319E7",
		description: "Confirmed or created through an evidence-backed audit.",
	},
};

const api = async (path, init = {}) => {
	const response = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(init.headers || {}),
		},
	});

	if (!response.ok) {
		throw new Error(
			`${init.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`,
		);
	}

	if (response.status === 204) return null;
	return response.json();
};

const existing = await api(
	`/repos/${owner}/${repo}/labels?per_page=100`,
);
const byName = new Map(existing.map((label) => [label.name, label]));

let created = 0;
let updated = 0;
let unchanged = 0;

for (const [name, desired] of Object.entries(labels)) {
	const current = byName.get(name);

	if (!current) {
		await api(`/repos/${owner}/${repo}/labels`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, ...desired }),
		});
		created++;
		console.log(`LABEL_CREATED ${name} #${desired.color}`);
		continue;
	}

	const sameColor = current.color.toUpperCase() === desired.color;
	const sameDescription = (current.description || "") === desired.description;
	if (sameColor && sameDescription) {
		unchanged++;
		console.log(`LABEL_OK ${name} #${desired.color}`);
		continue;
	}

	await api(
		`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				new_name: name,
				color: desired.color,
				description: desired.description,
			}),
		},
	);
	updated++;
	console.log(`LABEL_UPDATED ${name} #${desired.color}`);
}

console.log(
	`LABEL_SYNC_OK canonical=${Object.keys(labels).length} created=${created} updated=${updated} unchanged=${unchanged}`,
);
