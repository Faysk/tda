import { expect, test } from "@playwright/test";

function htmlHead(html: string) {
	const match = html.match(/<head>([\s\S]*?)<\/head>/i);
	expect(match, "response must contain a server-rendered <head>").not.toBeNull();
	return match?.[1] ?? "";
}

function attribute(tag: string, name: string) {
	return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function metaContent(head: string, attributeName: "name" | "property", key: string) {
	const tag = (head.match(/<meta\b[^>]*>/gi) ?? []).find(
		(candidate) => attribute(candidate, attributeName) === key,
	);
	expect(tag, `missing meta ${attributeName}="${key}"`).toBeDefined();
	return attribute(tag ?? "", "content");
}

function canonicalHref(head: string) {
	const tag = (head.match(/<link\b[^>]*>/gi) ?? []).find(
		(candidate) => attribute(candidate, "rel") === "canonical",
	);
	expect(tag, "missing canonical link").toBeDefined();
	return attribute(tag ?? "", "href");
}

function hasMeta(head: string, attributeName: "name" | "property", key: string) {
	return (head.match(/<meta\b[^>]*>/gi) ?? []).some(
		(candidate) => attribute(candidate, attributeName) === key,
	);
}

const previewAgents = [
	{ name: "WhatsApp", value: "WhatsApp/2.24.7 A" },
	{ name: "Discord", value: "Discordbot/2.0" },
] as const;

for (const agent of previewAgents) {
	test(`Home metadata is in raw HTML for ${agent.name} crawler`, async ({ request }) => {
		const response = await request.get("/", {
			headers: { "user-agent": agent.value },
		});
		expect(response.status()).toBe(200);
		const head = htmlHead(await response.text());

		expect(new URL(canonicalHref(head)).href).toBe("https://dnd.faysk.dev/");
		expect(new URL(metaContent(head, "property", "og:url")).href).toBe(
			"https://dnd.faysk.dev/",
		);
		expect(metaContent(head, "property", "og:title")).toBe(
			"TDA — Tem Dado Aqui",
		);
		expect(metaContent(head, "property", "og:image")).toBe(
			"https://dnd.faysk.dev/og/default",
		);
		expect(metaContent(head, "property", "og:image:width")).toBe("1200");
		expect(metaContent(head, "property", "og:image:height")).toBe("630");
		expect(metaContent(head, "property", "og:image:type")).toBe("image/png");
		expect(metaContent(head, "name", "twitter:card")).toBe(
			"summary_large_image",
		);
	});
}

test("sessions index owns its preview instead of inheriting Home metadata", async ({
	request,
}) => {
	const response = await request.get("/sessoes", {
		headers: { "user-agent": "facebookexternalhit/1.1" },
	});
	expect(response.status()).toBe(200);
	const head = htmlHead(await response.text());

	expect(canonicalHref(head)).toBe("https://dnd.faysk.dev/sessoes");
	expect(metaContent(head, "property", "og:url")).toBe(
		"https://dnd.faysk.dev/sessoes",
	);
	expect(metaContent(head, "property", "og:title")).toBe("Sessões");
	expect(metaContent(head, "property", "og:description")).toContain(
		"Arquivo público",
	);
	expect(metaContent(head, "property", "og:image")).toBe(
		"https://dnd.faysk.dev/og/default",
	);
});

test("fallback social image is public without authentication", async ({ request }) => {
	const response = await request.get("/og/default", {
		headers: { "user-agent": "Discordbot/2.0" },
	});
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/png");
});

test("Edit does not inherit public share metadata", async ({ request }) => {
	const response = await request.get("/edit", {
		headers: { "user-agent": "WhatsApp/2.24.7 A" },
	});
	expect(response.status()).toBe(200);
	const head = htmlHead(await response.text());
	const robots = metaContent(head, "name", "robots");

	expect(robots).toContain("noindex");
	expect(robots).toContain("nofollow");
	expect(hasMeta(head, "property", "og:title")).toBe(false);
	expect(hasMeta(head, "property", "og:image")).toBe(false);
	expect(hasMeta(head, "name", "twitter:card")).toBe(false);
	expect(head).not.toMatch(/<link\b[^>]*rel="canonical"/i);
});

test("404 does not expose a public social preview", async ({ request }) => {
	const response = await request.get("/sessoes/nonexistent", {
		headers: { "user-agent": "Discordbot/2.0" },
	});
	expect(response.status()).toBe(404);
	const head = htmlHead(await response.text());

	expect(metaContent(head, "name", "robots")).toContain("noindex");
	expect(hasMeta(head, "property", "og:title")).toBe(false);
	expect(hasMeta(head, "property", "og:description")).toBe(false);
	expect(hasMeta(head, "property", "og:image")).toBe(false);
	expect(hasMeta(head, "name", "twitter:card")).toBe(false);
});
