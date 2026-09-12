"use client";

import { worldCommand } from "../world-commands";
import styles from "./world-command-palette.module.css";

export function WorldCommandPaletteTrigger({
	enabled,
	onOpen,
}: Readonly<{
	enabled: boolean;
	onOpen: () => void;
}>) {
	if (!enabled) return null;
	const command = worldCommand("world.openCommandPalette");
	return (
		<button
			className={styles.trigger}
			type="button"
			onClick={onOpen}
			aria-label={`${command.label}. Atalho Control ou Command K`}
		>
			<span aria-hidden="true">⌘</span>
			Comandos
			<kbd>⌘K</kbd>
		</button>
	);
}
