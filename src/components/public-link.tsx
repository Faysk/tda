"use client";

import NextLink, { useLinkStatus } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useGlobalLoadingFlag } from "./global-loading";

export type PublicLinkProps = Omit<
	AnchorHTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	href: string;
};

function PendingNavigation({ children }: Readonly<{ children: ReactNode }>) {
	const { pending } = useLinkStatus();
	useGlobalLoadingFlag(pending);
	return children;
}

export function PublicLink({ href, children, ...props }: PublicLinkProps) {
	return (
		<NextLink href={href} {...props}>
			<PendingNavigation>{children}</PendingNavigation>
		</NextLink>
	);
}
