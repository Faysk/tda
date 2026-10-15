import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditWikiEditorial } from "./editorial-gate.mjs";
import { checkWiki } from "./check-wiki.mjs";

const rootDefault = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
function fail(s) { throw new Error("WIKI_REVIEW_PACKET: " + s); }
function manifestAt(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "tools/wiki/pages.json"), "utf8"));
}

function sidebarGroups(markdown, names) {
  const allowed = new Set(names);
  const seen = new Set();
  const groups = [];
  let current;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) {
      current = { title: heading[1], pages: [] };
      groups.push(current);
      continue;
    }
    const match = line.match(/^\s*-\s+\[[^\]]+\]\(https:\/\/github\.com\/Faysk\/tda\/wiki\/([A-Za-z0-9_-]+)\)\s*$/);
    if (!match) continue;
    const name = match[1];
    if (!current || !allowed.has(name) || seen.has(name)) {
      fail("unknown, repeated or ungrouped page in _Sidebar: " + name);
    }
    seen.add(name);
    current.pages.push(name);
  }
  const other = names.filter((name) => !seen.has(name));
  if (other.some((name) => !["_Sidebar", "_Footer"].includes(name))) {
    fail("page lacks review category in _Sidebar: " + other.join(", "));
  }
  if (other.length) groups.push({ title: "Navegação e componentes da Wiki", pages: other });
  return groups;
}

export function buildWikiReviewPacket(root = rootDefault, sourceSha) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) fail("exact 40-character source SHA required");
  const checked = checkWiki(root);
  const editorial = auditWikiEditorial(root);
  const manifest = manifestAt(root);
  const reviews = JSON.parse(fs.readFileSync(path.join(root, "tools/wiki/editorial-reviews.json"), "utf8"));
  const groups = sidebarGroups(
    fs.readFileSync(path.join(root, "wiki/_Sidebar.md"), "utf8"), manifest.pages,
  );
  const count = groups.reduce((acc, group) => acc + group.pages.length, 0);
  if (count !== manifest.pages.length) fail("category count differs from allowlist");
  const backtick = String.fromCharCode(96);
  const output = [
    "# Dossiê de revisão editorial — Wiki TDA",
    "",
    "Este documento é um **roteiro de revisão**, não uma aprovação.",
    "Fonte do pacote: " + backtick + sourceSha + backtick,
    "Páginas allowlisted: **" + checked.pages + "** · Mermaid: **" + checked.diagrams + "**.",
    "Registro: **" + editorial.approved + " aprovadas**, **" + editorial.pending + " pendentes**.",
    "",
    "## Critérios para cada página",
    "",
    "- [ ] Conferir explicação com a fonte canônica atual e distinguir implementação, rollout e publicação real",
    "- [ ] Confirmar que não há segredos, áudio/identificadores privados nem instruções destrutivas",
    "- [ ] Verificar leitura sem conhecimento prévio de RPG/infraestrutura, links e linguagem PT-BR",
    "- [ ] Verificar exemplos sintéticos e acessibilidade textual dos diagramas/imagens",
    "- [ ] Registrar revisão humana no GitHub e SHA-256 exato no arquivo editorial-reviews.json",
    "- [ ] **Fase B pós-publicação (separada):** realizar smoke no GitHub real, mobile/teclado; registrar aceite ou rollback à parte",
    "",
    "O SHA identifica **os bytes propostos na revisão**. Não editar o registro como aprovado sem leitura e evidência humanas. Uma mudança no Markdown invalida a aprovação anterior.",
    "",
  ];
  for (const group of groups) {
    output.push("## " + group.title, "");
    for (const slug of group.pages) {
      const body = fs.readFileSync(path.join(root, "wiki", slug + ".md"));
      const content = body.toString("utf8");
      const sources = Array.from(new Set(Array.from(content.matchAll(/https:\/\/github\.com\/Faysk\/tda\/blob\/main\/(docs\/[A-Za-z0-9_.\/-]+\.md)/g), (m) => m[1]))).sort();
      const pageHash = hash(body);
      const status = reviews.pages[slug].status;
      const url = "https://github.com/Faysk/tda/blob/" + sourceSha + "/wiki/" + slug + ".md";
      output.push("### [" + slug + "](" + url + ")", "");
      output.push("- Estado registrado: **" + status + "**; SHA-256: " + backtick + pageHash + backtick);
      output.push("- Fontes canônicas declaradas: " + (sources.length ? sources.map(p => "[" + p + "](https://github.com/Faysk/tda/blob/" + sourceSha + "/" + p + ")").join(" · ") : "**sem link de fonte docs/**"));
      output.push("- [ ] Fonte, precisão, privacidade, linguagem e maturidade revisadas nesta versão");
      output.push("- [ ] Comentário ou issue de aprovação com reviewer e evidência de verificação");
      output.push("");
    }
  }
  output.push("## Fora do escopo deste pacote", "");
  output.push("O pacote não comprova autenticidade de um revisor, acesso ao Git remoto da Wiki, publicação, renderização Mermaid/SVG ou compatibilidade real com leitores de tela. Esses recibos são independentes no runbook #1761.", "");
  return { markdown: output.join("\n"), pages: checked.pages, groups: groups.length, pending: editorial.pending, approved: editorial.approved };
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--out");
  if (i < 0 || !args[i + 1] || !path.isAbsolute(args[i + 1])) fail("usage: --out /absolute/new-file.md");
  const dest = path.resolve(args[i + 1]);
  if (dest.startsWith(rootDefault + path.sep)) fail("output must be outside source checkout");
  const sourceSha = execFileSync("git", ["-C", rootDefault, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", rootDefault, "status", "--porcelain", "--", "wiki/", "tools/wiki/"], { encoding: "utf8" }).trim();
  if (dirty) fail("wiki content and review register have local changes");
  const result = buildWikiReviewPacket(rootDefault, sourceSha);
  fs.writeFileSync(dest, result.markdown, { flag: "wx" });
  console.log("WIKI_REVIEW_PACKET " + JSON.stringify({ sourceSha, file: dest, pages: result.pages, pending: result.pending, approved: result.approved, groups: result.groups }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
