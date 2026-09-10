import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase", "migrations");
const candidatesDir = path.join(root, "supabase", "candidates");
const reconciliationsPath = path.join(root, "supabase", "migration-reconciliations.json");
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

for (const [label, directory] of [
	["deployable migrations", migrationsDir],
	["migration candidates", candidatesDir],
]) {
	if (!fs.existsSync(directory)) {
		throw new Error(`Missing ${label} directory: ${path.relative(root, directory)}`);
	}
}

if (!fs.existsSync(reconciliationsPath)) {
	throw new Error("Missing supabase/migration-reconciliations.json");
}

const reconciliations = JSON.parse(fs.readFileSync(reconciliationsPath, "utf8"));
if (
	reconciliations.schemaVersion !== "tda_migration_reconciliations_v1" ||
	reconciliations.projectRef !== "dmrqnbdvbkfqzctcerbx" ||
	!Array.isArray(reconciliations.mappings)
) {
	throw new Error("Invalid migration reconciliation manifest");
}

const reconciliationByRename = new Map(
	reconciliations.mappings.map((entry) => [
		`${entry.from}->${entry.to}`,
		entry,
	]),
);

const listSql = (directory) =>
	fs
		.readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort();

const files = listSql(migrationsDir);
const candidateFiles = listSql(candidatesDir);
const versions = new Map();

for (const [kind, names] of [
	["migration", files],
	["candidate", candidateFiles],
]) {
	for (const file of names) {
		const match = file.match(migrationName);
		if (!match) {
			throw new Error(
				`Invalid ${kind} filename: ${file}. Expected <14 digit timestamp>_<snake_case>.sql`,
			);
		}
		const version = match[1];
		const previous = versions.get(version);
		if (previous) {
			throw new Error(
				`Duplicate migration version ${version}: ${previous} and ${kind} ${file}`,
			);
		}
		versions.set(version, `${kind} ${file}`);
	}
}

const range = process.argv[2];
const changedDeployable = [];
if (range) {
	const output = execFileSync(
		"git",
		[
			"diff",
			"-M",
			"--name-status",
			range,
			"--",
			"supabase/migrations",
			"supabase/candidates",
		],
		{ cwd: root, encoding: "utf8" },
	).trim();

	for (const line of output ? output.split("\n") : []) {
		const [status, ...parts] = line.split("\t");
		if (!status || parts.length === 0) continue;

		const source = parts[0];
		const target = parts.at(-1);
		const sourceIsMigration = source?.startsWith("supabase/migrations/");
		const targetIsMigration = target?.startsWith("supabase/migrations/");
		const targetIsCandidate = target?.startsWith("supabase/candidates/");

		if (status.startsWith("R")) {
			if (sourceIsMigration && targetIsCandidate) {
				continue;
			}

			if (sourceIsMigration && targetIsMigration) {
				const from = path.basename(source);
				const to = path.basename(target);
				const reconciliation = reconciliationByRename.get(`${from}->${to}`);
				if (!reconciliation) {
					throw new Error(`Deployable migration files must not be renamed: ${source} -> ${target}`);
				}
				const blobSha = execFileSync("git", ["hash-object", target], {
					cwd: root,
					encoding: "utf8",
				}).trim();
				if (blobSha !== reconciliation.blobSha) {
					throw new Error(
						`Migration reconciliation changed SQL bytes for ${target}: expected ${reconciliation.blobSha}, got ${blobSha}`,
					);
				}
				continue;
			}

			if (!sourceIsMigration && targetIsMigration) {
				throw new Error(
					`Do not promote an old candidate by renaming it into migrations: ${source} -> ${target}. Create a new current-timestamp migration after approval.`,
				);
			}
			continue;
		}

		if (status.startsWith("D") && sourceIsMigration) {
			const basename = path.basename(source);
			const relocated = path.join(candidatesDir, basename);
			if (!fs.existsSync(relocated)) {
				throw new Error(`Deployable migration files must not be deleted: ${source}`);
			}
			const before = execFileSync("git", ["show", `${range.split("...")[0]}:${source}`], {
				cwd: root,
				encoding: "utf8",
			});
			const after = fs.readFileSync(relocated, "utf8");
			if (before !== after) {
				throw new Error(`Migration ${source} may move to candidates only without changing its SQL bytes.`);
			}
			continue;
		}

		if (status.startsWith("M") && targetIsMigration) {
			throw new Error(
				`Existing deployable migration must not be edited in place: ${target}. Add a new migration instead.`,
			);
		}

		if (status.startsWith("A") && targetIsMigration) {
			changedDeployable.push(target);
		}
	}
}

for (const repoPath of changedDeployable) {
	const absolute = path.join(root, repoPath);
	const sql = fs.readFileSync(absolute, "utf8");
	const destructive = destructivePatterns.some((pattern) => pattern.test(sql));
	if (destructive && !allowDestructive.test(sql)) {
		throw new Error(
			`${repoPath} contains a destructive schema operation. Split it into an expand/migrate/contract release, or add an explicit '-- TDA:ALLOW_DESTRUCTIVE_MIGRATION: <reason>' marker after review.`,
		);
	}
}

console.log(
	`MIGRATION_POLICY_OK deployable=${files.length} candidates=${candidateFiles.length} added=${changedDeployable.length} reconciliations=${reconciliations.mappings.length} range=${range || "none"}`,
);