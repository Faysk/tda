import { describe, expect, it } from "vitest";
import { demoLoreProfile } from "./fixtures/demo-profile";
import {
	findActiveLoreBeat,
	loreNarrationEndMs,
	validateLoreNarration,
} from "./timeline";

describe("lore narration timeline", () => {
	const narration = demoLoreProfile.narration;
	if (!narration) throw new Error("demo narration fixture missing");

	it("keeps editorial narration distinct from session audio", () => {
		expect(narration.kind).toBe("editorial-narration");
	});

	it("finds synchronized caption/scene beats after seek", () => {
		expect(findActiveLoreBeat(narration.beats, 1000)?.id).toBe("beat-intro");
		expect(findActiveLoreBeat(narration.beats, 6500)?.sceneId).toBe("turn");
		expect(findActiveLoreBeat(narration.beats, 8000)).toBeNull();
	});

	it("validates beat ranges and scene references", () => {
		expect(validateLoreNarration(narration, demoLoreProfile.presentation)).toEqual([]);
		expect(loreNarrationEndMs(narration)).toBe(8000);
	});
});
