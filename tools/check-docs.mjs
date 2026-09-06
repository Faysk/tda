import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
for (const file of [
	"README.md",
	...fs
		.readdirSync("docs")
		.filter((x) => x.endsWith(".md"))
		.map((x) => `docs/${x}`),
]) {
	for (const m of fs
		.readFileSync(file, "utf8")
		.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		if (/^(https?:|#)/.test(m[1])) continue;
		if (!fs.existsSync(path.resolve(root, path.dirname(file), m[1])))
			throw Error(`Broken link: ${file}`);
	}
}
if (
	JSON.parse(fs.readFileSync("vercel.json", "utf8")).git.deploymentEnabled !==
	false
)
	throw Error("Auto deployment enabled");
console.log("DOCS_AND_RELEASE_POLICY_OK");
