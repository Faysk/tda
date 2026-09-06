import type { HTMLAttributes } from "react";
import { classNames } from "./class-names";

type HeadingProps = HTMLAttributes<HTMLHeadingElement>;
type ParagraphProps = HTMLAttributes<HTMLParagraphElement>;

export function Eyebrow({ className, ...props }: ParagraphProps) {
	return <p className={classNames("ds-eyebrow", className)} {...props} />;
}

export function DisplayTitle({ className, ...props }: HeadingProps) {
	return <h1 className={classNames("ds-display-title", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: HeadingProps) {
	return <h2 className={classNames("ds-section-title", className)} {...props} />;
}

export function BodyCopy({ className, ...props }: ParagraphProps) {
	return <p className={classNames("ds-body-copy", className)} {...props} />;
}

export function MetaText({ className, ...props }: ParagraphProps) {
	return <p className={classNames("ds-meta", className)} {...props} />;
}
