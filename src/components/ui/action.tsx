import type { ComponentProps } from "react";
import { PublicLink as Link } from "../public-link";
import {
	Button,
	actionStyles,
	type ActionSize,
	type ActionStyleOptions,
	type ActionVariant,
} from "./button";

export { Button, actionStyles } from "./button";
export type { ActionSize, ActionVariant } from "./button";

type ActionLinkProps = ComponentProps<typeof Link> & ActionStyleOptions;

export function ActionLink({
	className,
	size = "md",
	variant = "secondary",
	...props
}: ActionLinkProps) {
	return (
		<Link className={actionStyles({ className, size, variant })} {...props} />
	);
}
