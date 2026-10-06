import fs from "node:fs";
import path from "node:path";
import "./documentation-catalog.mjs";

const root = process.cwd();

function walkMarkdown(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return walkMarkdown(full);
		return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
	});
}

function normalizeRepoPath(file) {
	return path.relative(root, file).replaceAll(path.sep, "/");
}

function localTarget(sourceFile, href) {
	if (/^(https?:|mailto:|#)/.test(href)) return null;
	const withoutFragment = href.split("#", 1)[0].split("?", 1)[0];
	if (!withoutFragment) return null;
	return path.resolve(path.dirname(sourceFile), decodeURIComponent(withoutFragment));
}

const docs = walkMarkdown(path.join(root, "docs"));
const markdownFiles = [path.join(root, "README.md"), ...docs];
const linksByFile = new Map();

for (const file of markdownFiles) {
	const links = [];
	for (const match of fs
		.readFileSync(file, "utf8")
		.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		const target = localTarget(file, match[1]);
		if (!target) continue;
		if (!fs.existsSync(target)) {
			throw Error(
				`Broken documentation link: ${normalizeRepoPath(file)} -> ${match[1]}`,
			);
		}
		links.push(target);
	}
	// A generated inventory must not hide missing editorial index links.
	linksByFile.set(
		file,
		normalizeRepoPath(file) === "docs/documentation/catalog.md" ? [] : links,
	);
}

// Every Markdown document under docs/ must be reachable from docs/README.md.
// This keeps the documentation modular without allowing invisible/orphan files.
const docsRoot = path.join(root, "docs", "README.md");
const reachable = new Set();
const queue = [docsRoot];
while (queue.length) {
	const current = queue.shift();
	if (!current || reachable.has(current)) continue;
	reachable.add(current);
	for (const target of linksByFile.get(current) ?? []) {
		if (
			target.startsWith(path.join(root, "docs") + path.sep) &&
			target.endsWith(".md") &&
			!reachable.has(target)
		) {
			queue.push(target);
		}
	}
}

const orphanDocs = docs.filter((file) => !reachable.has(file));
if (orphanDocs.length) {
	throw Error(
		`Orphan documentation (not reachable from docs/README.md): ${orphanDocs
			.map(normalizeRepoPath)
			.join(", ")}`,
	);
}

function repoText(file) {
	return fs.readFileSync(path.join(root, file), "utf8");
}

function requireText(file, expected, contract) {
	if (!repoText(file).includes(expected)) {
		throw Error(
			`Documentation contract drift: ${contract} (${file} missing ${JSON.stringify(expected)})`,
		);
	}
}

function forbidText(file, forbidden, contract) {
	if (repoText(file).includes(forbidden)) {
		throw Error(
			`Documentation contract drift: ${contract} (${file} still contains ${JSON.stringify(forbidden)})`,
		);
	}
}

// Low-heuristic guards for facts with a single machine-readable authority.
// They intentionally do not attempt to infer whether arbitrary prose is current.
const pyproject = repoText("local-companion/pyproject.toml");
const packageVersion = pyproject.match(/^version = "([^"]+)"$/m)?.[1];
const packageInitVersion = repoText("local-companion/tda_companion/__init__.py")
	.match(/^VERSION = "([^"]+)"$/m)?.[1];
if (!packageVersion || packageVersion !== packageInitVersion) {
	throw Error("Companion version sources disagree");
}

const runtimeCompat = repoText("local-companion/tda_companion/runtime_compat.py");
const qwenMinimum = runtimeCompat.match(
	/^MIN_COMPATIBLE_QWEN_RUNTIME_VERSION = "([^"]+)"$/m,
)?.[1];
if (!qwenMinimum) throw Error("Could not read Qwen minimum runtime version");

requireText(
	"docs/features/local-processing.md",
	`**TDA Companion ${packageVersion}**`,
	"local-processing must name the current Companion code line",
);
requireText(
	"docs/features/local-processing.md",
	`**Qwen Runtime ${qwenMinimum}**`,
	"local-processing must name the current normal Qwen minimum",
);
requireText(
	"docs/integrations/local-companion-v1.md",
	`service_version="${packageVersion}"`,
	"wire API documentation must separate API v1 from the current service version",
);
forbidText(
	"docs/features/transcript-review-publication.md",
	"> Status: arquitetura aprovada; implementação pendente",
	"transcript lifecycle cannot advertise implemented slices as wholly pending",
);
requireText(
	"docs/features/transcript-review-publication.md",
	"ADR-0021",
	"current transcript delete semantics must point to the governing ADR",
);
requireText(
	"docs/features/multi-recording-sessions.md",
	"tda_session_timeline_v2",
	"multi-recording must identify the current timing policy",
);
requireText(
	"docs/features/multi-recording-sessions.md",
	"strong_discord_or_local_v2",
	"multi-recording must distinguish participant schema from current policy",
);
requireText(
	"docs/features/multi-recording-sessions.md",
	"ADR-0022",
	"multi-recording overlap semantics must point to the governing ADR",
);
requireText(
	"docs/documentation/README.md",
	"## Taxonomia obrigatória dentro de documentos vivos",
	"documentation governance must separate current, legacy, history and future",
);
for (const category of [
	"**Current behavior**",
	"**Legacy compatibility**",
	"**Historical implementation notes**",
	"**Future backlog / unresolved decisions**",
]) {
	requireText(
		"docs/documentation/README.md",
		category,
		"documentation governance taxonomy must keep all four semantic categories",
	);
}

if (
	JSON.parse(fs.readFileSync("vercel.json", "utf8")).git.deploymentEnabled !==
	false
) {
	throw Error("Auto deployment enabled");
}

console.log(
	`DOCS_AND_RELEASE_POLICY_OK files=${docs.length} reachable=${reachable.size}`,
);
