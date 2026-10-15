import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWiki } from "./check-wiki.mjs";

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-gate-"));
	const wiki = path.join(root, "wiki");
	const tools = path.join(root, "tools", "wiki");
	fs.mkdirSync(wiki, { recursive: true });
	fs.mkdirSync(tools, { recursive: true });
	fs.mkdirSync(path.join(root, "docs"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs", "source.md"), "# Source");
	fs.writeFileSync(path.join(tools, "pages.json"), JSON.stringify({
		pages: ["Home", "Indice", "_Sidebar", "_Footer"],
		approvedMedia: [],
	}));
	const target = "https://github.com/Faysk/tda/wiki/Home";
	const index = "https://github.com/Faysk/tda/wiki/Indice";
	const source = "https://github.com/Faysk/tda/blob/main/docs/source.md";
	fs.writeFileSync(path.join(wiki, "Home.md"), "# Home\n\nIntroduction for anyone reading the TDA wiki.\n\n" + source);
	fs.writeFileSync(path.join(wiki, "Indice.md"), "# Index\n\nA human-friendly index of all available pages.\n\n" + target + "\n\n" + source);
	fs.writeFileSync(path.join(wiki, "_Sidebar.md"), "## Pages\n\n" + target + "\n\n" + index + "\n\n" + source);
	fs.writeFileSync(path.join(wiki, "_Footer.md"), "## Documentation\n\n" + source + "\n\n" + target + "\n\n" + index);
	return root;
}

test("valid minimal wiki is accepted", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	assert.equal(checkWiki(root).pages, 4);
});

test("rejects unapproved pages", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, "wiki", "Private.md"), "# Private\n\nSensitive page not approved for release.");
	assert.throws(() => checkWiki(root), /manifest|unapproved/i);
});

test("rejects a broken wiki link", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\n\nhttps://github.com/Faysk/tda/wiki/Missing-page");
	assert.throws(() => checkWiki(root), /broken internal wiki link/);
});

test("rejects removed canonical source", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.rmSync(path.join(root, "docs", "source.md"));
	assert.throws(() => checkWiki(root), /missing canonical source/);
});

test("rejects a synthetic token leak", (t) => {
	const root = fixture();
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\n\nghp_" + "abcdefghijklmnopqrstuvwxyz123456");
	assert.throws(() => checkWiki(root), /credential signature/);
});


test("rejects direct HTML image bypassing approvedMedia", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\n<img src='https://example.test/private.png'>");
  assert.throws(() => checkWiki(root), /active HTML forbidden/);
});

test("rejects images without an explicitly approved URL", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\n![Image](https://example.test/unknown.png)");
  assert.throws(() => checkWiki(root), /image URL not allowlisted/);
});

test("approves exact images only when alt and manifest match", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = path.join(root, "tools", "wiki", "pages.json");
  const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
  data.approvedMedia.push("https://example.test/approved.png");
  fs.writeFileSync(manifest, JSON.stringify(data));
  fs.appendFileSync(path.join(root, "wiki", "Home.md"), "\n![Approved illustration](https://example.test/approved.png)");
  assert.equal(checkWiki(root).mediaApproved, 1);
});
