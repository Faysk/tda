"use client";

import { usePathname } from "next/navigation";
import { PublicLink as Link } from "./public-link";

type NavItem = Readonly<{
	href: string;
	label: string;
	className?: string;
}>;

const NAV_ITEMS: readonly NavItem[] = [
	{ href: "/sessoes", label: "Sessões" },
	{ href: "/lembra", label: "Lembra" },
	{ href: "/lore", label: "Lores", className: "lore-nav-link" },
	{ href: "/mundo", label: "Mundo", className: "world-nav-link" },
	{ href: "/conta", label: "Minha conta" },
];

function isCurrentPath(pathname: string, href: string) {
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicNav() {
	const pathname = usePathname();

	return (
		<nav aria-label="Navegação principal">
			{NAV_ITEMS.map((item) => {
				const current = isCurrentPath(pathname, item.href);
				return (
					<Link
						key={item.href}
						href={item.href}
						className={item.className}
						aria-current={current ? "page" : undefined}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
