"use client";

import NextLink, { useLinkStatus } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useGlobalLoadingFlag } from "./global-loading";

export type PublicLinkProps = Omit<
	AnchorHTMLAttributes<HTMLAnchorElement>,
	"href"
> & {
	href: string;
	globalLoading?: boolean;
};

function PendingNavigation({
	children,
	globalLoading,
}: Readonly<{ children: ReactNode; globalLoading: boolean }>) {
	const { pending } = useLinkStatus();
	useGlobalLoadingFlag(globalLoading && pending);
	return children;
}

export function PublicLink({
	href,
	children,
	globalLoading = false,
	...props
}: PublicLinkProps) {
	return (
		<NextLink href={href} {...props}>
			<PendingNavigation globalLoading={globalLoading}>{children}</PendingNavigation>
		</NextLink>
	);
}
