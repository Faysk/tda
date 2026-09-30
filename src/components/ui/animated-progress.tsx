import { Progress } from "./progress";

type Props = Readonly<{
	value: number;
	max: number;
	ariaLabel: string;
	valueText?: string;
	className?: string;
	expectedSampleMs?: number;
}>;

export function AnimatedProgress({
	value,
	max,
	ariaLabel,
	valueText,
	className,
	expectedSampleMs,
}: Props) {
	const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
	const safeValue = Math.min(
		safeMax,
		Math.max(0, Number.isFinite(value) ? value : 0),
	);
	const ratio = safeValue / safeMax;

	return (
		<Progress
			ariaLabel={ariaLabel}
			tone="accent"
			className={className}
			dataAnimatedProgress
			dataProgressLabel={ariaLabel}
			dataProgressSampleMs={expectedSampleMs}
			dataProgressTarget={ratio}
			expectedSampleMs={expectedSampleMs}
			max={safeMax}
			value={safeValue}
			valueText={valueText}
		/>
	);
}
