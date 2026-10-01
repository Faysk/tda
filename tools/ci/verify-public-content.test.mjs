import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicContent, verifyPublicContent } from "./verify-public-content.mjs";

test("HTTP 200 unavailable pages and old unverified HTML fail release smoke", () => {
	for (const html of ['<main data-public-content-state="unavailable">Indisponível</main>', '<main>Não conseguimos abrir a última memória agora.</main>'])
		assert.throws(() => assertPublicContent(html, "/"), /unavailable or unverified/u);
});
test("healthy empty is distinct from dependency failure", () => {
	assert.equal(assertPublicContent('<main data-public-content-state="empty"></main>', "/"), "empty");
});
test("follows canonical archives and checks a published detail", async () => {
	const visited = [];
	const receipt = await verifyPublicContent(async (path) => {
		visited.push(path);
		return {status:200, url:`https://example.test${path === "/sessoes" ? "/campanhas/sessoes" : path}`,
			html:'<main data-public-content-state="ready"><a href="/campanhas/a/sessoes/shared">Session</a></main>'};
	});
	assert.equal(receipt.ok, true);
	assert.equal(visited.at(-1), "/campanhas/a/sessoes/shared");
});
test("a dead session link cannot pass a healthy archive", async () => {
	await assert.rejects(verifyPublicContent(async (path) => ({status:path.endsWith("/shared") ? 404 : 200,
		url:`https://example.test${path === "/sessoes" ? "/campanhas/sessoes" : path}`,
		html:'<main data-public-content-state="ready"><a href="/campanhas/a/sessoes/shared">Session</a></main>'})), /does not render/u);
});
