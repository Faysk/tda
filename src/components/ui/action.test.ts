import { describe, expect, it } from "vitest";
import { actionStyles } from "./action";

describe("actionStyles", () => {
	it("uses the secondary medium defaults", () => {
		expect(actionStyles()).toBe(
			"ds-action ds-action--secondary ds-action--md",
		);
	});

	it("composes variant, size and caller classes", () => {
		expect(
			actionStyles({ variant: "primary", size: "sm", className: "extra" }),
		).toBe("ds-action ds-action--primary ds-action--sm extra");
	});
});
