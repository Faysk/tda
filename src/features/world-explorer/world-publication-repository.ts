import "server-only";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	editDataClient,
	publishedDataClient,
} from "@/integrations/supabase/server";
import type { WorldPublicationMeta } from "./model";
import type { WorldAudience } from "./world-audience";

type RevisionRow = {
	revision: number | string | null;
	updated_at: string | null;
	updated_by: string | null;
};

function safeRevision(value: number | string | null | undefined): number {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeDate(value: string | null | undefined): number {
	const timestamp = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(timestamp) ? timestamp : 0;
}

export async function loadWorldPublicationMeta(
	audience: WorldAudience,
	campaignSlug = CAMPAIGN_SLUG,
): Promise<WorldPublicationMeta | undefined> {
	const client = audience === "editor" ? editDataClient() : publishedDataClient();
	if (!client) return undefined;

	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (campaignError) {
		throw new Error(`World publication campaign lookup failed: ${campaignError.message}`);
	}
	if (!campaign?.id) return undefined;

	const [{ data: graphHead, error: graphError }, { data: layoutHead, error: layoutError }] =
		await Promise.all([
			client
				.from("world_graph_heads")
				.select("revision,updated_at,updated_by")
				.eq("campaign_id", campaign.id)
				.maybeSingle(),
			client
				.from("world_layout_snapshots")
				.select("revision,updated_at,updated_by")
				.eq("campaign_id", campaign.id)
				.eq("view_name", "overview")
				.maybeSingle(),
		]);

	if (graphError) {
		throw new Error(`World publication graph head lookup failed: ${graphError.message}`);
	}
	if (layoutError) {
		throw new Error(`World publication layout head lookup failed: ${layoutError.message}`);
	}
	if (!graphHead && !layoutHead) return undefined;

	const graph = (graphHead ?? null) as RevisionRow | null;
	const layout = (layoutHead ?? null) as RevisionRow | null;
	const graphUpdatedAt = safeDate(graph?.updated_at);
	const layoutUpdatedAt = safeDate(layout?.updated_at);
	const latest = layoutUpdatedAt >= graphUpdatedAt ? layout : graph;
	const latestTimestamp = latest?.updated_at ?? graph?.updated_at ?? layout?.updated_at;
	if (!latestTimestamp) return undefined;

	let publishedBy: string | null = null;
	if (audience !== "public" && latest?.updated_by) {
		const { data: profile, error: profileError } = await client
			.from("profiles")
			.select("display_name")
			.eq("id", latest.updated_by)
			.maybeSingle();
		if (profileError) {
			throw new Error(`World publication author lookup failed: ${profileError.message}`);
		}
		publishedBy =
			typeof profile?.display_name === "string" && profile.display_name.trim().length
				? profile.display_name.trim()
				: null;
	}

	return {
		graphRevision: safeRevision(graph?.revision),
		layoutRevision: safeRevision(layout?.revision),
		publishedAt: latestTimestamp,
		publishedBy,
	};
}
