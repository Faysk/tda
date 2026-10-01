import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
	createVercelRequester,
	extractCampaignArchivePath,
	extractPublicSessionPath,
	resolveCliTarget,
	verifyProductionPublicContent,
} from "./verify-production-public-content.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ORIGIN = "https://example.test";

function page(state: "ready" | "empty" | "dependency_unavailable", body = "") {
	return `<main data-public-content-state="${state}">${body}</main>`;
}

function href(path: string) {
	return `<a href="${path}">open</a>`;
}

function requester(overrides: Record<string, { status?: number; url?: string; body: string }> = {}) {
	const defaults: Record<string, { status: number; url: string; body: string }> = {
		"/": {
			status: 200,
			url: `${ORIGIN}/`,
			body: page("ready", href("/campanhas/mesa/sessoes/sessao-1")),
		},
		"/campanhas": {
			status: 200,
			url: `${ORIGIN}/campanhas`,
			body: page("ready", href("/campanhas/mesa/sessoes")),
		},
		"/campanhas/mesa/sessoes": {
			status: 200,
			url: `${ORIGIN}/campanhas/mesa/sessoes`,
			body: page("ready", href("/campanhas/mesa/sessoes/sessao-1")),
		},
		"/sessoes": {
			status: 200,
			url: `${ORIGIN}/campanhas/sessoes`,
			body: page("ready", href("/campanhas/mesa/sessoes/sessao-1")),
		},
		"/campanhas/mesa/sessoes/sessao-1": {
			status: 200,
			url: `${ORIGIN}/campanhas/mesa/sessoes/sessao-1`,
			body: page("ready", "<article>public summary only</article>"),
		},
	};
	const table = { ...defaults, ...overrides };
	return async (route: string) => {
		const result = table[route];
		if (!result) throw new Error(`Unexpected route ${route}`);
		return {
			status: result.status ?? 200,
			url: result.url ?? `${ORIGIN}${route}`,
			body: result.body,
		};
	};
}

describe("production public-content semantic smoke", () => {
	test("staged CLI target ignores global PRODUCTION_ORIGIN unless --origin is explicit", () => {
		expect(
			resolveCliTarget(
				{ deployment: "https://stage.example.test" },
				{ ...process.env, PRODUCTION_ORIGIN: "https://canonical.example.test" },
			),
		).toEqual({ kind: "staged", value: "https://stage.example.test" });
	});

	test("staged transport follows redirects and returns only final response metadata", async () => {
		let capturedArgs: string[] = [];
		const requestPage = createVercelRequester("https://stage.example.test", {
			runCommand: async (args: string[]) => {
				capturedArgs = args;
				return {
					stdout:
						page("empty") +
						"\n__TDA_PUBLIC_SMOKE_META__200\thttps://stage.example.test/campanhas/sessoes",
					stderr: "",
				};
			},
		});
		const response = await requestPage("/sessoes");
		expect(capturedArgs).toContain("--location");
		expect(response.status).toBe(200);
		expect(response.url).toBe("https://stage.example.test/campanhas/sessoes");
		expect(response.body).toBe(page("empty"));
	});

	test("rejects HTTP 200 that renders dependency_unavailable", async () => {
		const records: Array<Record<string, unknown>> = [];
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/campanhas": {
						body: page("dependency_unavailable", "temporarily unavailable"),
					},
				}),
				onResult: (record) => records.push(record),
			}),
		).rejects.toThrow("dependency_unavailable");
		expect(records.at(-1)).toMatchObject({
			sha: SHA,
			route: "/campanhas",
			finalPath: "/campanhas",
			status: 200,
			result: "FAIL",
		});
		expect(JSON.stringify(records)).not.toContain("temporarily unavailable");
	});

	test("accepts a legitimate fully empty public archive", async () => {
		const emptyRequester = requester({
			"/": { body: page("empty") },
			"/campanhas": { body: page("empty") },
			"/sessoes": {
				url: `${ORIGIN}/campanhas/sessoes`,
				body: page("empty"),
			},
		});
		const records = await verifyProductionPublicContent({
			sourceSha: SHA,
			expectedOrigin: ORIGIN,
			requestPage: emptyRequester,
			onResult: () => {},
		});
		expect(records.map((record) => record.result)).toEqual(["empty", "empty", "empty"]);
	});

	test("does not turn an HTTP error into a valid empty state", async () => {
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/": { status: 503, body: page("empty") },
				}),
				onResult: () => {},
			}),
		).rejects.toThrow("HTTP 503");
	});

	test("rejects an unresolved final redirect even when the body looks ready", async () => {
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/": { status: 302, body: page("ready") },
				}),
				onResult: () => {},
			}),
		).rejects.toThrow("HTTP 302");
	});

	test("requires the legacy sessions redirect to reach the final aggregate route", async () => {
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/sessoes": {
						url: `${ORIGIN}/sessoes`,
						body: page("ready", href("/campanhas/mesa/sessoes/sessao-1")),
					},
				}),
				onResult: () => {},
			}),
		).rejects.toThrow("expected /campanhas/sessoes");
	});

	test("rejects a redirect that escapes the staged or canonical origin", async () => {
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/sessoes": {
						url: "https://other.example/campanhas/sessoes",
						body: page("ready", href("/campanhas/mesa/sessoes/sessao-1")),
					},
				}),
				onResult: () => {},
			}),
		).rejects.toThrow("escaped expected origin");
	});

	test("follows published links through campaign archive and one public session detail", async () => {
		const calls: string[] = [];
		const requestPage = requester();
		const records = await verifyProductionPublicContent({
			sourceSha: SHA,
			expectedOrigin: ORIGIN,
			requestPage: async (route: string) => {
				calls.push(route);
				return requestPage(route);
			},
			onResult: () => {},
		});
		expect(calls).toContain("/campanhas/mesa/sessoes");
		expect(calls).toContain("/campanhas/mesa/sessoes/sessao-1");
		expect(records.at(-1)?.result).toBe("ready");
	});

	test("rejects inconsistent registry empty state when published sessions exist", async () => {
		await expect(
			verifyProductionPublicContent({
				sourceSha: SHA,
				expectedOrigin: ORIGIN,
				requestPage: requester({
					"/campanhas": { body: page("empty") },
				}),
				onResult: () => {},
			}),
		).rejects.toThrow("empty while the public session archive contains");
	});

	test("never includes page bodies in sanitized smoke output", async () => {
		const logs: string[] = [];
		const secretLikeText = "PRIVATE_TRANSCRIPT_SHOULD_NOT_LEAK";
		await verifyProductionPublicContent({
			sourceSha: SHA,
			expectedOrigin: ORIGIN,
			requestPage: requester({
				"/campanhas/mesa/sessoes/sessao-1": {
					body: page("ready", secretLikeText),
				},
			}),
			onResult: (record) => logs.push(JSON.stringify(record)),
		});
		expect(logs.join("\n")).not.toContain(secretLikeText);
	});

	test("extracts only campaign-qualified public links", () => {
		const html =
			href("/campanhas/mesa/sessoes") +
			href("/edit/mesa/sessoes/secret") +
			href("/campanhas/mesa/sessoes/sessao-1");
		expect(extractCampaignArchivePath(html)).toBe("/campanhas/mesa/sessoes");
		expect(extractPublicSessionPath(html)).toBe(
			"/campanhas/mesa/sessoes/sessao-1",
		);
	});

	test("workflow keeps staged semantic smoke before promote and records post-promote recovery", () => {
		const workflow = readFileSync(
			new URL("../../.github/workflows/production-cd.yml", import.meta.url),
			"utf8",
		);
		const staged = workflow.indexOf(
			'node tools/ci/verify-production-public-content.mjs --deployment "$DEPLOYMENT_URL" --sha "$SOURCE_SHA"',
		);
		const promote = workflow.indexOf("- name: Promote the tested artifact");
		const canonical = workflow.indexOf(
			'node tools/ci/verify-production-public-content.mjs --origin "$PRODUCTION_ORIGIN" --sha "$SOURCE_SHA"',
		);
		expect(staged).toBeGreaterThan(-1);
		expect(promote).toBeGreaterThan(staged);
		expect(canonical).toBeGreaterThan(promote);
		expect(workflow).toContain("Recovery required after canonical semantic smoke failure");
		expect(workflow).toContain("docs/operations/release-runbook.md");
	});
});
