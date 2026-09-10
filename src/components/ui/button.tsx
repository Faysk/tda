import type { ButtonHTMLAttributes } from "react";
import { classNames } from "./class-names";

export type ActionVariant = "primary" | "secondary" | "tertiary";
export type ActionSize = "sm" | "md";

export type ActionStyleOptions = Readonly<{
	variant?: ActionVariant;
	size?: ActionSize;
	className?: string;
}>;

export function actionStyles({
	variant = "secondary",
	size = "md",
	className,
}: ActionStyleOptions = {}): string {
	return classNames(
		"ds-action",
		`ds-action--${variant}`,
		`ds-action--${size}`,
		className,
	);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & ActionStyleOptions;

export function Button({
	className,
	size = "md",
	type = "button",
	variant = "secondary",
	...props
}: ButtonProps) {
	return (
		<button
			className={actionStyles({ className, size, variant })}
			type={type}
			{...props}
		/>
	);
}
