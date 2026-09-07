"use client";

import { useEffect, useState } from "react";
import {
	oppositeTheme,
	parseThemePreference,
	THEME_STORAGE_KEY,
	type ResolvedTheme,
	type ThemePreference,
} from "@/features/theme/preference";

function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference === "light" || preference === "dark") return preference;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: ResolvedTheme) {
	const root = document.documentElement;
	root.dataset.theme = theme;
	root.style.colorScheme = theme;
}

export function ThemeToggle() {
	const [effective, setEffective] = useState<ResolvedTheme>("dark");

	useEffect(() => {
		let stored: string | null = null;
		try {
			stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			stored = null;
		}

		const preference = parseThemePreference(stored);
		if (preference === "system") {
			delete document.documentElement.dataset.theme;
			document.documentElement.style.colorScheme = "light dark";
		}
		setEffective(resolveTheme(preference));

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onSystemChange = () => {
			if (!document.documentElement.dataset.theme) {
				setEffective(media.matches ? "dark" : "light");
			}
		};
		media.addEventListener("change", onSystemChange);
		return () => media.removeEventListener("change", onSystemChange);
	}, []);

	const changeTheme = () => {
		const next = oppositeTheme(effective);
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// The explicit choice still applies for this page when storage is unavailable.
		}
		applyTheme(next);
		setEffective(next);
	};

	const isDark = effective === "dark";

	return (
		<button
			className="theme-toggle"
			type="button"
			role="switch"
			aria-checked={isDark}
			aria-label="Modo escuro"
			title={isDark ? "Usar tema claro" : "Usar tema escuro"}
			onClick={changeTheme}
		>
			<span className="theme-toggle-track" aria-hidden="true">
				<span className="theme-toggle-knob">
					<svg
						className="theme-toggle-glyph theme-toggle-glyph--sun"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="3.25" />
						<path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.28 5.28l1.42 1.42M17.3 17.3l1.42 1.42M18.72 5.28 17.3 6.7M6.7 17.3l-1.42 1.42" />
					</svg>
					<svg
						className="theme-toggle-glyph theme-toggle-glyph--moon"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path d="M20.1 14.7A8.25 8.25 0 0 1 9.3 3.9 8.5 8.5 0 1 0 20.1 14.7Z" />
					</svg>
				</span>
			</span>
		</button>
	);
}
