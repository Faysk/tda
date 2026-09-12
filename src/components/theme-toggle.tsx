"use client";

import { useCallback, useEffect, useState } from "react";
import {
	oppositeTheme,
	parseThemePreference,
	THEME_STORAGE_KEY,
	type ResolvedTheme,
	type ThemePreference,
} from "@/features/theme/preference";

const THEME_CHANGE_EVENT = "tda-theme-change";

function resolveTheme(preference: ThemePreference): ResolvedTheme {
	if (preference === "light" || preference === "dark") return preference;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function currentDocumentTheme(): ResolvedTheme {
	const explicit = document.documentElement.dataset.theme;
	if (explicit === "light" || explicit === "dark") return explicit;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(theme: ResolvedTheme) {
	const root = document.documentElement;
	root.dataset.theme = theme;
	root.style.colorScheme = theme;
}

function readStoredPreference(): ThemePreference {
	try {
		return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
	} catch {
		return "system";
	}
}

function syncDocumentToPreference(preference: ThemePreference): ResolvedTheme {
	if (preference === "system") {
		delete document.documentElement.dataset.theme;
		document.documentElement.style.colorScheme = "light dark";
		return resolveTheme(preference);
	}
	applyTheme(preference);
	return preference;
}

export function ThemeToggle() {
	const [effective, setEffective] = useState<ResolvedTheme>("dark");

	const syncFromPreference = useCallback(() => {
		setEffective(syncDocumentToPreference(readStoredPreference()));
	}, []);

	useEffect(() => {
		syncFromPreference();

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onSystemChange = () => {
			if (!document.documentElement.dataset.theme) {
				setEffective(media.matches ? "dark" : "light");
			}
		};
		const onThemeChange = () => setEffective(currentDocumentTheme());
		const onStorage = (event: StorageEvent) => {
			if (event.key === THEME_STORAGE_KEY || event.key === null) syncFromPreference();
		};

		media.addEventListener("change", onSystemChange);
		window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
		window.addEventListener("storage", onStorage);
		return () => {
			media.removeEventListener("change", onSystemChange);
			window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
			window.removeEventListener("storage", onStorage);
		};
	}, [syncFromPreference]);

	const changeTheme = () => {
		const next = oppositeTheme(currentDocumentTheme());
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch {
			// The explicit choice still applies for this page when storage is unavailable.
		}
		applyTheme(next);
		setEffective(next);
		window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
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
