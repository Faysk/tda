import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { verifyPublicContent } from "./verify-public-content.mjs";

type PublicState = "available" | "empty" | "unavailable";
type FakeResponse = Readonly<{ status: number; finalUrl: string; body: string }>;

const marker = (state: PublicState, extra = "") =>
	`<main data-public-content-state="${state}">${extra}</main>`;

function requester(overrides: Record<string, FakeResponse> = {}) {
	const base: Record<string, FakeResponse> = {
		"/": { status: 200, finalUrl: "https://example.test/", body: marker("empty") },
		"/campanhas": {
			status: 200,
			finalUrl: "https://example.test/campanhas",
			body: marker("empty"),
		},
		"/campanhas/sessoes": {
			status: 200,
			finalUrl: "https://example.test/campanhas/sessoes",
			body: marker("empty"),
		},
		"/sessoes": {
			status: 200,
			finalUrl: "https://example.test/campanhas/sessoes",
			body: marker("empty"),
		},
		...overrides,
	};
	return async (route: string) => {
		const response = base[route];
		if (!response) throw new Error(`Unexpected route ${route}`);
		return response;
	};
}

type VerifyOptions = Readonly<{
	sourceSha: string;
	request: (route: string) => Promise<FakeResponse>;
	now?: () => string;
	log?: (line: string) => void;
}>;

function verify(options: VerifyOptions) {
	return verifyPublicContent({
		expectedOrigin: "https://example.test",
		...options,
	});
}

describe("verifyPublicContent", () => {
	test("rejects HTTP 200 when the public page renders dependency-unavailable content", async () => {
		const logs: string[] = [];
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/campanhas": {
						status: 200,
						finalUrl: "https://example.test/campanhas",
						body: marker("unavailable"),
					},
				}),
				now: () => "2026-10-01T00:00:00.000Z",
				log: (line: string) => logs.push(line),
			}),
		).rejects.toThrow("rendered dependency-unavailable content");
		expect(logs).toContain(
			"PUBLIC_CONTENT_SMOKE sha=sha route=/campanhas result=FAIL at=2026-10-01T00:00:00.000Z",
		);
	});

	test("accepts an explicitly empty public archive", async () => {
		const result = await verify({
			sourceSha: "sha",
			request: requester(),
			now: () => "2026-10-01T00:00:00.000Z",
			log: () => {},
		});
		expect(result.ok).toBe(true);
		expect(result.checks).toHaveLength(4);
		expect(result.checks.every((check) => check.state === "empty")).toBe(true);
	});

	test("does not reinterpret an HTTP failure as a valid empty archive", async () => {
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/campanhas/sessoes": {
						status: 503,
						finalUrl: "https://example.test/campanhas/sessoes",
						body: marker("empty"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("returned HTTP 503");
	});

	test("requires compatibility redirects to land on the canonical archive", async () => {
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/sessoes": {
						status: 200,
						finalUrl: "https://example.test/algum-lugar",
						body: marker("empty"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("unexpected destination");
	});

	test("rejects a redirect that escapes the verified public origin", async () => {
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/sessoes": {
						status: 200,
						finalUrl: "https://unexpected.test/campanhas/sessoes",
						body: marker("empty"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("unexpected origin");
	});

	test("fails when an available archive exposes no public session link", async () => {
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/campanhas/sessoes": {
						status: 200,
						finalUrl: "https://example.test/campanhas/sessoes",
						body: marker("available"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("exposes no public session link");
	});

	test("verifies a published session discovered from the public archive", async () => {
		const sessionPath = "/campanhas/cronicas-da-mesa/sessoes/sessao_42";
		const result = await verify({
			sourceSha: "sha",
			request: requester({
				"/": {
					status: 200,
					finalUrl: "https://example.test/",
					body: marker("available"),
				},
				"/campanhas": {
					status: 200,
					finalUrl: "https://example.test/campanhas",
					body: marker("available"),
				},
				"/campanhas/sessoes": {
					status: 200,
					finalUrl: "https://example.test/campanhas/sessoes",
					body: marker("available", `<a href="${sessionPath}">Abrir</a>`),
				},
				"/sessoes": {
					status: 200,
					finalUrl: "https://example.test/campanhas/sessoes",
					body: marker("available"),
				},
				[sessionPath]: {
					status: 200,
					finalUrl: `https://example.test${sessionPath}`,
					body: marker("available", "<div data-session-reading></div>"),
				},
			}),
			log: () => {},
		});

		expect(result.checks.at(-1)).toMatchObject({
			route: sessionPath,
			state: "available",
			status: 200,
		});
	});

	test("rejects an available session shell without the expected reader content", async () => {
		const sessionPath = "/campanhas/cronicas-da-mesa/sessoes/sessao-42";
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/campanhas/sessoes": {
						status: 200,
						finalUrl: "https://example.test/campanhas/sessoes",
						body: marker("available", `<a href="${sessionPath}">Abrir</a>`),
					},
					[sessionPath]: {
						status: 200,
						finalUrl: `https://example.test${sessionPath}`,
						body: marker("available"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("missing the expected session-reading content marker");
	});

	test("fails closed when a discovered public session renders unavailable content", async () => {
		const sessionPath = "/campanhas/cronicas-da-mesa/sessoes/sessao-42";
		await expect(
			verify({
				sourceSha: "sha",
				request: requester({
					"/campanhas/sessoes": {
						status: 200,
						finalUrl: "https://example.test/campanhas/sessoes",
						body: marker("available", `<a href="${sessionPath}">Abrir</a>`),
					},
					[sessionPath]: {
						status: 200,
						finalUrl: `https://example.test${sessionPath}`,
						body: marker("unavailable"),
					},
				}),
				log: () => {},
			}),
		).rejects.toThrow("did not render available content");
	});

	test("Production CD runs semantic smoke before and after promotion with recovery evidence", () => {
		const workflow = readFileSync(".github/workflows/production-cd.yml", "utf8");
		const staged = workflow.indexOf("Verify staged public content semantics");
		const promote = workflow.indexOf("Promote the tested artifact");
		const canonical = workflow.indexOf("Verify canonical public content after promotion");
		const recovery = workflow.indexOf("Record public-content recovery action");

		expect(staged).toBeGreaterThan(-1);
		expect(promote).toBeGreaterThan(staged);
		expect(canonical).toBeGreaterThan(promote);
		expect(recovery).toBeGreaterThan(canonical);
		expect(workflow).toContain("PUBLIC_CONTENT_TRANSPORT: vercel");
		expect(workflow).toContain("steps.promote.outcome == 'success'");
		expect(workflow).toContain("steps.canonical_public_content.outcome == 'failure'");
	});

});
