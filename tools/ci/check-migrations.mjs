import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const migrationName = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const allowDestructive = /^--\s*TDA:ALLOW_DESTRUCTIVE_MIGRATION:\s*\S.+$/m;
const destructivePatterns = [
	/\bdrop\s+table\b/i,
	/\bdrop\s+column\b/i,
	/\btruncate\b/i,
	/\bdrop\s+schema\b/i,
	/\bdrop\s+type\b/i,
	/\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\btype\b/i,
];

if (!fs.existsSync(migrationsDir)) {
	throw new Error("supabase/migrations is missing");
}

const files = fs
	.readdirSync(migrationsDir, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
	.map((entry) => entry.name)
	.sort();

const versions = new Map();
for (const file of files) {
	const match = file.match(migrationName);
	if (!match) {
		throw new Error(
			`Invalid migration filename: ${file}. Expected <14 digit timestamp>_<snake_case>.sql`,
		);
	}
	const version = match[1];
	if (versions.has(version)) {
		throw new Error(
			`Duplicate migration version ${version}: ${versions.get(version)} and ${file}`,
		);
	}
	versions.set(version, file);
}

const range = process.argv[2];
const changed = [];
if (range) {
	const output = execFileSync(
		"git",
		[
			"diff",
			"--name-status",
			range,
			"--",
			"supabase/migrations",
		],
		{ cwd: root, encoding: "utf8" },
	).trim();

	for (const line of output ? output.split("\n") : []) {
		const [status, ...parts] = line.split("\t");
		if (!status || parts.length === 0) continue;
		if (status.startsWith("D")) {
			throw new Error(`Applied migration files must not be deleted: ${parts.at(-1)}`);
		}
		if (status.startsWith("R")) {
			throw new Error(`Migration files must not be renamed: ${parts.join(" -> ")}`);
		}
		if (status.startsWith("A") || status.startsWith("M")) {
			changed.push(parts.at(-1));
		}
	}
}

for (const repoPath of changed) {
	if (!repoPath?.endsWith(".sql")) continue;
	const absolute = path.join(root, repoPath);
	if (!fs.existsSync(absolute)) continue;
	const sql = fs.readFileSync(absolute, "utf8");
	const destructive = destructivePatterns.some((pattern) => pattern.test(sql));
	if (destructive && !allowDestructive.test(sql)) {
		throw new Error(
			`${repoPath} contains a destructive schema operation. Split it into an expand/migrate/contract release, or add an explicit '-- TDA:ALLOW_DESTRUCTIVE_MIGRATION: <reason>' marker after review.`,
		);
	}
}

console.log(
	`MIGRATION_POLICY_OK total=${files.length} changed=${changed.length} range=${range || "none"}`,
);
