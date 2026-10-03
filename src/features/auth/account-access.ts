import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
	isEffectiveCampaignGrant,
} from "@/features/edit/access/policy";

export type AccountCapabilityItem = Readonly<{
	label: string;
	capability: EditCapability;
}>;

export type AccountCapabilityGroup = Readonly<{
	title: string;
	items: readonly AccountCapabilityItem[];
}>;

export type AccountCapabilityScope = "project" | "campaign";

export type AccountEffectiveCapabilityItem = AccountCapabilityItem &
	Readonly<{ scope: AccountCapabilityScope }>;

export type AccountEffectiveCapabilityGroup = Readonly<{
	title: string;
	items: readonly AccountEffectiveCapabilityItem[];
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

export function effectiveAccountCapabilityScope(
	context: EditAccessContext,
	capability: EditCapability,
	campaignSlug: string,
	now = new Date(),
): AccountCapabilityScope | null {
	const grants = context.grants.filter(
		(grant) =>
			grant.action === capability &&
			isEffectiveCampaignGrant(grant, campaignSlug, now),
	);
	if (
		grants.some(
			(grant) => grant.scopeType === "project" && grant.scopeId === "tda",
		)
	) {
		return "project";
	}
	if (
		grants.some(
			(grant) =>
				grant.scopeType === "campaign" && grant.scopeId === campaignSlug,
		)
	) {
		return "campaign";
	}
	return null;
}

export function effectiveAccountCapabilityGroups(
	context: EditAccessContext,
	campaignSlug: string,
	now = new Date(),
): readonly AccountEffectiveCapabilityGroup[] {
	return ACCOUNT_CAPABILITY_GROUPS.map((group) => ({
		...group,
		items: group.items.flatMap((item) => {
			if (
				!authorizeCampaignCapability(
					context,
					item.capability,
					campaignSlug,
					now,
				).ok
			) {
				return [];
			}
			const scope = effectiveAccountCapabilityScope(
				context,
				item.capability,
				campaignSlug,
				now,
			);
			return scope ? [{ ...item, scope }] : [];
		}),
	})).filter((group) => group.items.length > 0);
}
