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
import { proxy } from "../../proxy";
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
