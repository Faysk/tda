import "server-only";
import { verifiedCampaignCover } from "./media";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { LEGACY_CAMPAIGN_NAME, LEGACY_CAMPAIGN_PUBLIC_SLUG, LEGACY_CAMPAIGN_TECHNICAL_SLUG } from "@/features/sessions/model";
import { isCampaignRegistrySchemaGap } from "./schema-compatibility";
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

const E2E_PUBLIC_CAMPAIGNS = [
	{
		routeKey: "cronicas-da-mesa",
		technicalSlug: "yuhara-main",
		name: "Crônicas da Mesa",
		description: "Uma campanha sintética pública usada somente no contrato E2E.",
	},
	{
		routeKey: "antes-que-seja-tarde",
		technicalSlug: "antes-que-seja-tarde",
		name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		description: null,
	},
] as const;

function campaignFixtureEnabled() {
	return process.env.TDA_E2E_FIXTURES === "true";
}

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
		...(typeof row.id === "string" && typeof row.slug === "string" && verifiedCampaignCover(row.id, row.slug)
			? { cover: verifiedCampaignCover(row.id, row.slug) } : {}),
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

export type ResolvedPublicCampaign = PublicCampaign &
	Readonly<{ technicalSlug: string }>;

export type PublicCampaignResolution =
	| Readonly<{
		ok: true;
		campaign: ResolvedPublicCampaign;
		canonical: boolean;
	  }>
	| Readonly<{ ok: false; reason: "not_found" | "dependency_unavailable" }>;

export const resolvePublicCampaignRoute = cache(async function resolvePublicCampaignRoute(
	routeKey: string,
): Promise<PublicCampaignResolution> {
	if (campaignFixtureEnabled()) {
		const fixture = E2E_PUBLIC_CAMPAIGNS.find(
			(campaign) => campaign.routeKey === routeKey || campaign.technicalSlug === routeKey,
		);
		return fixture
			? { ok: true, campaign: fixture, canonical: fixture.routeKey === routeKey }
			: { ok: false, reason: "not_found" };
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routeKey))
		return { ok: false, reason: "not_found" };
	const client = publishedDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const canonical = await client
		.from("campaigns")
		.select("slug,public_slug,name,description")
		.eq("public_slug", routeKey)
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.maybeSingle();
	if (canonical.error && isCampaignRegistrySchemaGap(canonical.error)) {
		if (routeKey !== LEGACY_CAMPAIGN_PUBLIC_SLUG && routeKey !== LEGACY_CAMPAIGN_TECHNICAL_SLUG)
			return { ok: false, reason: "not_found" };
		const legacy = await readLegacyPublicCampaign();
		if (!legacy.ok) return legacy;
		return legacy.campaign
			? { ok: true, campaign: legacy.campaign, canonical: routeKey === LEGACY_CAMPAIGN_PUBLIC_SLUG }
			: { ok: false, reason: "not_found" };
	}
	if (canonical.error)
		return { ok: false, reason: "dependency_unavailable" };
	if (canonical.data) {
		const parsed = parsePublicCampaign(
			canonical.data as Record<string, unknown>,
		);
		const technicalSlug = stringOrNull(
			(canonical.data as Record<string, unknown>).slug,
		);
		return parsed && technicalSlug
			? {
					ok: true,
					campaign: { ...parsed, technicalSlug },
					canonical: true,
				}
			: { ok: false, reason: "dependency_unavailable" };
	}

	const alias = await client
		.from("campaign_public_route_aliases")
		.select("campaign_id")
		.eq("route_key", routeKey)
		.is("retired_at", null)
		.maybeSingle();
	if (alias.error)
		return { ok: false, reason: "dependency_unavailable" };
	if (!alias.data?.campaign_id) return { ok: false, reason: "not_found" };

	const resolved = await client
		.from("campaigns")
		.select("slug,public_slug,name,description")
		.eq("id", alias.data.campaign_id)
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.maybeSingle();
	if (resolved.error)
		return { ok: false, reason: "dependency_unavailable" };
	if (!resolved.data) return { ok: false, reason: "not_found" };

	const parsed = parsePublicCampaign(resolved.data as Record<string, unknown>);
	const technicalSlug = stringOrNull(
		(resolved.data as Record<string, unknown>).slug,
	);
	return parsed && technicalSlug
		? {
				ok: true,
				campaign: { ...parsed, technicalSlug },
				canonical: false,
			}
		: { ok: false, reason: "dependency_unavailable" };
});

async function readLegacyPublicCampaign(): Promise<
	| { ok: true; campaign: ResolvedPublicCampaign | null }
	| { ok: false; reason: "dependency_unavailable" }
> {
	const client = publishedDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };
	const { data, error } = await client.from("campaigns").select("slug,description")
		.eq("slug", LEGACY_CAMPAIGN_TECHNICAL_SLUG).maybeSingle();
	if (error) return { ok: false, reason: "dependency_unavailable" };
	if (!data) return { ok: true, campaign: null };
	if (data.slug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG) return { ok: false, reason: "dependency_unavailable" };
	return { ok: true, campaign: {
		routeKey: LEGACY_CAMPAIGN_PUBLIC_SLUG, technicalSlug: LEGACY_CAMPAIGN_TECHNICAL_SLUG,
		name: LEGACY_CAMPAIGN_NAME, description: stringOrNull(data.description),
	} };
}

export type CampaignDirectoryReadResult =
	| Readonly<{ ok: true; campaigns: readonly PublicCampaign[] }>
	| Readonly<{ ok: false; reason: "dependency_unavailable" }>;

export async function readPublicCampaignDirectory(): Promise<CampaignDirectoryReadResult> {
	if (campaignFixtureEnabled()) {
		return {
			ok: true,
			campaigns: E2E_PUBLIC_CAMPAIGNS.map(
				({ technicalSlug: _technicalSlug, ...campaign }) => campaign,
			),
		};
	}
	const client = publishedDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client
		.from("campaigns")
		.select("id,slug,public_slug,name,description")
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.not("public_slug", "is", null)
		.order("name")
		.order("public_slug");

	if (error && isCampaignRegistrySchemaGap(error)) {
		const legacy = await readLegacyPublicCampaign();
		if (!legacy.ok) return legacy;
		return { ok: true, campaigns: legacy.campaign ? [{
			routeKey: legacy.campaign.routeKey, name: legacy.campaign.name,
			description: legacy.campaign.description,
		}] : [] };
	}
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
