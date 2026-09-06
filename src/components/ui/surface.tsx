import type { HTMLAttributes } from "react";
import { classNames } from "./class-names";

export type SurfaceTone = "default" | "elevated" | "subtle";

type SurfaceProps = HTMLAttributes<HTMLElement> &
	Readonly<{
		tone?: SurfaceTone;
	}>;

export function Surface({
	className,
	tone = "default",
	...props
}: SurfaceProps) {
	return (
		<section
			className={classNames(
				"ds-surface",
				tone !== "default" && `ds-surface--${tone}`,
				className,
			)}
			{...props}
		/>
	);
}
