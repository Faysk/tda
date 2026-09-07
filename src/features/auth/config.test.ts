import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfig, safeReturnPath } from "./config";

afterEach(() => vi.unstubAllEnvs());
describe("internal return path", () => {
	it.each([
		"https://evil.test",
		"//evil.test",
		"/\\evil.test",
		"/%5cevil.test",
		"/%252f%252fevil.test",
		"/%0d%0aLocation:evil",
		"/auth/logout",
		"/api/auth/me",
		"/entrar",
		"/x/../auth/callback",
		"%",
		null,
	])("rejects %s", (value) => expect(safeReturnPath(value)).toBe("/conta"));
	it("preserves a valid editor return with query", () =>
		expect(safeReturnPath("/edit/sessoes/sessao-1?batch=2")).toBe(
			"/edit/sessoes/sessao-1?batch=2",
		));
});
describe("trusted origin", () => {
	it.each([
		"https://tda.test/path",
		"http://tda.test",
		"https://user:pass@tda.test",
		"https://tda.test/",
	])("rejects %s", (origin) => {
		vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
		vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture");
		vi.stubEnv("TDA_AUTH_ORIGIN", origin);
		expect(authConfig()).toBeNull();
	});
});
