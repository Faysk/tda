export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "tda-theme";

export function parseThemePreference(value: unknown): ThemePreference {
	return value === "light" || value === "dark" ? value : "system";
}

export function nextThemePreference(value: ThemePreference): ThemePreference {
	if (value === "system") return "light";
	if (value === "light") return "dark";
	return "system";
}

export function themeLabel(
	preference: ThemePreference,
	effective: "light" | "dark",
) {
	const effectiveLabel = effective === "light" ? "claro" : "escuro";
	return preference === "system"
		? `Tema do sistema (${effectiveLabel}). Alterar tema`
		: `Tema ${effectiveLabel}. Alterar tema`;
}
