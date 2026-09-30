import type { CSSProperties } from "react";
import { classNames } from "./class-names";
import styles from "./progress.module.css";

export type ProgressTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type ProgressProps = Readonly<{
	ariaLabel: string;
	tone?: ProgressTone;
	value?: number;
	max?: number;
	valueText?: string;
	className?: string;
	expectedSampleMs?: number;
	/**
	 * Compatibility metadata used by AnimatedProgress while Processing migrates
	 * to the shared progress contract.
	 */
	dataAnimatedProgress?: boolean;
	dataProgressLabel?: string;
	dataProgressTarget?: number;
	dataProgressSampleMs?: number;
}>;

export function Progress({
	ariaLabel,
	value,
	max = 100,
	valueText,
	className,
	expectedSampleMs,
	dataAnimatedProgress = false,
	dataProgressLabel,
	dataProgressTarget,
	dataProgressSampleMs,
	tone = "neutral",
}: ProgressProps) {
	const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
	const determinate = value !== undefined && Number.isFinite(value);
	const safeValue = determinate
		? Math.min(safeMax, Math.max(0, value ?? 0))
		: undefined;
	const ratio = safeValue === undefined ? undefined : safeValue / safeMax;
	const style = {
		"--ds-progress-ratio": ratio === undefined ? undefined : String(ratio),
		"--ds-progress-duration":
			expectedSampleMs !== undefined &&
			Number.isFinite(expectedSampleMs) &&
			expectedSampleMs > 0
				? `${Math.round(expectedSampleMs)}ms`
				: undefined,
	} as CSSProperties;

	return (
		<span
			className={classNames(
				styles.progress,
				styles[`tone-${tone}`],
				className,
			)}
			data-progress-mode={determinate ? "determinate" : "indeterminate"}
			data-progress-label={dataProgressLabel ?? ariaLabel}
			data-progress-target={dataProgressTarget ?? ratio}
			data-progress-sample-ms={dataProgressSampleMs ?? expectedSampleMs}
			data-animated-progress={dataAnimatedProgress ? "true" : undefined}
		>
			<progress
				className={styles.accessibleProgress}
				max={safeMax}
				value={safeValue}
				aria-label={ariaLabel}
				aria-valuetext={valueText}
			/>
			<span
				className={determinate ? styles.fill : styles.indeterminateFill}
				style={style}
				aria-hidden="true"
			/>
		</span>
	);
}
