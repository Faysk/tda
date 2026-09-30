import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import {
	isCampaignId,
	normalizeCampaignDescription,
	normalizeCampaignName,
	normalizeCampaignRouteKey,
	type CampaignMutationResult,
	type CampaignVisibility,
} from "./model";
import { canManageCampaignRegistry } from "./policy";
import {
	createCampaignRegistryEntry,
	readCampaignRegistry,
	readPublicCampaignDirectory,
	updateCampaignLifecycle,
	updateCampaignRegistryEntry,
} from "./repository";

export { readPublicCampaignDirectory };

export type CampaignManagementReadResult =
	| Readonly<{
		ok: true;
		campaigns: NonNullable<Awaited<ReturnType<typeof readCampaignRegistry>>>;
	  }>
	| Readonly<{
		ok: false;
		reason:
			| "unauthenticated"
			| "profile_unresolved"
			| "forbidden"
			| "dependency_unavailable";
	  }>;

async function resolveManager() {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;
	const context = await loadEditAccessContext(identity.authUserId);
	if (!context)
		return { ok: false, reason: "dependency_unavailable" } as const;
	if (!context.profileId)
		return { ok: false, reason: "profile_unresolved" } as const;
	if (!canManageCampaignRegistry(context))
		return { ok: false, reason: "forbidden" } as const;
	return { ok: true, context } as const;
}

export async function readManageableCampaigns(): Promise<CampaignManagementReadResult> {
	try {
		const manager = await resolveManager();
		if (!manager.ok) return manager;
		const campaigns = await readCampaignRegistry();
		return campaigns
			? { ok: true, campaigns }
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

function parseVisibility(value: FormDataEntryValue | null): CampaignVisibility | null {
	return value === "public" || value === "private" ? value : null;
}

export async function createCampaign(input: {
	name: string;
	technicalSlug: string;
	routeKey: string;
	description: string;
	visibility: string;
}): Promise<CampaignMutationResult> {
	try {
		const manager = await resolveManager();
		if (!manager.ok) return manager;

		const name = normalizeCampaignName(input.name);
		const technicalSlug = normalizeCampaignRouteKey(input.technicalSlug);
		const routeKey = normalizeCampaignRouteKey(input.routeKey);
		const description = normalizeCampaignDescription(input.description);
		const visibility = parseVisibility(input.visibility);
		if (!name) return { ok: false, reason: "validation", field: "name" };
		if (!technicalSlug)
			return {
				ok: false,
				reason: "validation",
				field: "technicalSlug",
			};
		if (!routeKey)
			return { ok: false, reason: "validation", field: "routeKey" };
		if (input.description.trim() && description === null)
			return {
				ok: false,
				reason: "validation",
				field: "description",
			};
		if (!visibility)
			return { ok: false, reason: "validation", field: "visibility" };

		const result = await createCampaignRegistryEntry({
			name,
			technicalSlug,
			routeKey,
			description,
			visibility,
		});
		if (result.status === "updated")
			return { ok: true, campaign: result.campaign };
		return { ok: false, reason: result.status };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function updateCampaign(input: {
	id: string;
	expectedUpdatedAt: string;
	name: string;
	routeKey: string;
	description: string;
	visibility: string;
}): Promise<CampaignMutationResult> {
	try {
		const manager = await resolveManager();
		if (!manager.ok) return manager;
		if (!isCampaignId(input.id) || !input.expectedUpdatedAt)
			return { ok: false, reason: "validation" };

		const name = normalizeCampaignName(input.name);
		const routeKey = normalizeCampaignRouteKey(input.routeKey);
		const description = normalizeCampaignDescription(input.description);
		const visibility = parseVisibility(input.visibility);
		if (!name) return { ok: false, reason: "validation", field: "name" };
		if (!routeKey)
			return { ok: false, reason: "validation", field: "routeKey" };
		if (input.description.trim() && description === null)
			return {
				ok: false,
				reason: "validation",
				field: "description",
			};
		if (!visibility)
			return { ok: false, reason: "validation", field: "visibility" };

		const result = await updateCampaignRegistryEntry({
			id: input.id,
			expectedUpdatedAt: input.expectedUpdatedAt,
			name,
			routeKey,
			description,
			visibility,
		});
		if (result.status === "updated")
			return { ok: true, campaign: result.campaign };
		return { ok: false, reason: result.status };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function setCampaignLifecycle(input: {
	id: string;
	expectedUpdatedAt: string;
	lifecycle: string;
}): Promise<CampaignMutationResult> {
	try {
		const manager = await resolveManager();
		if (!manager.ok) return manager;
		if (
			!isCampaignId(input.id) ||
			!input.expectedUpdatedAt ||
			(input.lifecycle !== "active" && input.lifecycle !== "archived")
		)
			return { ok: false, reason: "validation" };

		const result = await updateCampaignLifecycle({
			id: input.id,
			expectedUpdatedAt: input.expectedUpdatedAt,
			lifecycle: input.lifecycle,
		});
		if (result.status === "updated")
			return { ok: true, campaign: result.campaign };
		return { ok: false, reason: result.status };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
