import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isLembraMediaMime,
	lembraImageUrl,
	type LembraReference,
	type LembraMediaMime,
} from "./model";

export type LembraReferenceRow = Readonly<{
	id: string;
	campaign_id: string;
	title: string;
	description: string;
	status: "active" | "retired";
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: string;
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
	created_by: string | null;
	created_at: string;
	updated_at: string;
}>;

export async function resolveLembraCampaignId(
	client: SupabaseClient,
): Promise<string | null> {
	const { data, error } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (error) throw new Error(`lembra_campaign_lookup:${error.message}`);
	return data?.id ?? null;
}

function numeric(value: number | string): number | null {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function validLembraReferenceRow(
	row: LembraReferenceRow,
): row is LembraReferenceRow & Readonly<{ mime_type: LembraMediaMime }> {
	return Boolean(
		row.status === "active" &&
			row.read_back_verified === true &&
			isLembraMediaMime(row.mime_type) &&
			numeric(row.byte_size) &&
			Number.isSafeInteger(row.width) &&
			row.width > 0 &&
			Number.isSafeInteger(row.height) &&
			row.height > 0 &&
			lembraImageUrl(row.id),
	);
}

async function authorNames(
	client: SupabaseClient,
	profileIds: readonly string[],
): Promise<Map<string, string>> {
	if (!profileIds.length) return new Map();
	const { data, error } = await client
		.from("profiles")
		.select("id,display_name")
		.in("id", [...new Set(profileIds)]);
	if (error) throw new Error(`lembra_author_lookup:${error.message}`);
	return new Map(
		(data ?? []).map((row) => [
			row.id,
			typeof row.display_name === "string" && row.display_name.trim()
				? row.display_name.trim()
				: "Pessoa da campanha",
		]),
	);
}

export async function presentLembraRows(
	client: SupabaseClient,
	rows: readonly LembraReferenceRow[],
	viewerProfileId: string,
): Promise<LembraReference[]> {
	const valid = rows.filter(validLembraReferenceRow);
	const names = await authorNames(
		client,
		valid.flatMap((row) => (row.created_by ? [row.created_by] : [])),
	);

	return valid.flatMap((row) => {
		const imageUrl = lembraImageUrl(row.id);
		if (!imageUrl) return [];
		return [
			{
				id: row.id,
				title: row.title,
				description: row.description,
				author: row.created_by
					? (names.get(row.created_by) ?? "Pessoa da campanha")
					: "Pessoa da campanha",
				authorProfileId: row.created_by,
				createdAt: row.created_at,
				imageUrl,
				mine: row.created_by === viewerProfileId,
			},
		];
	});
}

export async function loadLembraReferences(
	viewerProfileId: string,
): Promise<LembraReference[]> {
	const client = editDataClient();
	if (!client) throw new Error("lembra_data_unavailable");
	const campaignId = await resolveLembraCampaignId(client);
	if (!campaignId) return [];

	const { data, error } = await client
		.from("lembra_references")
		.select(
			"id,campaign_id,title,description,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,created_by,created_at,updated_at",
		)
		.eq("campaign_id", campaignId)
		.eq("status", "active")
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(500);
	if (error) throw new Error(`lembra_reference_lookup:${error.message}`);

	return presentLembraRows(
		client,
		(data ?? []) as LembraReferenceRow[],
		viewerProfileId,
	);
}

export async function loadLembraReferenceRow(
	client: SupabaseClient,
	campaignId: string,
	referenceId: string,
): Promise<LembraReferenceRow | null> {
	const { data, error } = await client
		.from("lembra_references")
		.select(
			"id,campaign_id,title,description,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,created_by,created_at,updated_at",
		)
		.eq("campaign_id", campaignId)
		.eq("id", referenceId)
		.maybeSingle();
	if (error) throw new Error(`lembra_reference_lookup:${error.message}`);
	return (data as LembraReferenceRow | null) ?? null;
}
