"use client";

import styles from "./components/world-authoring-inspector-mode.module.css";

export function syncWorldInspectorPresentation(docked: boolean) {
	if (typeof document === "undefined") return;
	document.body.classList.toggle(styles.docked, docked);
}
