import type { CSSProperties } from "react";
import { classNames } from "./class-names";
import styles from "./animated-progress.module.css";

type Props = Readonly<{
	value: number;
	max: number;
	ariaLabel: string;
	valueText?: string;
	className?: string;
}>;

export function AnimatedProgress({
	value,
	max,
	ariaLabel,
	valueText,
	className,
}: Props) {
	const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
	const safeValue = Math.min(
		safeMax,
		Math.max(0, Number.isFinite(value) ? value : 0),
	);
	const ratio = safeValue / safeMax;
	const style = {
		"--animated-progress": String(ratio),
	} as CSSProperties;

	return (
		<span
			className={classNames(styles.progress, className)}
			role="progressbar"
			aria-label={ariaLabel}
			aria-valuemin={0}
			aria-valuemax={safeMax}
			aria-valuenow={safeValue}
			aria-valuetext={valueText}
			data-animated-progress="true"
			data-progress-target={ratio}
		>
			<span className={styles.fill} style={style} aria-hidden="true" />
		</span>
	);
}
