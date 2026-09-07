import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const canonicalProjectRef = "dmrqnbdvbkfqzctcerbx";

const requiredFiles = [
	"docs/database/README.md",
	"docs/database/migrations.md",
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
const securityDocs = read("docs/database/security.md");
const runbook = read("docs/operations/database-runbook.md");
const agents = read("AGENTS.md");

for (const requiredLink of [
	"rpc-inventory.md",
	"verification-log.md",
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
	["security docs", securityDocs],
	["database runbook", runbook],
]) {
	if (!content.includes(canonicalProjectRef)) {
		throw new Error(`${label} must name canonical Supabase project ${canonicalProjectRef}`);
	}
}

const migrationsDir = path.join(root, "supabase", "migrations");
const migrationFiles = fs
	.readdirSync(migrationsDir, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
	.map((entry) => entry.name)
	.sort();

if (!migrationFiles.length) {
	throw new Error("No reboot migrations found under supabase/migrations");
}

const undocumented = migrationFiles.filter((filename) => {
	const migrationId = filename.slice(0, -".sql".length);
	return !migrationDocs.includes(migrationId);
});

if (undocumented.length) {
	throw new Error(
		`Undocumented reboot migrations: ${undocumented.join(", ")}. Update docs/database/migrations.md.`,
	);
}

console.log(
	`DATABASE_GOVERNANCE_OK migrations=${migrationFiles.length} project=${canonicalProjectRef}`,
);
