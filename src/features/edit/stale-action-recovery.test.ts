import { describe, expect, it } from "vitest";
import {
	decodeStaleActionRecovery,
	encodeStaleActionRecovery,
	isStaleServerActionError,
} from "./stale-action-recovery";

describe("stale Server Action recovery", () => {
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
