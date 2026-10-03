import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import {
	editDataClient,
	publishedDataClient,
} from "@/integrations/supabase/server";
import {
	readCampaignCoverStates,
	readPublicCampaignCovers,
} from "./campaign-cover-repository";
import {
	isCampaignLifecycle,
	isCampaignVisibility,
	type ManageableCampaign,
	type PublicCampaign,
} from "./model";
import { isCampaignRegistrySchemaGap } from "./schema-compatibility";

const E2E_CAMPAIGNS = [
	{
		routeKey: "cronicas-da-mesa",
		technicalSlug: "yuhara-main",
		name: "Crônicas da Mesa",
		description: "Uma campanha sintética pública usada somente no contrato E2E.",
		coverImage: "/og/default",
		lifecycle: "active",
		visibility: "public",
	},
	{
		routeKey: "antes-que-seja-tarde",
		technicalSlug: "antes-que-seja-tarde",
		name: "Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		description: null,
		coverImage: null,
		lifecycle: "active",
		visibility: "public",
	},
	{
		routeKey: "fixture-private",
		technicalSlug: "fixture-private",
		name: "Fixture privada",
		description: null,
		coverImage: "/og/default",
		lifecycle: "active",
		visibility: "private",
	},
	{
		routeKey: "fixture-archived",
		technicalSlug: "fixture-archived",
		name: "Fixture arquivada",
		description: null,
		coverImage: "/og/default",
		lifecycle: "archived",
		visibility: "public",
	},
] as const;

const E2E_CAMPAIGN_ALIASES = [
	{
		routeKey: "cronicas-da-mesa-antiga",
		campaignRouteKey: "cronicas-da-mesa",
		retired: false,
	},
	{
		routeKey: "cronicas-da-mesa-intermediaria",
		campaignRouteKey: "cronicas-da-mesa",
		retired: false,
	},
	{
		routeKey: "cronicas-da-mesa-retirada",
		campaignRouteKey: "cronicas-da-mesa",
		retired: true,
	},
	{
		routeKey: "fixture-private-antiga",
		campaignRouteKey: "fixture-private",
		retired: false,
	},
	{
		routeKey: "fixture-archived-antiga",
		campaignRouteKey: "fixture-archived",
		retired: false,
	},
	{
		routeKey: "fixture-dependency-unavailable",
		campaignRouteKey: "fixture-missing",
		retired: false,
	},
] as const;

function campaignFixtureEnabled() {
	return process.env.TDA_E2E_FIXTURES === "true";
}

const CAMPAIGN_SELECT =
	"id,slug,public_slug,name,description,lifecycle,visibility,archived_at,updated_at";
const LEGACY_CAMPAIGN_TECHNICAL_SLUG = "yuhara-main";
const LEGACY_CAMPAIGN_PUBLIC_SLUG = "cronicas-da-mesa";

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function parsePublicCampaign(
	row: Record<string, unknown>,
	coverImage: string | null = null,
): PublicCampaign | null {
	const routeKey = stringOrNull(row.public_slug);
	const name = stringOrNull(row.name);
	if (!routeKey || !name) return null;
	return {
		routeKey,
		name,
		description: stringOrNull(row.description),
		coverImage,
	};
}

function parseManageableCampaign(
	row: Record<string, unknown>,
	coverImage: string | null = null,
	hasCoverBinding = false,
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
		coverImage,
		hasCoverBinding,
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

type PublishedCampaignClient = NonNullable<ReturnType<typeof publishedDataClient>>;

type LegacyPublicCampaignRead =
	| Readonly<{ ok: true; campaign: ResolvedPublicCampaign | null }>
	| Readonly<{ ok: false }>;

async function readLegacyPublicCampaign(
	client: PublishedCampaignClient,
): Promise<LegacyPublicCampaignRead> {
	const { data, error } = await client
		.from("campaigns")
		.select("slug,name,description")
		.eq("slug", LEGACY_CAMPAIGN_TECHNICAL_SLUG)
		.maybeSingle();

	if (error) return { ok: false };
	if (!data) return { ok: true, campaign: null };

	const row = data as Record<string, unknown>;
	const technicalSlug = stringOrNull(row.slug);
	const name = stringOrNull(row.name);
	if (technicalSlug !== LEGACY_CAMPAIGN_TECHNICAL_SLUG || !name) {
		return { ok: false };
	}

	return {
		ok: true,
		campaign: {
			technicalSlug,
			routeKey: LEGACY_CAMPAIGN_PUBLIC_SLUG,
			name,
			description: stringOrNull(row.description),
			coverImage: null,
		},
	};
}

async function resolvePublicCampaignRouteUncached(
	routeKey: string,
): Promise<PublicCampaignResolution> {
	if (campaignFixtureEnabled()) {
		const canonical = E2E_CAMPAIGNS.find(
			(campaign) => campaign.routeKey === routeKey,
		);
		if (canonical) {
			if (
				canonical.lifecycle !== "active" ||
				canonical.visibility !== "public"
			)
				return { ok: false, reason: "not_found" };
			const { lifecycle: _lifecycle, visibility: _visibility, ...campaign } =
				canonical;
			return { ok: true, campaign, canonical: true };
		}

		const alias = E2E_CAMPAIGN_ALIASES.find(
			(candidate) => candidate.routeKey === routeKey && !candidate.retired,
		);
		if (!alias) return { ok: false, reason: "not_found" };
		const resolved = E2E_CAMPAIGNS.find(
			(campaign) => campaign.routeKey === alias.campaignRouteKey,
		);
		if (!resolved) return { ok: false, reason: "dependency_unavailable" };
		if (
			resolved.lifecycle !== "active" ||
			resolved.visibility !== "public"
		)
			return { ok: false, reason: "not_found" };
		const { lifecycle: _lifecycle, visibility: _visibility, ...campaign } =
			resolved;
		return { ok: true, campaign, canonical: false };
	}
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(routeKey))
		return { ok: false, reason: "not_found" };
	const client = publishedDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const canonical = await client
		.from("campaigns")
		.select("id,slug,public_slug,name,description")
		.eq("public_slug", routeKey)
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.maybeSingle();
	if (canonical.error) {
		if (!isCampaignRegistrySchemaGap(canonical.error)) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		if (
			routeKey !== LEGACY_CAMPAIGN_PUBLIC_SLUG &&
			routeKey !== LEGACY_CAMPAIGN_TECHNICAL_SLUG
		) {
			return { ok: false, reason: "not_found" };
		}
		const legacy = await readLegacyPublicCampaign(client);
		if (!legacy.ok) return { ok: false, reason: "dependency_unavailable" };
		if (!legacy.campaign) return { ok: false, reason: "not_found" };
		return {
			ok: true,
			campaign: legacy.campaign,
			canonical: routeKey === LEGACY_CAMPAIGN_PUBLIC_SLUG,
		};
	}
	if (canonical.data) {
		const row = canonical.data as Record<string, unknown>;
		const campaignId = stringOrNull(row.id);
		const technicalSlug = stringOrNull(row.slug);
		if (!campaignId || !technicalSlug)
			return { ok: false, reason: "dependency_unavailable" };
		try {
			const covers = await readPublicCampaignCovers(client, [
				{ campaignId, campaignMediaKey: technicalSlug },
			]);
			const parsed = parsePublicCampaign(row, covers.get(campaignId) ?? null);
			return parsed
				? { ok: true, campaign: { ...parsed, technicalSlug }, canonical: true }
				: { ok: false, reason: "dependency_unavailable" };
		} catch {
			return { ok: false, reason: "dependency_unavailable" };
		}
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
		.select("id,slug,public_slug,name,description")
		.eq("id", alias.data.campaign_id)
		.eq("lifecycle", "active")
		.eq("visibility", "public")
		.maybeSingle();
	if (resolved.error)
		return { ok: false, reason: "dependency_unavailable" };
	if (!resolved.data) return { ok: false, reason: "not_found" };

	const row = resolved.data as Record<string, unknown>;
	const campaignId = stringOrNull(row.id);
	const technicalSlug = stringOrNull(row.slug);
	if (!campaignId || !technicalSlug)
		return { ok: false, reason: "dependency_unavailable" };
	try {
		const covers = await readPublicCampaignCovers(client, [
			{ campaignId, campaignMediaKey: technicalSlug },
		]);
		const parsed = parsePublicCampaign(row, covers.get(campaignId) ?? null);
		return parsed
			? { ok: true, campaign: { ...parsed, technicalSlug }, canonical: false }
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export const resolvePublicCampaignRoute = cache(
	resolvePublicCampaignRouteUncached,
);

export type CampaignDirectoryReadResult =
	| Readonly<{
		ok: true;
		campaigns: readonly PublicCampaign[];
		registryMode: "canonical" | "legacy";
	  }>
	| Readonly<{ ok: false; reason: "dependency_unavailable" }>;

export async function readPublicCampaignDirectory(): Promise<CampaignDirectoryReadResult> {
	if (campaignFixtureEnabled()) {
		return {
			ok: true,
			registryMode: "canonical",
			campaigns: E2E_CAMPAIGNS.filter(
				(campaign) =>
					campaign.lifecycle === "active" && campaign.visibility === "public",
			).map(
				({
					technicalSlug: _technicalSlug,
					lifecycle: _lifecycle,
					visibility: _visibility,
					...campaign
				}) => campaign,
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

	if (error) {
		if (!isCampaignRegistrySchemaGap(error)) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		const legacy = await readLegacyPublicCampaign(client);
		if (!legacy.ok) return { ok: false, reason: "dependency_unavailable" };
		return {
			ok: true,
			registryMode: "legacy",
			campaigns: legacy.campaign
				? [
						{
							routeKey: legacy.campaign.routeKey,
							name: legacy.campaign.name,
							description: legacy.campaign.description,
							coverImage: legacy.campaign.coverImage,
						},
					]
				: [],
		};
	}
	if (!Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };
	const rows = data as Record<string, unknown>[];
	const targets = rows
		.map((row) => {
			const campaignId = stringOrNull(row.id);
			const campaignMediaKey = stringOrNull(row.slug);
			return campaignId && campaignMediaKey ? { campaignId, campaignMediaKey } : null;
		})
		.filter(
			(target): target is { campaignId: string; campaignMediaKey: string } =>
				target !== null,
		);
	if (targets.length !== rows.length)
		return { ok: false, reason: "dependency_unavailable" };
	try {
		const covers = await readPublicCampaignCovers(client, targets);
		const campaigns = rows.map((row, index) =>
			parsePublicCampaign(row, covers.get(targets[index].campaignId) ?? null),
		);
		return campaigns.every((campaign): campaign is PublicCampaign => campaign !== null)
			? { ok: true, campaigns, registryMode: "canonical" }
			: { ok: false, reason: "dependency_unavailable" };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}

export async function readCampaignRegistry(): Promise<readonly ManageableCampaign[] | null> {
	const client = editDataClient();
	if (!client) return null;

	const { data, error } = await client
		.from("campaigns")
		.select(CAMPAIGN_SELECT)
		.order("name")
		.order("slug");

	if (error || !Array.isArray(data)) return null;
	const rows = data as Record<string, unknown>[];
	const targets = rows
		.map((row) => {
			const campaignId = stringOrNull(row.id);
			const campaignMediaKey = stringOrNull(row.slug);
			return campaignId && campaignMediaKey ? { campaignId, campaignMediaKey } : null;
		})
		.filter(
			(target): target is { campaignId: string; campaignMediaKey: string } =>
				target !== null,
		);
	if (targets.length !== rows.length) return null;
	try {
		const coverStates = await readCampaignCoverStates(client, targets);
		const campaigns = rows.map((row, index) => {
			const state = coverStates.get(targets[index].campaignId);
			return parseManageableCampaign(
				row,
				state?.publicUrl ?? null,
				state?.hasBinding ?? false,
			);
		});
		return campaigns.every((campaign): campaign is ManageableCampaign => campaign !== null)
			? campaigns
			: null;
	} catch {
		return null;
	}
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
