import "server-only";

import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

export {
	editSessionDetailHref,
	editSessionLibraryHref,
} from "./session-routes";

export type EditableSessionCampaign = Readonly<{
	id: string;
	technicalSlug: string;
	routeKey: string;
	name: string;
	lifecycle: "active" | "archived";
	visibility: "public" | "private";
}>;

export type EditableSessionCampaignsResult =
	| Readonly<{ ok: true; campaigns: readonly EditableSessionCampaign[] }>
	| Readonly<{
			ok: false;
			reason: "profile_unresolved" | "dependency_unavailable";
	  }>;

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCampaign(
	row: Record<string, unknown>,
): EditableSessionCampaign | null {
	const id = text(row.id);
	const technicalSlug = text(row.slug);
	const routeKey = text(row.public_slug);
	const name = text(row.name);
	const lifecycle =
		row.lifecycle === "active" || row.lifecycle === "archived"
			? row.lifecycle
			: null;
	const visibility =
		row.visibility === "public" || row.visibility === "private"
			? row.visibility
			: null;
	if (
		!id ||
		!technicalSlug ||
		!routeKey ||
		!name ||
		!lifecycle ||
		!visibility ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(technicalSlug) ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routeKey)
	) {
		return null;
	}
	return { id, technicalSlug, routeKey, name, lifecycle, visibility };
}

export async function readEditableSessionCampaigns(
	context: EditAccessContext,
): Promise<EditableSessionCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client
		.from("campaigns")
		.select("id,slug,public_slug,name,lifecycle,visibility")
		.order("name")
		.order("slug");
	if (error || !Array.isArray(data)) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	const campaigns: EditableSessionCampaign[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		const campaign = parseCampaign(raw as Record<string, unknown>);
		if (!campaign) return { ok: false, reason: "dependency_unavailable" };
		if (
			authorizeCampaignCapability(
				context,
				EDIT_CAPABILITIES.transcriptRead,
				campaign.technicalSlug,
			).ok
		) {
			campaigns.push(campaign);
		}
	}
	return { ok: true, campaigns };
}
