import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { lembraDataClient } from "@/integrations/supabase/server";
import {
	isLembraMediaMime,
	isLembraUuid,
	lembraImageUrl,
	type LembraMediaMime,
	type LembraReference,
} from "./model";

export type LembraReferenceRow = Readonly<{
	id: string;
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
	created_by_auth_user_id: string;
	created_by_name: string;
	created_at: string;
	updated_at: string;
	retired_at: string | null;
}>;

const SELECT_COLUMNS =
	"id,title,description,status,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,created_by_auth_user_id,created_by_name,created_at,updated_at,retired_at";

function positiveInteger(value: number | string): number | null {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function validLembraReferenceRow(
	row: LembraReferenceRow,
): row is LembraReferenceRow & Readonly<{ mime_type: LembraMediaMime }> {
	return Boolean(
		isLembraUuid(row.id) &&
			row.status === "active" &&
			row.read_back_verified === true &&
			isLembraMediaMime(row.mime_type) &&
			positiveInteger(row.byte_size) &&
			Number.isSafeInteger(row.width) &&
			row.width > 0 &&
			Number.isSafeInteger(row.height) &&
			row.height > 0 &&
			lembraImageUrl(row.id),
	);
}

export function presentLembraRow(
	row: LembraReferenceRow,
	viewerAuthUserId: string,
): LembraReference | null {
	if (!validLembraReferenceRow(row)) return null;
	const imageUrl = lembraImageUrl(row.id);
	if (!imageUrl) return null;

	return {
		id: row.id,
		title: row.title,
		description: row.description,
		author: row.created_by_name,
		authorAuthUserId: row.created_by_auth_user_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		imageUrl,
		width: row.width,
		height: row.height,
		mine: row.created_by_auth_user_id === viewerAuthUserId,
	};
}

export async function loadLembraReferences(
	viewerAuthUserId: string,
): Promise<LembraReference[]> {
	const client = lembraDataClient();
	if (!client) throw new Error("lembra_data_unavailable");

	const { data, error } = await client
		.from("lembra_references")
		.select(SELECT_COLUMNS)
		.eq("status", "active")
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(1000);
	if (error) throw new Error(`lembra_reference_lookup:${error.message}`);

	return (data ?? []).flatMap((row) => {
		const reference = presentLembraRow(
			row as LembraReferenceRow,
			viewerAuthUserId,
		);
		return reference ? [reference] : [];
	});
}

export async function loadLembraFavoriteIds(
	authUserId: string,
): Promise<string[]> {
	const client = lembraDataClient();
	if (!client) throw new Error("lembra_data_unavailable");

	const { data, error } = await client
		.from("lembra_favorites")
		.select("reference_id")
		.eq("auth_user_id", authUserId);
	if (error) throw new Error(`lembra_favorites_lookup:${error.message}`);

	return (data ?? [])
		.map((row) => row.reference_id)
		.filter((value): value is string => isLembraUuid(value));
}

export async function loadLembraReferenceRow(
	client: SupabaseClient,
	referenceId: string,
): Promise<LembraReferenceRow | null> {
	if (!isLembraUuid(referenceId)) return null;
	const { data, error } = await client
		.from("lembra_references")
		.select(SELECT_COLUMNS)
		.eq("id", referenceId)
		.maybeSingle();
	if (error) throw new Error(`lembra_reference_lookup:${error.message}`);
	return (data as LembraReferenceRow | null) ?? null;
}

export async function insertLembraReference(
	client: SupabaseClient,
	input: Readonly<{
		id: string;
		title: string;
		description: string;
		stagedBucket: string;
		objectKey: string;
		sha256: string;
		mimeType: LembraMediaMime;
		byteSize: number;
		width: number;
		height: number;
		authUserId: string;
		authorName: string;
	}>,
): Promise<LembraReferenceRow> {
	const { data, error } = await client
		.from("lembra_references")
		.insert({
			id: input.id,
			title: input.title,
			description: input.description,
			status: "active",
			staged_bucket: input.stagedBucket,
			object_key: input.objectKey,
			sha256: input.sha256,
			mime_type: input.mimeType,
			byte_size: input.byteSize,
			width: input.width,
			height: input.height,
			read_back_verified: true,
			created_by_auth_user_id: input.authUserId,
			created_by_name: input.authorName,
		})
		.select(SELECT_COLUMNS)
		.single();
	if (error) throw new Error(`lembra_reference_insert:${error.message}`);
	return data as LembraReferenceRow;
}

export async function updateLembraReferenceMetadata(
	client: SupabaseClient,
	referenceId: string,
	title: string,
	description: string,
): Promise<LembraReferenceRow | null> {
	const { data, error } = await client
		.from("lembra_references")
		.update({
			title,
			description,
			updated_at: new Date().toISOString(),
		})
		.eq("id", referenceId)
		.eq("status", "active")
		.select(SELECT_COLUMNS)
		.maybeSingle();
	if (error) throw new Error(`lembra_reference_update:${error.message}`);
	return (data as LembraReferenceRow | null) ?? null;
}

export async function retireLembraReference(
	client: SupabaseClient,
	referenceId: string,
): Promise<boolean> {
	const now = new Date().toISOString();
	const { data, error } = await client
		.from("lembra_references")
		.update({
			status: "retired",
			retired_at: now,
			updated_at: now,
		})
		.eq("id", referenceId)
		.eq("status", "active")
		.select("id");
	if (error) throw new Error(`lembra_reference_retire:${error.message}`);
	return Boolean(data?.length);
}

export async function setLembraFavorite(
	client: SupabaseClient,
	authUserId: string,
	referenceId: string,
	favorite: boolean,
) {
	if (favorite) {
		const { error } = await client.from("lembra_favorites").upsert(
			{ auth_user_id: authUserId, reference_id: referenceId },
			{ onConflict: "auth_user_id,reference_id" },
		);
		if (error) throw new Error(`lembra_favorite_upsert:${error.message}`);
		return;
	}

	const { error } = await client
		.from("lembra_favorites")
		.delete()
		.eq("auth_user_id", authUserId)
		.eq("reference_id", referenceId);
	if (error) throw new Error(`lembra_favorite_delete:${error.message}`);
}
