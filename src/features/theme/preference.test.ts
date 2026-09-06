import { describe, expect, it } from "vitest";
import {
	nextThemePreference,
	parseThemePreference,
	themeLabel,
} from "./preference";

describe("theme preferences", () => {
	it("accepts explicit themes and falls back to system", () => {
		expect(parseThemePreference("light")).toBe("light");
		expect(parseThemePreference("dark")).toBe("dark");
		expect(parseThemePreference("anything")).toBe("system");
		expect(parseThemePreference(null)).toBe("system");
	});

	it("cycles system, light, dark, system", () => {
		expect(nextThemePreference("system")).toBe("light");
		expect(nextThemePreference("light")).toBe("dark");
		expect(nextThemePreference("dark")).toBe("system");
	});

	it("describes system and explicit themes accessibly", () => {
		expect(themeLabel("system", "dark")).toContain("sistema (escuro)");
		expect(themeLabel("light", "light")).toContain("Tema claro");
		expect(themeLabel("dark", "dark")).toContain("Tema escuro");
	});
});
