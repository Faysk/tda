import { describe, expect, it } from "vitest";
import { demoLoreProfile } from "./fixtures/demo-profile";
import {
	findActiveLoreBeat,
	loreNarrationEndMs,
	loreNarrationWebVtt,
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

	it("exports native captions with exact cue timing and escaped editorial text", () => {
		expect(loreNarrationWebVtt({ ...narration, beats: [{
			id: "caption", startMs: 3661123, endMs: 3662456,
			subtitle: "<A> & B\n\nNext line",
		}] })).toBe("WEBVTT\n\n01:01:01.123 --> 01:01:02.456\n&lt;A&gt; &amp; B\nNext line\n\n");
	});
});
