import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  PublicReleaseSmokeError,
  runPublicReleaseSmoke,
} from "./public-release-smoke.mjs";

const SHA = "a".repeat(40);
const ORIGIN = "https://preview.example.test";
const SESSION_PATH =
  "/campanhas/cronicas-da-mesa/sessoes/11111111-1111-4111-8111-111111111111";

function response(route, body, finalRoute = route, status = 200) {
  return {
    status,
    finalUrl: ORIGIN + finalRoute,
    body,
  };
}

function healthyFixtures() {
  const archive =
    '<main><a href="' +
    SESSION_PATH +
    '">Abrir memória</a><p>Arquivo público de sessões</p></main>';
  return new Map([
    ["/", response("/", "<main>Arquivo vivo das sessões</main>")],
    [
      "/campanhas",
      response(
        "/campanhas",
        '<main data-campaign-registry="canonical"><a href="/campanhas/cronicas-da-mesa/sessoes">Abrir sessões</a></main>',
      ),
    ],
    ["/sessoes", response("/sessoes", archive, "/campanhas/sessoes")],
    ["/campanhas/sessoes", response("/campanhas/sessoes", archive)],
    [
      SESSION_PATH,
      response(
        SESSION_PATH,
        '<article data-session-reader-hero><div data-session-reading>Resumo público esperado.</div></article>',
      ),
    ],
  ]);
}

function requester(fixtures, seen = []) {
  return async ({ route }) => {
    seen.push(route);
    const value = fixtures.get(route);
    if (!value) throw new Error("missing fixture for " + route);
    return value;
  };
}

function assertSmokeError(error, code) {
  return (
    error instanceof PublicReleaseSmokeError &&
    error.code === code
  );
}

test("rejects HTTP 200 when public content is an unavailable state", async () => {
  const fixtures = healthyFixtures();
  fixtures.set(
    "/campanhas",
    response(
      "/campanhas",
      '<main data-campaign-registry="unavailable"><h2>Diretório temporariamente indisponível</h2></main>',
    ),
  );

  await assert.rejects(
    runPublicReleaseSmoke({
      baseUrl: ORIGIN,
      sourceSha: SHA,
      phase: "staged",
      requestImpl: requester(fixtures),
      logger: () => {},
    }),
    (error) => assertSmokeError(error, "unavailable_content"),
  );
});

test("allows an explicitly valid empty public archive without turning dependency failure into empty", async () => {
  const fixtures = healthyFixtures();
  fixtures.set(
    "/campanhas",
    response(
      "/campanhas",
      '<main data-campaign-registry="canonical"><h2>Nenhuma campanha pública ainda</h2></main>',
    ),
  );
  fixtures.set(
    "/sessoes",
    response(
      "/sessoes",
      "<main><p>Nenhuma sessão publicada ainda.</p></main>",
      "/campanhas/sessoes",
    ),
  );
  fixtures.set(
    "/campanhas/sessoes",
    response(
      "/campanhas/sessoes",
      "<main><p>Nenhuma sessão publicada ainda.</p></main>",
    ),
  );
  const seen = [];

  const result = await runPublicReleaseSmoke({
    baseUrl: ORIGIN,
    sourceSha: SHA,
    phase: "staged",
    requestImpl: requester(fixtures, seen),
    logger: () => {},
  });

  assert.equal(result.empty, true);
  assert.equal(result.sessionPath, null);
  assert.deepEqual(seen, ["/", "/campanhas", "/sessoes", "/campanhas/sessoes"]);

  fixtures.set(
    "/campanhas/sessoes",
    response(
      "/campanhas/sessoes",
      "<main><p>Não foi possível carregar as sessões. Tente novamente em instantes.</p></main>",
    ),
  );
  await assert.rejects(
    runPublicReleaseSmoke({
      baseUrl: ORIGIN,
      sourceSha: SHA,
      phase: "staged",
      requestImpl: requester(fixtures),
      logger: () => {},
    }),
    (error) => assertSmokeError(error, "unavailable_content"),
  );
});

test("follows the compatibility redirect and verifies its final canonical destination", async () => {
  const fixtures = healthyFixtures();
  const archive = fixtures.get("/campanhas/sessoes").body;
  fixtures.set("/sessoes", response("/sessoes", archive, "/sessoes"));

  await assert.rejects(
    runPublicReleaseSmoke({
      baseUrl: ORIGIN,
      sourceSha: SHA,
      phase: "staged",
      requestImpl: requester(fixtures),
      logger: () => {},
    }),
    (error) => assertSmokeError(error, "redirect_destination"),
  );
});

test("allows the proven legacy registry compatibility path without treating it as canonical readiness", async () => {
  const fixtures = healthyFixtures();
  fixtures.set(
    "/campanhas",
    response(
      "/campanhas",
      '<main data-campaign-registry="legacy"><a href="/campanhas/cronicas-da-mesa/sessoes">Crônicas da Mesa</a></main>',
    ),
  );
  const lines = [];

  const result = await runPublicReleaseSmoke({
    baseUrl: ORIGIN,
    sourceSha: SHA,
    phase: "staged",
    requestImpl: requester(fixtures),
    logger: (line) => lines.push(JSON.parse(line)),
  });

  assert.equal(result.registryMode, "legacy");
  const directoryResult = lines.find((entry) => entry.route === "/campanhas");
  assert.equal(directoryResult?.result, "pass");
  assert.equal(directoryResult?.state, "registry_legacy_compat");
});

test("rejects a missing or unknown campaign registry state before promotion", async () => {
  const fixtures = healthyFixtures();
  fixtures.set(
    "/campanhas",
    response(
      "/campanhas",
      '<main><a href="/campanhas/cronicas-da-mesa/sessoes">Crônicas da Mesa</a></main>',
    ),
  );

  await assert.rejects(
    runPublicReleaseSmoke({
      baseUrl: ORIGIN,
      sourceSha: SHA,
      phase: "staged",
      requestImpl: requester(fixtures),
      logger: () => {},
    }),
    (error) => assertSmokeError(error, "registry_incompatible"),
  );
});

test("happy path discovers a real public session link and verifies expected public reader content", async () => {
  const fixtures = healthyFixtures();
  const seen = [];
  const result = await runPublicReleaseSmoke({
    baseUrl: ORIGIN,
    sourceSha: SHA,
    phase: "canonical",
    requestImpl: requester(fixtures, seen),
    logger: () => {},
  });

  assert.equal(result.empty, false);
  assert.equal(result.sessionPath, SESSION_PATH);
  assert.equal(seen.at(-1), SESSION_PATH);
  assert.ok(seen.includes("/campanhas"));
  assert.ok(seen.includes("/campanhas/sessoes"));
});

test("logs only sanitized SHA, route, result and time metadata, never response bodies", async () => {
  const fixtures = healthyFixtures();
  fixtures.set(
    SESSION_PATH,
    response(
      SESSION_PATH,
      '<article data-session-reader-hero><div data-session-reading>PRIVATE TRANSCRIPT SENTINEL</div></article>',
    ),
  );
  const lines = [];

  await runPublicReleaseSmoke({
    baseUrl: ORIGIN,
    sourceSha: SHA,
    phase: "canonical",
    requestImpl: requester(fixtures),
    logger: (line) => lines.push(line),
    nowImpl: () => new Date("2026-10-01T20:00:00.000Z"),
  });

  assert.ok(lines.length >= 5);
  assert.equal(lines.join("\n").includes("PRIVATE TRANSCRIPT SENTINEL"), false);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.equal(parsed.sha, SHA);
    assert.equal(parsed.at, "2026-10-01T20:00:00.000Z");
    assert.equal(typeof parsed.route, "string");
    assert.match(parsed.result, /^(pass|fail)$/u);
    assert.equal("body" in parsed, false);
  }
});

test("workflow keeps semantic staged smoke before promote and records post-promote recovery", () => {
  const workflow = fs.readFileSync(".github/workflows/production-cd.yml", "utf8");
  const staged =
    workflow.indexOf('node tools/ci/public-release-smoke.mjs --base-url "$DEPLOYMENT_URL"');
  const promote = workflow.indexOf('id: promote');
  const canonical =
    workflow.indexOf('node tools/ci/public-release-smoke.mjs --base-url "$PRODUCTION_ORIGIN"');
  const recovery = workflow.indexOf("Record post-promotion recovery action");

  assert.ok(staged >= 0, "staged semantic smoke must be wired");
  assert.ok(promote > staged, "promote must happen only after staged semantic smoke");
  assert.ok(canonical > promote, "canonical semantic smoke must run after promote");
  assert.ok(recovery > canonical, "post-promote failure must register recovery guidance");
  assert.match(workflow, /steps\.promote\.outcome == 'success'/u);
});
