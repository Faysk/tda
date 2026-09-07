import type { AnchorHTMLAttributes } from "react";

export type PublicLinkProps = Omit<
	AnchorHTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	href: string;
};

export function PublicLink({ href, ...props }: PublicLinkProps) {
	return <a href={href} {...props} />;
}
