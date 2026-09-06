import { describe, expect, it } from "vitest";
import { legacyHashTarget } from "./legacy-route";

describe("legacy session routes", () => {
	it("maps reader and summary hashes to the public reboot story", () => {
		expect(legacyHashTarget("#/sessao/rmDsxh640RR4")).toBe(
			"/sessoes/rmDsxh640RR4",
		);
		expect(legacyHashTarget("#/sessao/rmDsxh640RR4/resumo")).toBe(
			"/sessoes/rmDsxh640RR4",
		);
	});

	it("preserves encoded source session ids safely", () => {
		expect(legacyHashTarget("#/sessao/a%20b/resumo")).toBe("/sessoes/a%20b");
	});

	it("cleans the old home hash", () => {
		expect(legacyHashTarget("#/")).toBe("/");
	});

	it("ignores unrelated or malformed hashes", () => {
		expect(legacyHashTarget("#section")).toBeNull();
		expect(legacyHashTarget("#/sessao/")).toBeNull();
		expect(legacyHashTarget("#/sessao/%E0%A4%A")).toBeNull();
	});
});
