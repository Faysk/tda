import "server-only";

import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";

export type EditableWorldCampaign = Readonly<{
	id: string;
	technicalSlug: string;
	routeKey: string;
	name: string;
}>;

export type EditableWorldCampaignsResult =
	| Readonly<{ ok: true; campaigns: readonly EditableWorldCampaign[] }>
	| Readonly<{ ok: false; reason: "profile_unresolved" | "dependency_unavailable" }>;

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCampaign(row: Record<string, unknown>): EditableWorldCampaign | null {
	const id = text(row.id);
	const technicalSlug = text(row.slug);
	const routeKey = text(row.public_slug);
	const name = text(row.name);
	if (
		!id ||
		!technicalSlug ||
		!routeKey ||
		!name ||
		!/^[A-Za-z0-9_-]{1,128}$/u.test(technicalSlug) ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routeKey)
	) {
		return null;
	}
	return { id, technicalSlug, routeKey, name };
}

export async function readEditableWorldCampaigns(
	context: EditAccessContext,
): Promise<EditableWorldCampaignsResult> {
	if (!context.profileId) return { ok: false, reason: "profile_unresolved" };

	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client
		.from("campaigns")
		.select("id,slug,public_slug,name,lifecycle")
		.eq("lifecycle", "active")
		.order("name")
		.order("slug");
	if (error || !Array.isArray(data)) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	const campaigns: EditableWorldCampaign[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		const campaign = parseCampaign(raw as Record<string, unknown>);
		if (!campaign) return { ok: false, reason: "dependency_unavailable" };
		if (
			authorizeCampaignCapability(
				context,
				EDIT_CAPABILITIES.worldLayoutEdit,
				campaign.technicalSlug,
			).ok
		) {
			campaigns.push(campaign);
		}
	}

	return { ok: true, campaigns };
}
