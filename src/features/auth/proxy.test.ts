import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("./client", () => ({
	authClient: (jar: { setAll: (values: unknown[]) => void }) => ({
		auth: {
			getUser: async () => {
				jar.setAll([
					{
						name: "tda-discord-session.0",
						value: "synthetic-refreshed",
						options: {
							httpOnly: true,
							secure: true,
							sameSite: "lax",
							path: "/",
						},
					},
				]);
				return { data: { user: { id: "synthetic" } } };
			},
		},
	}),
}));
import { isStagedProductionMutation, proxy } from "../../proxy";
describe("session refresh transport", () => {
	it.each(["/entrar", "/entrar?next=/edit", "/conta", "/conta?acesso=negado"])(
		"preserves form origin on %s",
		async (path) => {
			const result = await proxy(new NextRequest(`https://tda.test${path}`));
			expect(result.headers.get("referrer-policy")).toBe("same-origin");
			expect(result.headers.get("cache-control")).toBe("private, no-store");
		},
	);
	it.each(["/api/auth/me", "/edit"])(
		"keeps sensitive non-form responses private on %s",
		async (path) => {
			expect(
				(await proxy(new NextRequest(`https://tda.test${path}`))).headers.get(
					"referrer-policy",
				),
			).toBe("no-referrer");
		},
	);
	it("propagates refreshed cookies to render request and browser without caching", async () => {
		const request = new NextRequest("https://tda.test/edit");
		const result = await proxy(request);
		expect(request.cookies.get("tda-discord-session.0")?.value).toBe(
			"synthetic-refreshed",
		);
		expect(result.cookies.get("tda-discord-session.0")?.httpOnly).toBe(true);
		expect(result.cookies.get("tda-discord-session.0")?.secure).toBe(true);
		expect(result.headers.get("cache-control")).toBe("private, no-store");
		expect(result.headers.get("x-middleware-request-cookie")).toContain(
			"synthetic-refreshed",
		);
	});
});

describe("Production parity staging is read-only against live providers", () => {
	it.each(["POST", "PUT", "PATCH", "DELETE"])(
		"rejects %s on a staged Vercel URL before it can write",
		async (method) => {
			vi.stubEnv("VERCEL_ENV", "production");
			vi.stubEnv("APP_ENV", "production");
			try {
				const request = new NextRequest("https://tda-staged.vercel.app/api/world/entity-media/upload", {
					method,
					headers: { host: "tda-staged.vercel.app" },
				});
				expect(isStagedProductionMutation(request)).toBe(true);
				const response = await proxy(request);
				expect(response.status).toBe(403);
				expect(await response.json()).toEqual({ error: "staged_production_read_only" });
				expect(response.headers.get("cache-control")).toBe("no-store");
			} finally {
				vi.unstubAllEnvs();
			}
		},
	);
	it("allows staging GET against live public content", async () => {
		vi.stubEnv("VERCEL_ENV", "production");
		vi.stubEnv("APP_ENV", "production");
		try {
			const request = new NextRequest("https://tda-staged.vercel.app/sessoes", {
				headers: { host: "tda-staged.vercel.app" },
			});
			expect(isStagedProductionMutation(request)).toBe(false);
			expect((await proxy(request)).status).toBe(200);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("preserves mutation access exclusively for the canonical Production hostname", () => {
		vi.stubEnv("VERCEL_ENV", "production");
		vi.stubEnv("APP_ENV", "production");
		try {
			const canonical = new NextRequest("https://dnd.faysk.dev/api/world/entity-media/upload", {
				method: "POST",
				headers: { host: "dnd.faysk.dev" },
			});
			expect(isStagedProductionMutation(canonical)).toBe(false);
			const spoofed = new NextRequest("https://tda-staged.vercel.app/api/world/entity-media/upload", {
				method: "POST",
				headers: { host: "dnd.faysk.dev" },
			});
			expect(isStagedProductionMutation(spoofed)).toBe(true);
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("PR Preview has no Production write key and is outside the staged guard", () => {
		vi.stubEnv("VERCEL_ENV", "preview");
		vi.stubEnv("APP_ENV", "preview");
		try {
			const request = new NextRequest("https://tda-pr.vercel.app/edit", { method: "POST" });
			expect(isStagedProductionMutation(request)).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
