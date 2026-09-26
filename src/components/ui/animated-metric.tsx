"use client";

import {
	type CSSProperties,
	useEffect,
	useRef,
	useState,
} from "react";
import { classNames } from "./class-names";
import {
	animatedNumberDuration,
	clampNumber,
	interpolateNumber,
	shouldAnimateNumber,
} from "./animated-number";
import styles from "./animated-metric.module.css";

type Props = Readonly<{
	value: number;
	min: number;
	max: number;
	format: (value: number) => string;
	ariaValueText?: (value: number) => string;
	ariaLabel: string;
	className?: string;
	minWidthCh?: number;
}>;

export function AnimatedMetric({
	value,
	min,
	max,
	format,
	ariaValueText,
	ariaLabel,
	className,
	minWidthCh,
}: Props) {
	const target = clampNumber(value, min, max);
	const [displayValue, setDisplayValue] = useState(target);
	const displayRef = useRef(target);
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");

		const cancelFrame = () => {
			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
		};

		const settle = () => {
			cancelFrame();
			displayRef.current = target;
			setDisplayValue(target);
		};

		const start = displayRef.current;
		if (!shouldAnimateNumber(start, target, media.matches, document.hidden)) {
			settle();
			return () => cancelFrame();
		}

		const duration =
			animatedNumberDuration(start, target, min, max);
		let startedAt: number | null = null;

		const tick = (now: number) => {
			if (media.matches || document.hidden) {
				settle();
				return;
			}
			if (startedAt === null) startedAt = now;
			const progress = Math.min(1, (now - startedAt) / duration);
			const next = interpolateNumber(start, target, progress);
			displayRef.current = next;
			setDisplayValue(next);
			if (progress < 1) {
				frameRef.current = window.requestAnimationFrame(tick);
			} else {
				frameRef.current = null;
			}
		};

		const onVisibilityChange = () => {
			if (document.hidden) settle();
		};
		const onReducedMotionChange = (event: MediaQueryListEvent) => {
			if (event.matches) settle();
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		media.addEventListener("change", onReducedMotionChange);
		frameRef.current = window.requestAnimationFrame(tick);

		return () => {
			cancelFrame();
			document.removeEventListener("visibilitychange", onVisibilityChange);
			media.removeEventListener("change", onReducedMotionChange);
		};
	}, [max, min, target]);

	const style = minWidthCh
		? ({
				"--animated-metric-width": `${minWidthCh}ch`,
			} as CSSProperties)
		: undefined;

	return (
		<span
			className={classNames(styles.metric, className)}
			style={style}
			data-animated-metric="true"
			data-metric-label={ariaLabel}
			data-animated-target={target}
			data-animated-running={
				Math.abs(displayValue - target) > 0.0001 ? "true" : "false"
			}
		>
			<meter
				className={styles.accessibleMeter}
				min={min}
				max={max}
				value={target}
				aria-label={ariaLabel}
				aria-valuetext={(ariaValueText ?? format)(target)}
			/>
			<span aria-hidden="true" data-animated-metric-visual="true">
				{format(displayValue)}
			</span>
		</span>
	);
}
