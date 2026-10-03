import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
	isEffectiveCampaignScopedGrant,
	isEffectiveProjectGrant,
} from "@/features/edit/access/policy";

export type AccountCapabilityItem = Readonly<{
	label: string;
	capability: EditCapability;
}>;

export type AccountCapabilityGroup = Readonly<{
	title: string;
	items: readonly AccountCapabilityItem[];
}>;

export const ACCOUNT_CAPABILITY_GROUPS: readonly AccountCapabilityGroup[] = [
	{
		title: "Conteúdo e sessões",
		items: [
			{ label: "Editar conteúdo", capability: EDIT_CAPABILITIES.contentEdit },
			{ label: "Publicar sessões", capability: EDIT_CAPABILITIES.sessionPublish },
		],
	},
	{
		title: "Transcrições e processamento",
		items: [
			{ label: "Ler transcrições", capability: EDIT_CAPABILITIES.transcriptRead },
			{
				label: "Importar transcrições",
				capability: EDIT_CAPABILITIES.transcriptImport,
			},
			{
				label: "Publicar transcrições",
				capability: EDIT_CAPABILITIES.transcriptPublish,
			},
			{
				label: "Processar localmente",
				capability: EDIT_CAPABILITIES.localProcess,
			},
			{
				label: "Gerenciar atividade de processamento",
				capability: EDIT_CAPABILITIES.activityBarksManage,
			},
		],
	},
	{
		title: "Mundo e narrativa",
		items: [
			{
				label: "Editar layout do mundo",
				capability: EDIT_CAPABILITIES.worldLayoutEdit,
			},
			{ label: "Ver revisão narrativa", capability: EDIT_CAPABILITIES.reviewRead },
			{
				label: "Gerenciar revisão narrativa",
				capability: EDIT_CAPABILITIES.reviewManage,
			},
			{ label: "Aprovar cânone", capability: EDIT_CAPABILITIES.canonApprove },
		],
	},
	{
		title: "Administração",
		items: [
			{
				label: "Gerenciar permissões",
				capability: EDIT_CAPABILITIES.permissionsManage,
			},
		],
	},
];

export const ACCOUNT_CAPABILITIES: readonly EditCapability[] =
	ACCOUNT_CAPABILITY_GROUPS.flatMap((group) =>
		group.items.map((item) => item.capability),
	);

function filterCapabilityGroups(
	predicate: (capability: EditCapability) => boolean,
): readonly AccountCapabilityGroup[] {
	return ACCOUNT_CAPABILITY_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) => predicate(item.capability)),
	})).filter((group) => group.items.length > 0);
}

export function effectiveAccountCapabilityGroups(
	context: EditAccessContext,
	campaignSlug: string,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	return filterCapabilityGroups(
		(capability) =>
			authorizeCampaignCapability(
				context,
				capability,
				campaignSlug,
				now,
			).ok,
	);
}

export function projectAccountCapabilityGroups(
	context: EditAccessContext,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	if (!context.profileId) return [];
	return filterCapabilityGroups((capability) =>
		context.grants.some(
			(grant) =>
				grant.action === capability &&
				isEffectiveProjectGrant(grant, now),
		),
	);
}

export function campaignSpecificAccountCapabilityGroups(
	context: EditAccessContext,
	campaignSlug: string,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	if (!context.profileId) return [];
	return filterCapabilityGroups((capability) =>
		context.grants.some(
			(grant) =>
				grant.action === capability &&
				isEffectiveCampaignScopedGrant(grant, campaignSlug, now),
		),
	);
}

export function hasAnyEffectiveAccountCapability(
	context: EditAccessContext,
	now = new Date(),
): boolean {
	if (!context.profileId) return false;
	const capabilities = new Set<string>(ACCOUNT_CAPABILITIES);
	return context.grants.some(
		(grant) =>
			capabilities.has(grant.action) &&
			(
				isEffectiveProjectGrant(grant, now) ||
				(grant.scopeType === "campaign" &&
					isEffectiveCampaignScopedGrant(grant, grant.scopeId, now))
			),
	);
}
