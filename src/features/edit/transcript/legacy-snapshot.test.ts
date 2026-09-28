import { describe, expect, it } from "vitest";
import { legacyTranscriptSnapshotSha256 } from "./legacy-snapshot";

const segments = [
	{
		id: "l-1-legacy-a",
		sourceSegmentId: "legacy-a",
		trackNumber: 1,
		startMs: 1250,
		endMs: 2500,
		speaker: "Álya",
		text: "Coração 🌲",
	},
	{
		id: "l-2-legacy-b",
		sourceSegmentId: "legacy-b",
		trackNumber: 2,
		startMs: 1500,
		endMs: 3000,
		speaker: "Bob",
		text: "Linha dois",
	},
] as const;

describe("legacy transcript snapshot identity", () => {
	it("matches the versioned PostgreSQL fingerprint fixture", () => {
		expect(legacyTranscriptSnapshotSha256(segments)).toBe(
			"fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82",
		);
	});

	it("changes when visible transcript identity, timing or content changes", () => {
		const baseline = legacyTranscriptSnapshotSha256(segments);
		expect(
			legacyTranscriptSnapshotSha256([
				{ ...segments[0], speaker: "Outra" },
				segments[1],
			]),
		).not.toBe(baseline);
		expect(
			legacyTranscriptSnapshotSha256([
				{ ...segments[0], startMs: 1251 },
				segments[1],
			]),
		).not.toBe(baseline);
		expect(
			legacyTranscriptSnapshotSha256([
				{ ...segments[0], sourceSegmentId: "legacy-z" },
				segments[1],
			]),
		).not.toBe(baseline);
	});

	it("requires stable segment identity", () => {
		expect(() =>
			legacyTranscriptSnapshotSha256([
				{
					id: "legacy",
					trackNumber: 1,
					startMs: 0,
					endMs: 1,
					speaker: "Mesa",
					text: "Oi",
				},
			]),
		).toThrow(/identity/u);
	});
});
