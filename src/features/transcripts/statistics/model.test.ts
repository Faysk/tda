import { describe, expect, it } from "vitest";
import { transcriptCoverageState } from "./model";

describe("transcript coverage state", () => {
	it("treats an empty inventory as empty instead of complete", () => {
		expect(
			transcriptCoverageState({
				sessions: 0,
				wordCoverage: 0,
				durationCoverage: 0,
			}),
		).toBe("empty");
	});

	it("reports incomplete when any metric is missing", () => {
		expect(
			transcriptCoverageState({
				sessions: 3,
				wordCoverage: 3,
				durationCoverage: 2,
			}),
		).toBe("incomplete");
	});

	it("reports complete only when a non-empty inventory is fully covered", () => {
		expect(
			transcriptCoverageState({
				sessions: 3,
				wordCoverage: 3,
				durationCoverage: 3,
			}),
		).toBe("complete");
	});
});
