import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
	type EditCapability,
	type EditGrant,
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

export const ACCOUNT_CAPABILITIES = ACCOUNT_CAPABILITY_GROUPS.flatMap((group) =>
	group.items.map((item) => item.capability),
);

const PROJECT_SCOPE_ID = "tda";
const SAFE_CAMPAIGN_SLUG = /^[A-Za-z0-9_-]{1,128}$/u;

function grantActive(grant: EditGrant, now: Date): boolean {
	if (grant.status !== "active") return false;
	const startsAt = Date.parse(grant.startsAt);
	if (!Number.isFinite(startsAt) || startsAt > now.getTime()) return false;
	if (!grant.endsAt) return true;
	const endsAt = Date.parse(grant.endsAt);
	return Number.isFinite(endsAt) && endsAt > now.getTime();
}

function hasExactScopeCapability(
	context: EditAccessContext,
	capability: EditCapability,
	scopeType: "project" | "campaign",
	scopeId: string,
	now: Date,
): boolean {
	if (!context.profileId) return false;
	return context.grants.some(
		(grant) =>
			grant.action === capability &&
			grant.scopeType === scopeType &&
			grant.scopeId === scopeId &&
			grantActive(grant, now),
	);
}

function exactScopeGroups(
	context: EditAccessContext,
	scopeType: "project" | "campaign",
	scopeId: string,
	now: Date,
): readonly AccountCapabilityGroup[] {
	return ACCOUNT_CAPABILITY_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) =>
			hasExactScopeCapability(
				context,
				item.capability,
				scopeType,
				scopeId,
				now,
			),
		),
	})).filter((group) => group.items.length > 0);
}

export function effectiveAccountProjectCapabilityGroups(
	context: EditAccessContext,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	return exactScopeGroups(context, "project", PROJECT_SCOPE_ID, now);
}

export function effectiveAccountCampaignCapabilityGroups(
	context: EditAccessContext,
	campaignSlug: string,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	const projectCapabilities = new Set(
		effectiveAccountProjectCapabilityGroups(context, now).flatMap((group) =>
			group.items.map((item) => item.capability),
		),
	);
	return exactScopeGroups(context, "campaign", campaignSlug, now)
		.map((group) => ({
			...group,
			items: group.items.filter(
				(item) => !projectCapabilities.has(item.capability),
			),
		}))
		.filter((group) => group.items.length > 0);
}

export function explicitAccountCampaignSlugsForCapability(
	context: EditAccessContext,
	capability: EditCapability,
	now = new Date(),
): readonly string[] {
	if (
		hasExactScopeCapability(
			context,
			capability,
			"project",
			PROJECT_SCOPE_ID,
			now,
		)
	)
		return [];

	return [
		...new Set(
			context.grants
				.filter(
					(grant) =>
						grant.action === capability &&
						grant.scopeType === "campaign" &&
						SAFE_CAMPAIGN_SLUG.test(grant.scopeId) &&
						grantActive(grant, now),
				)
				.map((grant) => grant.scopeId),
		),
	].sort();
}

export function hasAnyActiveAccountGrant(
	context: EditAccessContext,
	now = new Date(),
): boolean {
	if (!context.profileId) return false;
	return context.grants.some(
		(grant) =>
			grantActive(grant, now) &&
			((grant.scopeType === "project" && grant.scopeId === PROJECT_SCOPE_ID) ||
				(grant.scopeType === "campaign" &&
					SAFE_CAMPAIGN_SLUG.test(grant.scopeId))),
	);
}

/**
 * Compatibility helper for callers that already have an explicit campaign
 * context. New account UI should use the project/campaign split above.
 */
export function effectiveAccountCapabilityGroups(
	context: EditAccessContext,
	campaignSlug: string,
	now = new Date(),
): readonly AccountCapabilityGroup[] {
	return ACCOUNT_CAPABILITY_GROUPS.map((group) => ({
		...group,
		items: group.items.filter((item) =>
			authorizeCampaignCapability(
				context,
				item.capability,
				campaignSlug,
				now,
			).ok,
		),
	})).filter((group) => group.items.length > 0);
}
