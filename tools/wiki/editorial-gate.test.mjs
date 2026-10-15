import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auditWikiEditorial } from "./editorial-gate.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tda-wiki-editorial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tools/wiki"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki"));
  fs.writeFileSync(path.join(root, "tools/wiki/pages.json"), JSON.stringify({pages:["Home","Indice"],approvedMedia:[]}));
  for(const page of ["Home","Indice"]) fs.writeFileSync(path.join(root, "wiki", page+".md"), "# "+page+"\nAn approved synthetic page.");
  const register = {
    schemaVersion:1, repository:"Faysk/tda",
    pages:Object.fromEntries(["Home","Indice"].map(p=>[p,{
      status:"pending", reviewer:null, reviewedAt:null, contentSha256:null, evidence:null
    }]))
  };
  const write=()=>fs.writeFileSync(path.join(root, "tools/wiki/editorial-reviews.json"),JSON.stringify(register));
  write();
  const approve=(page)=> {
    register.pages[page]={
      status:"approved", reviewer:"document-reviewer", reviewedAt:"2026-10-15",
      contentSha256:crypto.createHash("sha256").update(fs.readFileSync(path.join(root,"wiki",page+".md"))).digest("hex"),
      evidence:"https://github.com/Faysk/tda/issues/1745#issuecomment-1234"
    };
    write();
  };
  return {root,register,write,approve};
}
test("pending review is visible without inventing a human approval",t=>{
  const f=fixture(t);
  const result=auditWikiEditorial(f.root);
  assert.equal(result.pending,2);
  assert.equal(result.approved,0);
  assert.equal(result.allApproved,false);
});
test("strict publishing gate refuses pending review",t=>{
  const f=fixture(t);
  assert.throws(()=>auditWikiEditorial(f.root,{requireApproved:true}),/awaiting human editorial review/);
});
test("exact byte hash and cited issue allow strictly reviewed pages",t=>{
  const f=fixture(t);
  f.approve("Home"); f.approve("Indice");
  assert.equal(auditWikiEditorial(f.root,{requireApproved:true}).approved,2);
});
test("editing a reviewed page invalidates earlier editorial approval",t=>{
  const f=fixture(t);
  f.approve("Home");
  fs.appendFileSync(path.join(f.root,"wiki/Home.md"),"\nChanged after approval");
  assert.throws(()=>auditWikiEditorial(f.root),/approval is stale/);
});
test("approval without credible review evidence cannot pass",t=>{
  const f=fixture(t);
  f.approve("Home");
  f.register.pages.Home.evidence="https://example.test/a"; f.write();
  assert.throws(()=>auditWikiEditorial(f.root),/requires a dated reviewer/);
});
test("a missing or extra page blocks the register",t=>{
  const f=fixture(t);
  delete f.register.pages.Indice; f.write();
  assert.throws(()=>auditWikiEditorial(f.root),/allowlist differ/);
});
test("pending status cannot retain reviewer or hash",t=>{
  const f=fixture(t);
  f.register.pages.Home.reviewer="fake"; f.write();
  assert.throws(()=>auditWikiEditorial(f.root),/pending review cannot claim/);
});
