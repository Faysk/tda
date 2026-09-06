"use client";

import { useEffect, useState } from "react";
import {
	nextThemePreference,
	parseThemePreference,
	THEME_STORAGE_KEY,
	themeLabel,
	type ThemePreference,
} from "@/features/theme/preference";

function effectiveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference === "light" || preference === "dark") return preference;
	return window.matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

function applyPreference(preference: ThemePreference) {
	const root = document.documentElement;
	if (preference === "system") delete root.dataset.theme;
	else root.dataset.theme = preference;
	root.style.colorScheme = preference === "system" ? "light dark" : preference;
}

export function ThemeToggle() {
	const [preference, setPreference] = useState<ThemePreference>("system");
	const [effective, setEffective] = useState<"light" | "dark">("dark");

	useEffect(() => {
		let stored: string | null = null;
		try {
			stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			stored = null;
		}
		const initial = parseThemePreference(stored);
		setPreference(initial);
		applyPreference(initial);
		setEffective(effectiveTheme(initial));

		const media = window.matchMedia("(prefers-color-scheme: light)");
		const onSystemChange = () => {
			if (!document.documentElement.dataset.theme) {
				setEffective(media.matches ? "light" : "dark");
			}
		};
		media.addEventListener("change", onSystemChange);
		return () => media.removeEventListener("change", onSystemChange);
	}, []);

	const changeTheme = () => {
		const next = nextThemePreference(preference);
		try {
			if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
			else window.localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// The theme still applies for this page when storage is unavailable.
		}
		applyPreference(next);
		setPreference(next);
		setEffective(effectiveTheme(next));
	};

	return (
		<button
			className="theme-toggle"
			type="button"
			onClick={changeTheme}
			aria-label={themeLabel(preference, effective)}
			title={themeLabel(preference, effective)}
		>
			<span className="theme-toggle-icon" aria-hidden="true">
				{effective === "light" ? "☀" : "☾"}
			</span>
			<span className="theme-toggle-label">
				{preference === "system"
					? "sistema"
					: preference === "light"
						? "claro"
						: "escuro"}
			</span>
		</button>
	);
}
