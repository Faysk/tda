import type { ReactNode } from "react";
import styles from "./world-edge-tab.module.css";

type WorldEdgeTabProps = Readonly<{
	edge: "top" | "left" | "right";
	expanded: boolean;
	controls: string;
	label: string;
	onToggle: () => void;
	icon: ReactNode;
	className?: string;
	tabIndex?: number;
}>;

export function WorldEdgeTab({
	edge,
	expanded,
	controls,
	label,
	onToggle,
	icon,
	className,
	tabIndex,
}: WorldEdgeTabProps) {
	return (
		<button
			type="button"
			className={`${styles.tab} ${styles[edge]}${className ? ` ${className}` : ""}`}
			data-world-edge-tab
			data-edge={edge}
			data-expanded={expanded ? "true" : "false"}
			onClick={onToggle}
			aria-controls={controls}
			aria-expanded={expanded}
			aria-label={label}
			title={label}
			tabIndex={tabIndex}
		>
			<span className={styles.icon} aria-hidden="true">
				{icon}
			</span>
		</button>
	);
}
