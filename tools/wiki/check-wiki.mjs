import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function fail(message) {
	throw new Error("WIKI_GATE: " + message);
}


/**
 * Check a full parsed URL, never a substring claimed to be a trusted origin.
 * Also recognize bare URLs in prose to preserve the Wiki's existing link style.
 */
function pageUrls(text, page) {
	const found = [];
	for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
		const literal = match[0].replace(/[.,;!?]+$/, "");
		let url;
		try { url = new URL(literal); }
		catch { fail("malformed URL in " + page); }
		if (url.protocol !== "https:" && url.protocol !== "http:") fail("unsupported URL in " + page);
		// Do not allow a fake host/path to impersonate an official source.
		if (url.hostname !== "github.com" && literal.includes("github.com/Faysk/tda/")) {
			fail("misleading embedded GitHub URL in " + page);
		}
		found.push(url);
	}
	return found;
}

function isRepoUrl(url, prefix) {
	return url.protocol === "https:" && url.hostname === "github.com" &&
		!url.username && !url.password && !url.port && url.pathname.startsWith(prefix);
}

export function checkWiki(root = defaultRoot) {
	const wikiDir = path.join(root, "wiki");
	const manifestPath = path.join(root, "tools", "wiki", "pages.json");
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const expected = new Set(manifest.pages);
	if (manifest.pages.length !== expected.size) fail("duplicate name in pages.json");
	if (!expected.has("Home") || !expected.has("_Sidebar") || !expected.has("_Footer") || !expected.has("Indice")) {
		fail("required GitHub Wiki pages are missing from manifest");
	}
	const fileNames = fs.readdirSync(wikiDir).sort();
	if (fileNames.some((f) => !f.endsWith(".md"))) fail("unapproved non-Markdown file in wiki/");
	const actual = new Set(fileNames.map((name) => name.slice(0, -3)));
	if (actual.size !== fileNames.length || actual.size !== expected.size) fail("manifest and wiki/ file count differ");
	for (const name of expected) {
		if (!/^[A-Za-z0-9_-]+$/.test(name)) fail("unsafe wiki slug: " + name);
		if (!actual.has(name)) fail("missing approved page: " + name);
	}
	const texts = new Map();
	let diagrams = 0;
	for (const name of actual) {
		if (!expected.has(name)) fail("unapproved wiki page: " + name);
		const pageFile = path.join(wikiDir, name + ".md");
		if (!fs.lstatSync(pageFile).isFile()) fail("wiki pages must be regular files, not symlinks: " + name);
		const text = fs.readFileSync(pageFile, "utf8");
		texts.set(name, text);
		if (!text.trim() || text.length < 70) fail("empty or short page: " + name);
		const headings = [...text.matchAll(/^# (.+)$/gm)].length;
		if (!name.startsWith("_") && headings !== 1) fail("exactly one H1 required in " + name);
		if (/<\s*(script|iframe|object|style|img|video|audio|embed|svg|link|meta|picture|source|form|input|button)\b/i.test(text)) fail("active HTML forbidden in " + name);
		if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{12,}|ghp_[A-Za-z0-9]{20,}/i.test(text)) {
			fail("credential signature detected in " + name);
		}
		const fences = [...text.matchAll(/^~~~(?:[a-zA-Z0-9_-]+)?\s*$/gm)];
		if (fences.length % 2 !== 0) fail("unbalanced fenced block in " + name);
		diagrams += [...text.matchAll(/^~~~mermaid\s*$/gm)].length;
		const urls = pageUrls(text, name);
		const sourcePrefix = "/Faysk/tda/blob/main/";
		const wikiPrefix = "/Faysk/tda/wiki/";
		let hasCanonicalDoc = false;
		for (const url of urls) {
			if (isRepoUrl(url, wikiPrefix)) {
				const slug = decodeURIComponent(url.pathname.slice(wikiPrefix.length));
				if (!expected.has(slug)) fail("broken internal wiki link " + name + " -> " + slug);
			}
			if (isRepoUrl(url, sourcePrefix)) {
				const relative = decodeURIComponent(url.pathname.slice(sourcePrefix.length));
				const target = path.resolve(root, relative);
				if (!relative || !target.startsWith(root + path.sep)) {
					fail("source link escapes repository " + name + " -> " + relative);
				}
				if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
					fail("missing tracked source " + name + " -> " + relative);
				}
				if (relative.startsWith("docs/")) hasCanonicalDoc = true;
			}
		}
		for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
			if (!match[1].trim()) fail("image without alt text in " + name);
			if (!manifest.approvedMedia.includes(match[2])) fail("image URL not allowlisted in " + name);
		}
		if (!name.startsWith("_") && !hasCanonicalDoc) {
			fail("wiki page missing link to canonical documentation: " + name);
		}
	}
	const sidebar = new Set(pageUrls(texts.get("_Sidebar"), "_Sidebar")
		.filter((url) => isRepoUrl(url, "/Faysk/tda/wiki/"))
		.map((url) => decodeURIComponent(url.pathname)));
	const index = new Set(pageUrls(texts.get("Indice"), "Indice")
		.filter((url) => isRepoUrl(url, "/Faysk/tda/wiki/"))
		.map((url) => decodeURIComponent(url.pathname)));
	for (const name of expected) {
		if (name.startsWith("_") || name === "Indice") continue;
		const canonical = "/Faysk/tda/wiki/" + name;
		if (!sidebar.has(canonical)) fail("missing from _Sidebar: " + name);
		if (!index.has(canonical)) fail("missing from Indice: " + name);
	}
	return { pages: actual.size, diagrams, sourcesChecked: true, mediaApproved: manifest.approvedMedia.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const report = checkWiki();
	console.log("WIKI_SOURCE_OK " + JSON.stringify(report));
}
