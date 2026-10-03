import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { serverAuthClient } from "@/features/auth/server";
import { lembraDataClient } from "@/integrations/supabase/server";
import { isLembraCampaignRegistryUnavailable } from "./campaign-classification";
import {
	isLembraUuid,
	type LembraCampaignClassification,
} from "./model";

const PUBLIC_CAMPAIGN_SELECT = "id,name,lifecycle,visibility";

type CampaignProjectionRow = Readonly<{
	id: string;
	name: string;
	lifecycle: "active" | "archived";
	visibility: "public" | "private";
}>;

function parseCampaignProjectionRow(
	row: Record<string, unknown>,
): CampaignProjectionRow | null {
	if (
		!isLembraUuid(row.id) ||
		typeof row.name !== "string" ||
		!row.name.trim() ||
		(row.lifecycle !== "active" && row.lifecycle !== "archived") ||
		(row.visibility !== "public" && row.visibility !== "private")
	) {
		return null;
	}

	return {
		id: row.id,
		name: row.name.trim(),
		lifecycle: row.lifecycle,
		visibility: row.visibility,
	};
}

function presentCampaign(
	row: CampaignProjectionRow,
): LembraCampaignClassification {
	return {
		id: row.id,
		name: row.name,
		lifecycle: row.lifecycle,
	};
}

function parseRows(data: unknown): CampaignProjectionRow[] {
	if (!Array.isArray(data)) return [];
	return data.flatMap((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
		const row = parseCampaignProjectionRow(raw as Record<string, unknown>);
		return row ? [row] : [];
	});
}

/**
 * Calls the first-class authenticated discovery projection from #1134/#1204.
 * The RPC performs exact capability/scope checks with auth.uid(); Lembra only
 * consumes and redacts its result and never receives raw grants.
 */
async function loadAuthorizedCampaignProjection(): Promise<
	CampaignProjectionRow[]
> {
	try {
		const client = await serverAuthClient();
		if (!client) return [];
		const { data, error } = await client.rpc("campaign_edit_directory");
		if (error) return [];
		return parseRows(data);
	} catch {
		return [];
	}
}

/**
 * Privacy-safe Lembra classification projection.
 *
 * Public campaigns remain globally discoverable to authenticated Lembra users.
 * Private campaigns are added only when the current browser session receives
 * them from the first-class campaign_edit_directory() projection. Technical
 * slug, route key, visibility and grants never leave this server-only boundary.
 */
export async function loadDiscoverableLembraCampaigns(
	client: SupabaseClient | null = lembraDataClient(),
): Promise<LembraCampaignClassification[]> {
	if (!client) throw new Error("lembra_data_unavailable");

	const [publicResult, authorizedRows] = await Promise.all([
		client
			.from("campaigns")
			.select(PUBLIC_CAMPAIGN_SELECT)
			.eq("visibility", "public")
			.order("name", { ascending: true })
			.order("id", { ascending: true }),
		loadAuthorizedCampaignProjection(),
	]);
	if (publicResult.error) {
		if (isLembraCampaignRegistryUnavailable(publicResult.error)) return [];
		throw new Error(`lembra_campaign_lookup:${publicResult.error.message}`);
	}

	const byId = new Map<string, LembraCampaignClassification>();
	for (const row of [
		...parseRows(publicResult.data),
		...authorizedRows,
	]) {
		byId.set(row.id, presentCampaign(row));
	}

	return [...byId.values()].sort(
		(a, b) => a.name.localeCompare(b.name, "pt-BR") || a.id.localeCompare(b.id),
	);
}

/**
 * Reauthorizes a requested classification at mutation time.
 * Public targets are resolved through the public projection. Any non-public
 * target must be present in the current session's hardened edit directory.
 * A forged/undiscoverable UUID therefore resolves exactly like an absent one.
 */
export async function resolveDiscoverableLembraCampaign(
	client: SupabaseClient,
	campaignId: string,
): Promise<LembraCampaignClassification | null> {
	if (!isLembraUuid(campaignId)) return null;

	const [publicResult, authorizedRows] = await Promise.all([
		client
			.from("campaigns")
			.select(PUBLIC_CAMPAIGN_SELECT)
			.eq("id", campaignId)
			.eq("visibility", "public")
			.maybeSingle(),
		loadAuthorizedCampaignProjection(),
	]);
	if (publicResult.error) {
		if (!isLembraCampaignRegistryUnavailable(publicResult.error)) {
			throw new Error(`lembra_campaign_lookup:${publicResult.error.message}`);
		}
	} else if (
		publicResult.data &&
		typeof publicResult.data === "object" &&
		!Array.isArray(publicResult.data)
	) {
		const publicRow = parseCampaignProjectionRow(
			publicResult.data as Record<string, unknown>,
		);
		if (publicRow) return presentCampaign(publicRow);
	}

	const authorized = authorizedRows.find((row) => row.id === campaignId);
	return authorized ? presentCampaign(authorized) : null;
}
