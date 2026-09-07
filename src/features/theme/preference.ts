export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tda-theme";

export function parseThemePreference(value: unknown): ThemePreference {
	return value === "light" || value === "dark" ? value : "system";
}

export function oppositeTheme(value: ResolvedTheme): ResolvedTheme {
	return value === "dark" ? "light" : "dark";
}
