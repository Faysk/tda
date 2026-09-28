import {
	EDIT_CAPABILITIES,
	type EditCapability,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";

export type NavigationIcon =
	| "sessions"
	| "memory"
	| "lore"
	| "world"
	| "characters"
	| "npcs"
	| "places"
	| "factions"
	| "quests"
	| "music"
	| "diary"
	| "transcripts"
	| "edit-sessions"
	| "process"
	| "edit-world"
	| "review"
	| "permissions";

export type NavigationItem = Readonly<{
	href: string;
	label: string;
	icon: NavigationIcon;
}>;

export type ToolNavigationItem = NavigationItem &
	Readonly<{
		capability: EditCapability;
	}>;

export const PUBLIC_NAV_ITEMS: readonly NavigationItem[] = [
	{ href: "/sessoes", label: "Sessões", icon: "sessions" },
	{ href: "/lembra", label: "Lembra", icon: "memory" },
	{ href: "/lore", label: "Lores", icon: "lore" },
	{ href: "/mundo", label: "Mundo", icon: "world" },
	{ href: "/personagens", label: "Personagens", icon: "characters" },
	{ href: "/npcs", label: "NPCs", icon: "npcs" },
	{ href: "/lugares", label: "Lugares", icon: "places" },
	{ href: "/faccoes", label: "Facções", icon: "factions" },
	{ href: "/quests", label: "Quests", icon: "quests" },
	{ href: "/musicas", label: "Músicas", icon: "music" },
	{ href: "/diario", label: "Diários", icon: "diary" },
];

export const TOOL_NAV_ITEMS: readonly ToolNavigationItem[] = [
	{
		href: "/transcricoes",
		label: "Transcrições",
		icon: "transcripts",
		capability: EDIT_CAPABILITIES.transcriptRead,
	},
	{
		href: "/edit/sessoes",
		label: "Editar sessões",
		icon: "edit-sessions",
		capability: EDIT_CAPABILITIES.transcriptRead,
	},
	{
		href: "/edit/processamento",
		label: "Processar",
		icon: "process",
		capability: EDIT_CAPABILITIES.localProcess,
	},
	{
		href: "/mundo",
		label: "Editar mundo",
		icon: "edit-world",
		capability: EDIT_CAPABILITIES.worldLayoutEdit,
	},
	{
		href: "/edit/revisao",
		label: "Revisão",
		icon: "review",
		capability: EDIT_CAPABILITIES.reviewRead,
	},
	{
		href: `/edit/${CAMPAIGN_SLUG}/permissions`,
		label: "Permissões",
		icon: "permissions",
		capability: EDIT_CAPABILITIES.permissionsManage,
	},
];

export function isCurrentNavigationPath(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleToolNavigationItems(
	capabilities: readonly string[],
): readonly ToolNavigationItem[] {
	const allowed = new Set(capabilities);
	return TOOL_NAV_ITEMS.filter((item) => allowed.has(item.capability));
}
