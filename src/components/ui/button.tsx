import type { ButtonHTMLAttributes, ReactNode } from "react";
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

export type ButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"children"
> &
	ActionStyleOptions &
	Readonly<{
		children?: ReactNode;
		pending?: boolean;
		pendingLabel?: ReactNode;
	}>;

export function Button({
	children,
	className,
	disabled,
	pending = false,
	pendingLabel,
	size = "md",
	type = "button",
	variant = "secondary",
	...props
}: ButtonProps) {
	const resolvedPendingLabel = pendingLabel ?? children;

	return (
		<button
			aria-busy={pending || undefined}
			className={actionStyles({ className, size, variant })}
			data-pending={pending ? "true" : "false"}
			disabled={disabled || pending}
			type={type}
			{...props}
		>
			<span className="ds-action__label-stack">
				<span
					aria-hidden={pending ? "true" : undefined}
					className="ds-action__label ds-action__label--idle"
				>
					{children}
				</span>
				<span
					aria-hidden={pending ? undefined : "true"}
					className="ds-action__label ds-action__label--pending"
				>
					{resolvedPendingLabel}
				</span>
			</span>
		</button>
	);
}
