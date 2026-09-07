import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	jar: new Map<string, string>(),
	getUser: vi.fn(),
	exchange: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn(),
	available: vi.fn(),
}));
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (name: string) =>
			mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined,
		getAll: () => [...mocks.jar].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string) => mocks.jar.set(name, value),
		delete: (name: string) => mocks.jar.delete(name),
	}),
}));
vi.mock("./provider", () => ({ discordAvailable: mocks.available }));
vi.mock("./server", () => ({
	serverAuthClient: async () => ({
		auth: {
			getUser: mocks.getUser,
			exchangeCodeForSession: mocks.exchange,
			signInWithOAuth: mocks.signIn,
			signOut: mocks.signOut,
		},
	}),
}));
import { finishDiscord, logout, startDiscord } from "./routes";

const origin = "https://tda.test";
const nonce = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.jar.clear();
	vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
	vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture");
	vi.stubEnv("TDA_AUTH_ORIGIN", origin);
	mocks.available.mockResolvedValue(true);
	mocks.exchange.mockResolvedValue({ error: null });
	mocks.signOut.mockResolvedValue({ error: null });
	mocks.getUser.mockResolvedValue({
		data: { user: { id: "verified", identities: [{ provider: "discord" }] } },
		error: null,
	});
	mocks.signIn.mockResolvedValue({
		data: {
			url: "https://project.supabase.co/auth/v1/authorize?provider=discord",
		},
		error: null,
	});
});
afterEach(() => vi.unstubAllEnvs());
function flow(next = "/edit") {
	mocks.jar.set("tda-discord-flow", JSON.stringify({ nonce, next }));
}
function callback(query = "code=synthetic") {
	return new Request(`${origin}/auth/callback?flow=${nonce}&${query}`);
}
describe("Discord OAuth boundary (synthetic)", () => {
	it.each([undefined, "null", "https://evil.test"])(
		"rejects login and logout Origin %s before contacting Auth",
		async (requestOrigin) => {
			for (const handler of [startDiscord, logout]) {
				const headers: Record<string, string> =
					requestOrigin === undefined ? {} : { origin: requestOrigin };
				expect(
					(await handler(new Request(origin, { method: "POST", headers })))
						.status,
				).toBe(403);
			}
			expect(mocks.signIn).not.toHaveBeenCalled();
			expect(mocks.signOut).not.toHaveBeenCalled();
		},
	);
	it("keeps no-referrer on callback, login redirect and logout redirect", async () => {
		const body = new FormData();
		body.set("next", "/conta");
		const start = await startDiscord(
			new Request(origin, { method: "POST", headers: { origin }, body }),
		);
		flow();
		const finish = await finishDiscord(callback());
		const end = await logout(
			new Request(origin, { method: "POST", headers: { origin } }),
		);
		for (const result of [start, finish, end])
			expect(result.headers.get("referrer-policy")).toBe("no-referrer");
	});
	it.each(["null", "[]", "42", "{}"])(
		"denies malformed flow cookie %s",
		async (value) => {
			mocks.jar.set("tda-discord-flow", value);
			expect(
				(await finishDiscord(callback())).headers.get("location"),
			).toContain("erro=sessao");
			expect(mocks.exchange).not.toHaveBeenCalled();
		},
	);
	it("removes newly written cookies if final identity verification fails", async () => {
		flow();
		mocks.jar.set("tda-discord-session", "synthetic");
		mocks.getUser.mockRejectedValueOnce(new Error("offline"));
		expect((await finishDiscord(callback())).headers.get("location")).toContain(
			"erro=callback",
		);
		expect(mocks.jar.has("tda-discord-session")).toBe(false);
	});
	it("starts only Discord after same-origin POST and stores validated return", async () => {
		const body = new FormData();
		body.set("next", "//evil.test");
		const result = await startDiscord(
			new Request(`${origin}/auth/discord`, {
				method: "POST",
				headers: { origin },
				body,
			}),
		);
		expect(result.status).toBe(303);
		expect(mocks.signIn).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "discord" }),
		);
		expect(JSON.parse(mocks.jar.get("tda-discord-flow") ?? "{}").next).toBe(
			"/conta",
		);
	});
	it("rejects cross-origin login and logout", async () => {
		for (const handler of [startDiscord, logout])
			expect(
				(
					await handler(
						new Request(origin, {
							method: "POST",
							headers: { origin: "https://evil.test" },
						}),
					)
				).status,
			).toBe(403);
		expect(mocks.signIn).not.toHaveBeenCalled();
		expect(mocks.signOut).not.toHaveBeenCalled();
	});
	it("rejects missing or replayed state before exchange", async () => {
		expect((await finishDiscord(callback())).headers.get("location")).toContain(
			"erro=sessao",
		);
		expect(mocks.exchange).not.toHaveBeenCalled();
		flow();
		await finishDiscord(callback());
		await finishDiscord(callback());
		expect(mocks.exchange).toHaveBeenCalledTimes(1);
	});
	it("handles cancellation without exchanging or reflecting provider error text", async () => {
		flow();
		const result = await finishDiscord(
			callback("error=access_denied&error_description=private"),
		);
		expect(result.headers.get("location")).toBe(
			`${origin}/entrar?erro=cancelado`,
		);
		expect(mocks.exchange).not.toHaveBeenCalled();
	});
	it("uses trusted origin and saved return, ignoring host and next parameters", async () => {
		flow("/edit/sessoes/test");
		const result = await finishDiscord(
			new Request(
				`https://evil.test/auth/callback?flow=${nonce}&code=fixture&next=//evil.test`,
				{ headers: { "x-forwarded-host": "evil.test" } },
			),
		);
		expect(result.headers.get("location")).toBe(`${origin}/edit/sessoes/test`);
		expect(result.headers.get("cache-control")).toContain("no-store");
	});
	it("denies expired code and missing verified user", async () => {
		flow();
		mocks.exchange.mockResolvedValueOnce({ error: {} });
		expect((await finishDiscord(callback())).headers.get("location")).toContain(
			"erro=callback",
		);
		flow();
		mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: {} });
		expect((await finishDiscord(callback())).headers.get("location")).toContain(
			"erro=callback",
		);
	});
	it("clears only TDA session on logout even when revocation fails", async () => {
		mocks.jar.set("tda-discord-session.0", "private");
		mocks.jar.set("theme", "dark");
		mocks.signOut.mockRejectedValueOnce(new Error("offline"));
		const result = await logout(
			new Request(origin, { method: "POST", headers: { origin } }),
		);
		expect(mocks.jar.has("tda-discord-session.0")).toBe(false);
		expect(mocks.jar.get("theme")).toBe("dark");
		expect(result.headers.get("location")).toContain("erro=saida");
	});
});
