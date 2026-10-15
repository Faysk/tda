import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWikiReviewPacket } from "./review-packet.mjs";

const sha = "a".repeat(40);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-packet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tools/wiki"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.writeFileSync(path.join(root, "docs", "source.md"), "# Canonical source");
  const slugs = ["Home", "Indice", "_Sidebar", "_Footer"];
  fs.writeFileSync(path.join(root, "tools/wiki/pages.json"), JSON.stringify({ pages: slugs, approvedMedia: [] }));
  const repoSource = "https://github.com/Faysk/tda/blob/main/docs/source.md";
  const links = slugs.map(s => "https://github.com/Faysk/tda/wiki/" + s).join("\n");
  const descriptions = {
    Home:"# Home\n\nGuide for new visitors and reviewers. ",
    Indice:"# Index\n\nHuman-friendly navigation to documentation. ",
    _Sidebar:"### Primeiros passos\n\nHuman-friendly wiki navigation menu. ",
    _Footer:"## Footer\n\nHelpful links for human readers. "
  };
  for (const slug of slugs) {
    fs.writeFileSync(path.join(root, "wiki", slug + ".md"), descriptions[slug] + repoSource + "\n" + links);
  }
  // The sidebar needs proper individual linked rows for grouping.
  fs.writeFileSync(path.join(root, "wiki/_Sidebar.md"),
    "### Primeiros passos\n" +
    slugs.filter(x=>!x.startsWith("_")).map(x=>"- ["+x+"](https://github.com/Faysk/tda/wiki/"+x+")").join("\n")+
    "\n\nHelpful docs. " + repoSource);
  fs.writeFileSync(path.join(root,"tools/wiki/editorial-reviews.json"),JSON.stringify({
    schemaVersion:1, repository:"Faysk/tda",
    pages:Object.fromEntries(slugs.map(s=>[s,{ status:"pending", reviewer:null, reviewedAt:null, contentSha256:null, evidence:null }]))
  }));
  return root;
}
test("review packet includes every allowlisted page and exact-source links",t=>{
  const root=fixture(t);
  // Navigation support pages may not carry an independent docs source.
  const footer=path.join(root,"wiki/_Footer.md");
  fs.writeFileSync(footer,fs.readFileSync(footer,"utf8")
    .replace("https://github.com/Faysk/tda/blob/main/docs/source.md", "Support links"));
  const r=buildWikiReviewPacket(root,sha);
  assert.equal(r.pages,4);
  assert.equal(r.pending,4);
  assert.equal(r.approved,0);
  assert.equal(r.groups,2);
  assert.match(r.markdown,/blob\/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\/wiki\/Home.md/);
  assert.match(r.markdown,/SHA-256/);
  assert.match(r.markdown,/sem link de fonte docs/);
});
test("review packet refuses missing sidebar category",t=>{
  const root=fixture(t);
  const file=path.join(root,"wiki/_Sidebar.md");
  fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace(
    "- [Indice](https://github.com/Faysk/tda/wiki/Indice)",""));
  assert.throws(()=>buildWikiReviewPacket(root,sha),/missing from _Sidebar|lacks review category/);
});
test("review packet rejects a nonexistent Git SHA",t=>{
  const root=fixture(t);
  assert.throws(()=>buildWikiReviewPacket(root,"main"),/exact 40-character/);
});
test("review packet cannot silently accept stale editorial approval",t=>{
  const root=fixture(t);
  const file=path.join(root,"tools/wiki/editorial-reviews.json");
  const d=JSON.parse(fs.readFileSync(file,"utf8"));
  d.pages.Home={status:"approved",reviewer:"reviewer",reviewedAt:"2026-10-15",
    contentSha256:"b".repeat(64),evidence:"https://github.com/Faysk/tda/issues/1760"};
  fs.writeFileSync(file,JSON.stringify(d));
  assert.throws(()=>buildWikiReviewPacket(root,sha),/approval is stale/);
});

test("review dossier separates pre-publication editorial approval from post-push UI smoke",t=>{
  const root=fixture(t);
  const packet=buildWikiReviewPacket(root,sha).markdown;
  assert.match(packet, /Registrar revisão humana no GitHub/);
  assert.match(packet, /Fase B pós-publicação \(separada\)/);
  assert.match(packet, /Este documento é um \*\*roteiro de revisão\*\*, não uma aprovação/);
});
