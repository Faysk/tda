import type { HTMLAttributes } from "react";
import { classNames } from "./class-names";

export type StatusTone = "accent" | "success" | "danger" | "neutral";

type StatusPillProps = HTMLAttributes<HTMLSpanElement> &
	Readonly<{
		tone?: StatusTone;
	}>;

export function StatusPill({
	className,
	tone = "neutral",
	...props
}: StatusPillProps) {
	return (
		<span
			className={classNames(
				"ds-status",
				tone !== "neutral" && `ds-status--${tone}`,
				className,
			)}
			{...props}
		/>
	);
}
