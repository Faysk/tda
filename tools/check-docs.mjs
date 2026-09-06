import fs from "node:fs";
import path from "node:path";

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
	linksByFile.set(file, links);
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

if (
	JSON.parse(fs.readFileSync("vercel.json", "utf8")).git.deploymentEnabled !==
	false
) {
	throw Error("Auto deployment enabled");
}

console.log(
	`DOCS_AND_RELEASE_POLICY_OK files=${docs.length} reachable=${reachable.size}`,
);
