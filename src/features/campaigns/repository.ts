import "server-only";
import { randomUUID } from "node:crypto";
import {
	editDataClient,
	publishedDataClient,
} from "@/integrations/supabase/server";
import {
	isCampaignLifecycle,
	isCampaignVisibility,
	type ManageableCampaign,
	type PublicCampaign,
} from "./model";

const CAMPAIGN_SELECT =
	"id,slug,public_slug,name,description,lifecycle,visibility,archived_at,updated_at";

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function parsePublicCampaign(row: Record<string, unknown>): PublicCampaign | null {
	const routeKey = stringOrNull(row.public_slug);
	const name = stringOrNull(row.name);
	if (!routeKey || !name) return null;
	return {
		routeKey,
		name,
		description: stringOrNull(row.description),
	};
}

function parseManageableCampaign(
	row: Record<string, unknown>,
): ManageableCampaign | null {
	const id = stringOrNull(row.id);
	const technicalSlug = stringOrNull(row.slug);
	const routeKey = stringOrNull(row.public_slug);
	const name = stringOrNull(row.name);
	const lifecycle = row.lifecycle;
	const visibility = row.visibility;
	const updatedAt = stringOrNull(row.updated_at);
	if (
		!id ||
		!technicalSlug ||
		!routeKey ||
		!name ||
		!updatedAt ||
		!isCampaignLifecycle(lifecycle) ||
		!isCampaignVisibility(visibility)
	)
		return null;

	return {
		id,
		technicalSlug,
		routeKey,
		name,
		description: stringOrNull(row.description),
		lifecycle,
		visibility,
		archivedAt: stringOrNull(row.archived_at),
		updatedAt,
	};
}

function parseCampaignRows<T>(
	data: unknown,
	parser: (row: Record<string, unknown>) => T | null,
): T[] | null {
	if (!Array.isArray(data)) return null;
	const result: T[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
		const parsed = parser(raw as Record<string, unknown>);
		if (!parsed) return null;
		result.push(parsed);
	}
	return result;
}

export type CampaignDirectoryReadResult =
	| Readonly<{ ok: true; campaigns: readonly PublicCampaign[] }>
	| Readonly<{ ok: false; reason: "dependency_unavailable" }>;

export async function readPublicCampaignDirectory(): Promise<CampaignDirectoryReadResult> {
	const client = publishedDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client
		.from("campaigns")
		.select("public_slug,name,description")
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.not("public_slug", "is", null)
		.order("name")
		.order("public_slug");

	if (error) return { ok: false, reason: "dependency_unavailable" };
	const campaigns = parseCampaignRows(data, parsePublicCampaign);
	return campaigns
		? { ok: true, campaigns }
		: { ok: false, reason: "dependency_unavailable" };
}

export async function readCampaignRegistry(): Promise<readonly ManageableCampaign[] | null> {
	const client = editDataClient();
	if (!client) return null;

	const { data, error } = await client
		.from("campaigns")
		.select(CAMPAIGN_SELECT)
		.order("name")
		.order("slug");

	if (error) return null;
	return parseCampaignRows(data, parseManageableCampaign);
}

export type CampaignCreatePersistenceInput = Readonly<{
	name: string;
	technicalSlug: string;
	routeKey: string;
	description: string | null;
	visibility: "public" | "private";
}>;

export type CampaignUpdatePersistenceInput = Readonly<{
	id: string;
	expectedUpdatedAt: string;
	name: string;
	routeKey: string;
	description: string | null;
	visibility: "public" | "private";
}>;

export type CampaignLifecyclePersistenceInput = Readonly<{
	id: string;
	expectedUpdatedAt: string;
	lifecycle: "active" | "archived";
}>;

type PersistResult =
	| Readonly<{ status: "updated"; campaign: ManageableCampaign }>
	| Readonly<{ status: "conflict" | "not_found" | "dependency_unavailable" }>;

function persistenceFailure(error: { code?: string } | null): PersistResult {
	if (error?.code === "23505") return { status: "conflict" };
	return { status: "dependency_unavailable" };
}

export async function createCampaignRegistryEntry(
	input: CampaignCreatePersistenceInput,
): Promise<PersistResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const id = randomUUID();
	const { data, error } = await client
		.from("campaigns")
		.insert({
			id,
			name: input.name,
			slug: input.technicalSlug,
			public_slug: input.routeKey,
			description: input.description,
			metadata: { content_state: "identity_only" },
			lifecycle: "active",
			visibility: input.visibility,
			archived_at: null,
		})
		.select(CAMPAIGN_SELECT)
		.single();

	if (error || !data) return persistenceFailure(error);
	const campaign = parseManageableCampaign(data as Record<string, unknown>);
	return campaign
		? { status: "updated", campaign }
		: { status: "dependency_unavailable" };
}

export async function updateCampaignRegistryEntry(
	input: CampaignUpdatePersistenceInput,
): Promise<PersistResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client
		.from("campaigns")
		.update({
			name: input.name,
			public_slug: input.routeKey,
			description: input.description,
			visibility: input.visibility,
			updated_at: new Date().toISOString(),
		})
		.eq("id", input.id)
		.eq("updated_at", input.expectedUpdatedAt)
		.select(CAMPAIGN_SELECT);

	if (error) return persistenceFailure(error);
	if (!data?.length) {
		const { data: exists, error: lookupError } = await client
			.from("campaigns")
			.select("id")
			.eq("id", input.id)
			.maybeSingle();
		if (lookupError) return { status: "dependency_unavailable" };
		return { status: exists ? "conflict" : "not_found" };
	}
	if (data.length !== 1) return { status: "dependency_unavailable" };

	const campaign = parseManageableCampaign(
		data[0] as Record<string, unknown>,
	);
	return campaign
		? { status: "updated", campaign }
		: { status: "dependency_unavailable" };
}

export async function updateCampaignLifecycle(
	input: CampaignLifecyclePersistenceInput,
): Promise<PersistResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const now = new Date().toISOString();
	const { data, error } = await client
		.from("campaigns")
		.update({
			lifecycle: input.lifecycle,
			archived_at: input.lifecycle === "archived" ? now : null,
			updated_at: now,
		})
		.eq("id", input.id)
		.eq("updated_at", input.expectedUpdatedAt)
		.select(CAMPAIGN_SELECT);

	if (error) return persistenceFailure(error);
	if (!data?.length) {
		const { data: exists, error: lookupError } = await client
			.from("campaigns")
			.select("id")
			.eq("id", input.id)
			.maybeSingle();
		if (lookupError) return { status: "dependency_unavailable" };
		return { status: exists ? "conflict" : "not_found" };
	}
	if (data.length !== 1) return { status: "dependency_unavailable" };

	const campaign = parseManageableCampaign(
		data[0] as Record<string, unknown>,
	);
	return campaign
		? { status: "updated", campaign }
		: { status: "dependency_unavailable" };
}
