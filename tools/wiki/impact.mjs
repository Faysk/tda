import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
export function analyzeWikiImpact(root, changedPaths) {
  const pages = fs.readdirSync(path.join(root, "wiki"))
    .filter((file) => file.endsWith(".md")).sort();
  const changedDocs = [...new Set(changedPaths.filter((p) => p.startsWith("docs/") && p.endsWith(".md")))].sort();
  const impact = changedDocs.map((file) => {
    const url = "https://github.com/Faysk/tda/blob/main/" + file;
    const guides = pages.filter((page) =>
      fs.readFileSync(path.join(root, "wiki", page), "utf8").includes(url),
    ).map((page) => page.slice(0, -3));
    return { source: file, wikiPagesToReview: guides };
  });
  return { changedDocs: changedDocs.length, impact,
    note: "Potential review only. A changed document does not automatically make the wiki inaccurate, nor does a link prove freshness." };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--base");
  const base = i >= 0 ? args[i + 1] : null;
  if (!base || !/^[A-Za-z0-9_./-]+$/.test(base) || base.startsWith("-")) {
    throw Error("WIKI_IMPACT: provide a trusted local git base ref with --base <ref>");
  }
  const output = execFileSync("git", ["-C", projectRoot, "diff", "--name-only",
    "--diff-filter=ACMRT", base + "...HEAD", "--", "docs/"], { encoding: "utf8" });
  const report = analyzeWikiImpact(projectRoot, output.split(/\r?\n/).filter(Boolean));
  console.log("WIKI_IMPACT " + JSON.stringify(report, null, 2));
}
