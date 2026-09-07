import { describe, expect, it } from "vitest";
import { oppositeTheme, parseThemePreference } from "./preference";

describe("theme preferences", () => {
	it("accepts explicit themes and falls back to system", () => {
		expect(parseThemePreference("light")).toBe("light");
		expect(parseThemePreference("dark")).toBe("dark");
		expect(parseThemePreference("anything")).toBe("system");
		expect(parseThemePreference(null)).toBe("system");
	});

	it("toggles the resolved light and dark themes", () => {
		expect(oppositeTheme("light")).toBe("dark");
		expect(oppositeTheme("dark")).toBe("light");
	});
});
