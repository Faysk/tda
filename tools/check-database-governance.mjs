import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonicalProjectRef = "dmrqnbdvbkfqzctcerbx";

const requiredFiles = [
	"docs/database/README.md",
	"docs/database/migrations.md",
	"docs/database/migration-reconciliations.md",
	"docs/database/security.md",
	"docs/database/rpc-inventory.md",
	"docs/database/verification-log.md",
	"docs/operations/database-runbook.md",
	"supabase/README.md",
];

for (const relativePath of requiredFiles) {
	if (!fs.existsSync(path.join(root, relativePath))) {
		throw new Error(`Missing required database governance file: ${relativePath}`);
	}
}

const read = (relativePath) =>
	fs.readFileSync(path.join(root, relativePath), "utf8");

const databaseIndex = read("docs/database/README.md");
const migrationDocs = read("docs/database/migrations.md");
const reconciliationDocs = read("docs/database/migration-reconciliations.md");
const securityDocs = read("docs/database/security.md");
const runbook = read("docs/operations/database-runbook.md");
const supabaseReadme = read("supabase/README.md");
const agents = read("AGENTS.md");

for (const requiredLink of [
	"rpc-inventory.md",
	"verification-log.md",
	"migration-reconciliations.md",
	"../operations/database-runbook.md",
]) {
	if (!databaseIndex.includes(requiredLink)) {
		throw new Error(`Database index must link ${requiredLink}`);
	}
}

if (!securityDocs.includes("rpc-inventory.md")) {
	throw new Error("Database security docs must link the privileged RPC inventory");
}

if (!agents.includes("docs/operations/database-runbook.md")) {
	throw new Error("AGENTS.md must require the database runbook before DB changes");
}

for (const [label, content] of [
	["database index", databaseIndex],
	["migration docs", migrationDocs],
	["migration reconciliations", reconciliationDocs],
	["security docs", securityDocs],
	["database runbook", runbook],
]) {
	if (!content.includes(canonicalProjectRef)) {
		throw new Error(`${label} must name canonical Supabase project ${canonicalProjectRef}`);
	}
}

const listSql = (relativeDir) => {
	const directory = path.join(root, relativeDir);
	if (!fs.existsSync(directory)) {
		throw new Error(`Missing database directory: ${relativeDir}`);
	}
	return fs
		.readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort();
};

const migrationFiles = listSql("supabase/migrations");
const candidateFiles = listSql("supabase/candidates");

if (!migrationFiles.length) {
	throw new Error("No reboot migrations found under supabase/migrations");
}

const migrationIsDocumented = (filename) => {
	const migrationId = filename.slice(0, -".sql".length);
	if (migrationDocs.includes(migrationId)) return true;

	const match = migrationId.match(/^(\d{14})_(.+)$/);
	if (!match) return false;
	const [, version, name] = match;

	// Historical/remote sections use the canonical migration-history format
	// `<timestamp> <name>` while detailed sections may use the local filename ID.
	// Require both timestamp and full name so a loose name-only mention cannot pass.
	return migrationDocs.includes(`${version} ${name}`);
};

const undocumented = migrationFiles.filter(
	(filename) => !migrationIsDocumented(filename),
);

if (undocumented.length) {
	throw new Error(
		`Undocumented reboot migrations: ${undocumented.join(", ")}. Update docs/database/migrations.md.`,
	);
}

const undocumentedCandidates = candidateFiles.filter((filename) => {
	const migrationId = filename.slice(0, -".sql".length);
	return !migrationDocs.includes(migrationId) || !supabaseReadme.includes(filename);
});

if (undocumentedCandidates.length) {
	throw new Error(
		`Undocumented migration candidates: ${undocumentedCandidates.join(", ")}. Record them as non-production candidates in docs/database/migrations.md and supabase/README.md.`,
	);
}

console.log(
	`DATABASE_GOVERNANCE_OK migrations=${migrationFiles.length} candidates=${candidateFiles.length} project=${canonicalProjectRef}`,
);
