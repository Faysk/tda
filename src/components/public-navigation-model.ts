import {
	EDIT_CAPABILITIES,
	type EditCapability,
} from "@/features/edit/access/policy";
import { LEGACY_CAMPAIGN_TECHNICAL_SLUG } from "@/features/sessions/model";

export type NavigationIcon =
	| "campaigns"
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

export type NavigationCampaignLocation = Readonly<{
	technicalSlug: string;
	routeKey: string | null;
}>;

export const PUBLIC_NAV_ITEMS: readonly NavigationItem[] = [
	{ href: "/campanhas", label: "Campanhas", icon: "campaigns" },
	{ href: "/campanhas/sessoes", label: "Sessões", icon: "sessions" },
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

export function toolNavigationItemsForCampaign(
	technicalSlug: string,
	capabilities: readonly string[],
	routeKey: string = technicalSlug,
): readonly ToolNavigationItem[] {
	const allowed = new Set(capabilities);
	const items: ToolNavigationItem[] = [];

	if (allowed.has(EDIT_CAPABILITIES.transcriptRead)) {
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/transcricoes`,
			label: "Transcrições",
			icon: "transcripts",
			capability: EDIT_CAPABILITIES.transcriptRead,
		});
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/sessoes`,
			label: "Editar sessões",
			icon: "edit-sessions",
			capability: EDIT_CAPABILITIES.transcriptRead,
		});
	}

	if (allowed.has(EDIT_CAPABILITIES.localProcess)) {
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/processamento`,
			label: "Processar",
			icon: "process",
			capability: EDIT_CAPABILITIES.localProcess,
		});
	}

	if (allowed.has(EDIT_CAPABILITIES.worldLayoutEdit)) {
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/mundo`,
			label: "Editar mundo",
			icon: "edit-world",
			capability: EDIT_CAPABILITIES.worldLayoutEdit,
		});
	}

	if (allowed.has(EDIT_CAPABILITIES.reviewRead)) {
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/revisao`,
			label: "Revisão",
			icon: "review",
			capability: EDIT_CAPABILITIES.reviewRead,
		});
	}

	if (allowed.has(EDIT_CAPABILITIES.permissionsManage)) {
		items.push({
			href: `/edit/${encodeURIComponent(routeKey)}/permissions`,
			label: "Permissões",
			icon: "permissions",
			capability: EDIT_CAPABILITIES.permissionsManage,
		});
	}

	return items;
}

const LEGACY_TOOL_CAPABILITIES = [
	EDIT_CAPABILITIES.transcriptRead,
	EDIT_CAPABILITIES.localProcess,
	EDIT_CAPABILITIES.worldLayoutEdit,
	EDIT_CAPABILITIES.reviewRead,
	EDIT_CAPABILITIES.permissionsManage,
] as const;

export const TOOL_NAV_ITEMS: readonly ToolNavigationItem[] =
	toolNavigationItemsForCampaign(
		LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		LEGACY_TOOL_CAPABILITIES,
	);

function hrefPath(href: string): string {
	return href.split(/[?#]/u, 1)[0] || href;
}

export function isCurrentNavigationPath(
	pathname: string,
	href: string,
): boolean {
	const target = hrefPath(href);

	if (target === "/campanhas") return pathname === "/campanhas";
	if (target === "/campanhas/sessoes") {
		return (
			pathname === target ||
			/^\/campanhas\/[^/]+\/sessoes(?:\/|$)/u.test(pathname)
		);
	}
	if (target === "/mundo") {
		return (
			pathname === target ||
			pathname.startsWith(`${target}/`) ||
			/^\/campanhas\/[^/]+\/mundo(?:\/|$)/u.test(pathname)
		);
	}
	return pathname === target || pathname.startsWith(`${target}/`);
}

function decodeSegment(value: string | undefined): string | null {
	if (!value) return null;
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

export function locationHasCampaignReference(
	pathname: string,
	search = "",
): boolean {
	const parts = pathname.split("/");
	if (parts[1] === "edit" && parts.length >= 4 && parts[2]) return true;
	if (
		parts[1] === "campanhas" &&
		parts[2] &&
		parts[2] !== "sessoes" &&
		parts.length >= 4
	)
		return true;
	return new URLSearchParams(search).has("campanha");
}

export function campaignTechnicalSlugFromLocation(
	campaigns: readonly NavigationCampaignLocation[],
	pathname: string,
	search = "",
): string | null {
	const parts = pathname.split("/");

	if (parts[1] === "edit") {
		const segment = decodeSegment(parts[2]);
		const direct = campaigns.find(
			(campaign) =>
				campaign.technicalSlug === segment ||
				((["processamento", "transcricoes", "mundo", "revisao", "permissions", "sessoes"].includes(parts[3] ?? "")) &&
					campaign.routeKey === segment),
		);
		if (direct) return direct.technicalSlug;
	}

	if (parts[1] === "campanhas" && parts[2] !== "sessoes" && parts.length >= 4) {
		const segment = decodeSegment(parts[2]);
		const direct = campaigns.find((campaign) => campaign.routeKey === segment);
		if (direct) return direct.technicalSlug;
	}

	const query = new URLSearchParams(search);
	const requested = query.get("campanha");
	return (
		campaigns.find((campaign) => campaign.routeKey === requested || campaign.technicalSlug === requested)
			?.technicalSlug ?? null
	);
}

export function visibleToolNavigationItems(
	capabilities: readonly string[],
): readonly ToolNavigationItem[] {
	return toolNavigationItemsForCampaign(
		LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		capabilities,
	);
}
