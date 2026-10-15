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
  const pages = markdownFiles(path.join(root, "wiki"));
  const referenced = new Set();
  for (const file of pages) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/https:\/\/github\.com\/Faysk\/tda\/blob\/main\/(docs\/[A-Za-z0-9_./-]+\.md)/g)) referenced.add(match[1]);
  }
  let linked = 0, missingOwner = 0, missingReview = 0;
  const byArea = {};
  for (const file of docs) {
    const rel = path.relative(root, file).replaceAll(path.sep, "/");
    const area = rel.split("/").length >= 3 ? rel.split("/")[1] : "root";
    const content = fs.readFileSync(file, "utf8");
    missingOwner += /^>\s*Owner:\s*\S/m.test(content) ? 0 : 1;
    missingReview += /^>\s*Última revisão:\s*\S/m.test(content) ? 0 : 1;
    const found = referenced.has(rel);
    linked += found ? 1 : 0;
    byArea[area] ??= { total: 0, linked: 0 };
    byArea[area].total++;
    if (found) byArea[area].linked++;
  }
  const known = new Set(docs.map((f) => path.relative(root, f).replaceAll(path.sep, "/")));
  const unresolved = [...referenced].filter((rel) => !known.has(rel)).sort();
  return {
    docs: docs.length, wikiPages: pages.length, linked, notLinked: docs.length - linked,
    missingOwner, missingReview, byArea, unresolved,
    caveat: "A link is not evidence that a feature is implemented, published or fully documented.",
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = auditWikiCoverage();
  console.log("WIKI_COVERAGE " + JSON.stringify(r, null, 2));
  if (r.unresolved.length) process.exitCode = 1;
}
