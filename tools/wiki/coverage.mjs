import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.isFile() && file.endsWith(".md") ? [file] : [];
  });
}

export function auditWikiCoverage(root = defaultRoot) {
  const docs = markdownFiles(path.join(root, "docs")).sort();
  const pages = markdownFiles(path.join(root, "wiki")).sort();
  const referenced = new Map();

  for (const file of pages) {
    const content = fs.readFileSync(file, "utf8");
    const page = path.basename(file, ".md");
    for (const match of content.matchAll(/https:\/\/github\.com\/Faysk\/tda\/blob\/main\/(docs\/[A-Za-z0-9_./-]+\.md)/g)) {
      const owners = referenced.get(match[1]) ?? new Set();
      owners.add(page);
      referenced.set(match[1], owners);
    }
  }

  let linked = 0, missingOwner = 0, missingReview = 0;
  const byArea = {};
  const sourceMatrix = [];

  for (const file of docs) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    const area = rel.split("/").length >= 3 ? rel.split("/")[1] : "root";
    const body = fs.readFileSync(file, "utf8");
    // Inspect only the opening metadata. Quoted Owner examples further down
    // must not be mistaken for reviewed and approved metadata.
    const header = body.split("\n").slice(0, 36).join("\n");
    const owner = header.match(/^>\s*Owner:\s*(\S.*)$/m)?.[1]?.trim() ?? null;
    const lastReview = header.match(/^>\s*Última revisão:\s*(\S.*)$/m)?.[1]?.trim() ?? null;
    const wikiPages = [...(referenced.get(rel) ?? [])].sort();
    const found = wikiPages.length > 0;

    missingOwner += owner ? 0 : 1;
    missingReview += lastReview ? 0 : 1;
    linked += found ? 1 : 0;
    byArea[area] ??= { total: 0, linked: 0 };
    byArea[area].total++;
    if (found) byArea[area].linked++;

    sourceMatrix.push({
      path: rel,
      area,
      wikiPages,
      owner,
      lastReview,
      disposition: "requires-owner-review",
    });
  }
  const known = new Set(docs.map((file) => path.relative(root, file).replaceAll(path.sep, "/")));
  const unresolved = [...referenced.keys()].filter((rel) => !known.has(rel)).sort();

  return {
    docs: docs.length,
    wikiPages: pages.length,
    linked,
    notLinked: docs.length - linked,
    missingOwner,
    missingReview,
    byArea,
    unresolved,
    sourceMatrix,
    caveat: "A Wiki link is not publication approval, feature maturity, complete documentation or evidence of production release. Every source needs owner-led editorial classification.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = auditWikiCoverage();
  if (process.argv.includes("--matrix")) {
    console.log("WIKI_SOURCE_MATRIX " + JSON.stringify({
      sourceSha: null,
      inventory: r.sourceMatrix,
      note: r.caveat,
    }, null, 2));
  } else {
    const { sourceMatrix, ...summary } = r;
    console.log("WIKI_COVERAGE " + JSON.stringify(summary, null, 2));
    console.log("For path-level inventory: node tools/wiki/coverage.mjs --matrix");
  }
  if (r.unresolved.length) process.exitCode = 1;
}
