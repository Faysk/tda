export type WorldNavItem = Readonly<{
	href: string;
	label: string;
	description: string;
	glyph: string;
}>;

export const WORLD_NAV_ITEMS: readonly WorldNavItem[] = [
	{
		href: "/mundo",
		label: "Ecos da Jornada",
		description: "Mapa de memória",
		glyph: "E",
	},
	{
		href: "/personagens",
		label: "Personagens",
		description: "Protagonistas da mesa",
		glyph: "P",
	},
	{
		href: "/npcs",
		label: "NPCs",
		description: "Pessoas do mundo",
		glyph: "N",
	},
	{
		href: "/lugares",
		label: "Lugares",
		description: "Territórios e destinos",
		glyph: "L",
	},
	{
		href: "/faccoes",
		label: "Facções",
		description: "Grupos e forças",
		glyph: "F",
	},
	{
		href: "/musicas",
		label: "Músicas",
		description: "Sons da jornada",
		glyph: "M",
	},
] as const;

const CAMPAIGN_WORLD_SECTION =
	/^\/campanhas\/([^/]+)\/(?:mundo|personagens|npcs|lugares|faccoes|musicas)(?:\/|$)/u;

export function worldNavHrefForPathname(pathname: string, href: string): string {
	const campaignMatch = pathname.match(CAMPAIGN_WORLD_SECTION);
	if (!campaignMatch) return href;
	return `/campanhas/${campaignMatch[1]}${href}`;
}

export function worldNavItemIsCurrent(pathname: string, href: string): boolean {
	if (pathname === href) return true;
	const worldHref = href === "/mundo" || href.endsWith("/mundo");
	return !worldHref && pathname.startsWith(`${href}/`);
}
