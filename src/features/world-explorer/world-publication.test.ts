import { describe, expect, it } from "vitest";
import { worldPublicationVersionLabel } from "./world-publication";

describe("World publication identity", () => {
	it("formats graph and layout revisions into a stable compact receipt", () => {
		expect(
			worldPublicationVersionLabel({
				graphRevision: 8,
				layoutRevision: 9,
			}),
		).toBe("v008·009");
	});
});
