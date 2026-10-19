import { describe, expect, it } from "vitest";
import {
	decodeStaleActionRecovery,
	encodeStaleActionRecovery,
	isNextRedirectSignal,
	isStaleServerActionError,
} from "./stale-action-recovery";

describe("stale Server Action recovery", () => {
	it("keeps framework redirects out of failure recovery", () => {
		expect(
			isNextRedirectSignal({
				digest: "NEXT_REDIRECT;replace;/edit/campanhas?status=criada;307;",
			}),
		).toBe(true);
		expect(isNextRedirectSignal(new Error("Server Action was not found"))).toBe(false);
	});

	it("recognizes deployment-skew action lookup failures only", () => {
		expect(
			isStaleServerActionError(
				Object.assign(new Error("Server Action was not found"), {
					name: "UnrecognizedActionError",
				}),
			),
		).toBe(true);
		expect(
			isStaleServerActionError(
				new Error(
					'Failed to find Server Action "abc". This request might be from an older or newer deployment.',
				),
			),
		).toBe(true);
		expect(
			isStaleServerActionError(
				new Error("Network connection was lost after the request was sent"),
			),
		).toBe(false);
		expect(isStaleServerActionError(new Error("permission denied"))).toBe(false);
	});

	it("retains HQ page order, descriptions and text together in a stale-action payload", () => {
		const first = "22222222-2222-4222-8222-222222222222";
		const second = "33333333-3333-4333-8333-333333333333";
		const payload = {
			title: "Versão preservada",
			comicPages: [
				{ assetId: second, altText: "Portal aberto", caption: "Página 1" },
				{ assetId: first, altText: "O grupo regressa", caption: "" },
			],
		};
		const encoded = encodeStaleActionRecovery(payload, 1_800_000_000_000);
		const restored = decodeStaleActionRecovery<typeof payload>(
			encoded,
			1_800_000_000_500,
		);
		expect(restored).toEqual(payload);
		expect(restored?.comicPages.map((page) => page.assetId)).toEqual([second, first]);
		expect(encoded).not.toContain("transcript");
	});

	it("keeps recovery payloads bounded to the current browser session window", () => {
		const now = 1_800_000_000_000;
		const raw = encodeStaleActionRecovery(
			{ title: "Rascunho preservado" },
			now - 5_000,
		);
		expect(
			decodeStaleActionRecovery<{ title: string }>(raw, now),
		).toEqual({ title: "Rascunho preservado" });
		expect(
			decodeStaleActionRecovery(raw, now + 24 * 60 * 60 * 1000 + 1),
		).toBeNull();
		expect(decodeStaleActionRecovery("{broken", now)).toBeNull();
	});
});
