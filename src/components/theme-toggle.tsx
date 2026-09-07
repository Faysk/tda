"use client";

import { useEffect, useId, useState } from "react";
import {
	parseThemePreference,
	THEME_STORAGE_KEY,
	type ThemePreference,
} from "@/features/theme/preference";

const THEME_OPTIONS: Array<{
	value: ThemePreference;
	label: string;
	title: string;
}> = [
	{
		value: "system",
		label: "Sistema",
		title: "Seguir o tema do sistema",
	},
	{
		value: "light",
		label: "Claro",
		title: "Usar tema claro",
	},
	{
		value: "dark",
		label: "Escuro",
		title: "Usar tema escuro",
	},
];

function applyThemePreference(preference: ThemePreference) {
	const root = document.documentElement;

	if (preference === "system") {
		delete root.dataset.theme;
		root.style.colorScheme = "light dark";
		return;
	}

	root.dataset.theme = preference;
	root.style.colorScheme = preference;
}

function ThemeGlyph({ preference }: { preference: ThemePreference }) {
	if (preference === "system") {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<rect x="3.5" y="4.5" width="17" height="12.5" rx="2" />
				<path d="M9 20h6M12 17v3" />
			</svg>
		);
	}

	if (preference === "light") {
		return (
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r="3.25" />
				<path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.28 5.28l1.42 1.42M17.3 17.3l1.42 1.42M18.72 5.28 17.3 6.7M6.7 17.3l-1.42 1.42" />
			</svg>
		);
	}

	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M20.1 14.7A8.25 8.25 0 0 1 9.3 3.9 8.5 8.5 0 1 0 20.1 14.7Z" />
		</svg>
	);
}

export function ThemeToggle() {
	const [preference, setPreference] = useState<ThemePreference>("system");
	const labelId = useId();

	useEffect(() => {
		let stored: string | null = null;
		try {
			stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			stored = null;
		}

		const nextPreference = parseThemePreference(stored);
		applyThemePreference(nextPreference);
		setPreference(nextPreference);
	}, []);

	const changeTheme = (nextPreference: ThemePreference) => {
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
		} catch {
			// The explicit choice still applies for this page when storage is unavailable.
		}

		applyThemePreference(nextPreference);
		setPreference(nextPreference);
	};

	return (
		<div className="theme-control">
			<span className="theme-control-label" id={labelId}>
				Aparência
			</span>
			<div
				className="theme-selector"
				role="radiogroup"
				aria-labelledby={labelId}
			>
				<span
					className={`theme-selector-indicator theme-selector-indicator--${preference}`}
					aria-hidden="true"
				/>
				{THEME_OPTIONS.map((option) => (
					<label
						className="theme-selector-option"
						key={option.value}
						title={option.title}
					>
						<input
							className="theme-selector-input"
							type="radio"
							name="tda-theme-preference"
							value={option.value}
							checked={preference === option.value}
							onChange={() => changeTheme(option.value)}
						/>
						<span className="theme-selector-option-surface">
							<span className="theme-selector-glyph" aria-hidden="true">
								<ThemeGlyph preference={option.value} />
							</span>
							<span className="theme-selector-option-label">{option.label}</span>
						</span>
					</label>
				))}
			</div>
		</div>
	);
}
