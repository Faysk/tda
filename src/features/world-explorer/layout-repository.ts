import "server-only";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { publishedDataClient } from "@/integrations/supabase/server";
import { sanitizeWorldLayoutProjection } from "./layout-contract";
import type { WorldGraphProjection, WorldLayoutProjection } from "./model";

type LayoutRow = {
	schema_version?: unknown;
	view_name?: unknown;
	revision?: unknown;
	positions?: unknown;
};

type DataClient = NonNullable<ReturnType<typeof publishedDataClient>>;

function parseLayoutRow(
	row: LayoutRow | null,
	projection: Pick<WorldGraphProjection, "mode" | "nodes">,
): WorldLayoutProjection | undefined {
	if (!row) return undefined;
	if (!row.positions || typeof row.positions !== "object" || Array.isArray(row.positions)) {
		return undefined;
	}

	const candidate: WorldLayoutProjection = {
		schemaVersion: row.schema_version as 1,
		view: row.view_name as "overview",
		revision: row.revision as number,
		positions: row.positions as WorldLayoutProjection["positions"],
	};

	return sanitizeWorldLayoutProjection(
		candidate,
		new Set(projection.nodes.map((node) => node.id)),
		projection.mode,
	);
}

async function loadLayout(
	client: DataClient | null,
	projection: Pick<WorldGraphProjection, "mode" | "nodes">,
): Promise<WorldLayoutProjection | undefined> {
	if (!client || projection.mode !== "overview") return undefined;

	const { data, error } = await client
		.from("world_layout_snapshots")
		.select("schema_version,view_name,revision,positions,campaigns!inner(slug)")
		.eq("view_name", "overview")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.maybeSingle();

	if (error) {
		console.error("World layout snapshot unavailable", error.message);
		return undefined;
	}

	return parseLayoutRow((data ?? null) as LayoutRow | null, projection);
}

export async function loadPublishedWorldLayout(
	projection: Pick<WorldGraphProjection, "mode" | "nodes">,
): Promise<WorldLayoutProjection | undefined> {
	return loadLayout(publishedDataClient(), projection);
}
