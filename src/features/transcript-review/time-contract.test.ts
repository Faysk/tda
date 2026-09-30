import { describe, expect, it } from "vitest";
import {
	crossedAbsoluteDate,
	parseTrustedAbsoluteTime,
	trustedAbsoluteIso,
	wallClockPresentation,
} from "./time-contract";

describe("trusted transcript wall-clock contract", () => {
	it("accepts only explicit timezone/offset ISO values", () => {
		expect(trustedAbsoluteIso("2026-09-12T22:34:23+01:00")).toBe(
			"2026-09-12T22:34:23+01:00",
		);
		expect(trustedAbsoluteIso("2026-09-12T21:34:23Z")).toBe(
			"2026-09-12T21:34:23Z",
		);
		expect(trustedAbsoluteIso("2026-09-12T22:34:23")).toBeNull();
		expect(trustedAbsoluteIso("22:34:23")).toBeNull();
	});

	it("fails closed when the authority state is unavailable or malformed", () => {
		expect(
			parseTrustedAbsoluteTime({
				state: "unavailable",
				start: "2026-09-12T22:34:23+01:00",
				end: "2026-09-12T22:34:24+01:00",
				source: "craig-a",
			}),
		).toBeNull();
		expect(
			parseTrustedAbsoluteTime({
				state: "trusted_absolute",
				start: "2026-09-12T22:34:24+01:00",
				end: "2026-09-12T22:34:23+01:00",
				source: "craig-a",
			}),
		).toBeNull();
	});

	it("preserves the source clock and offset instead of converting to browser time", () => {
		expect(wallClockPresentation("2026-09-12T22:34:23.125+01:00")).toEqual({
			clock: "22:34:23",
			offset: "+01:00",
			date: "2026-09-12",
			accessible: "2026-09-12 22:34:23 UTC+01:00",
		});
		expect(wallClockPresentation("2026-09-12T21:34:23Z")?.clock).toBe("21:34:23");
	});

	it("detects midnight rollover without treating it as elapsed regression", () => {
		expect(
			crossedAbsoluteDate(
				"2026-09-12T23:59:59+01:00",
				"2026-09-13T00:00:02+01:00",
			),
		).toBe(true);
	});
});
