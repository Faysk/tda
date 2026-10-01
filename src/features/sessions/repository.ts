import "server-only";
import { cache } from "react";
import {
	isCampaignRegistrySchemaGap,
	type CampaignRegistrySchemaError,
} from "@/features/campaigns/schema-compatibility";
import { publishedDataClient } from "@/integrations/supabase/server";
import type { SessionArchiveItem } from "./archive";
import {
	compareHomeSessions,
	HOME_SESSION_FEED_LIMIT,
} from "./home-feed";
import {
	LEGACY_CAMPAIGN_PUBLIC_SLUG,
	LEGACY_CAMPAIGN_TECHNICAL_SLUG,
	toLegacyPublishedSession,
	toPublishedSession,
	type PublishedSession,
} from "./model";

const PAGE_SIZE = 200;
const publicMediaColumns =
	"cover_image_url:metadata->>coverImageUrl,hero_image_url:metadata->>heroImageUrl";
const campaignColumns =
	"id,name,slug,public_slug,lifecycle,visibility";
const columns = `source_session_id,title,session_date,arc,summary_short,${publicMediaColumns},status,campaigns!inner(${campaignColumns})`;
const legacyColumns = `source_session_id,title,session_date,arc,summary_short,${publicMediaColumns},status,campaigns!inner(id,name,slug)`;
const neighborColumns = `source_session_id,title,arc,${publicMediaColumns},status,campaigns!inner(${campaignColumns})`;
const legacyNeighborColumns = `source_session_id,title,arc,${publicMediaColumns},status,campaigns!inner(id,name,slug)`;

type CampaignRegistryError = CampaignRegistrySchemaError;
type PublishedRow = Parameters<typeof toPublishedSession>[0];
type PublishedClient = NonNullable<ReturnType<typeof publishedDataClient>>;
type PublishedSessionNeighbors = Readonly<{
	previous?: PublishedSession;
	next?: PublishedSession;
}>;
type NeighborQueryResult = Readonly<{
	data: unknown[] | null;
	error: CampaignRegistryError | null;
}>;

const layoutFixtureSessions = [
	{
		id: "shared-session",
		campaignId: "fixture-a",
		campaignSlug: "cronicas-da-mesa",
		campaignName: "Crônicas da Mesa",
		campaignTechnicalSlug: "yuhara-main",
		title: "A memória mais recente do arquivo sintético",
		date: "2026-09-29",
		arc: "Contrato visual E2E",
		summary:
			"Uma memória sintética curta para validar densidade, filtros e navegação sem tocar em conteúdo privado.",
		fullSummary:
			"# Memória mais recente\n\nConteúdo sintético usado somente pelos testes E2E do layout público.",
		coverImage: "/og/default",
	},
	{
		id: "shared-session",
		campaignId: "fixture-b",
		campaignSlug: "antes-que-seja-tarde",
		campaignName:
			"Antes que seja tarde — uma campanha com nome deliberadamente comprido",
		campaignTechnicalSlug: "antes-que-seja-tarde",
		title: "A memória global mais recente vem da campanha B",
		date: "2026-09-30",
		arc: "Contrato visual E2E",
		summary:
			"Fixture A/B com source_session_id repetido para provar isolamento por campanha e agregação global.",
		fullSummary: "# Campanha B\n\nMesmo source ID, outra campanha.",
		heroImage: "/og/default",
	},
	{
		id: "layout-contract-synthetic",
		campaignId: "fixture-a",
		campaignSlug: "cronicas-da-mesa",
		campaignName: "Crônicas da Mesa",
		campaignTechnicalSlug: "yuhara-main",
		title:
			"Sessão Sintética de Layout com um título editorial mais longo",
		date: "2026-09-22",
		arc: "Contrato visual E2E",
		summary:
			"Resumo público sintético usado somente para validar a composição da página de sessão e o ritmo do arquivo.",
		fullSummary:
			"# Memória sintética\n\nEste conteúdo existe apenas no ambiente E2E e não representa fatos da campanha.\n\n## Continuidade\n\nO artigo mantém texto suficiente para exercitar a largura de leitura e o fluxo editorial sem acessar dados privados.\n\nA composição precisa continuar confortável com parágrafos, subtítulos e navegação entre memórias.",
	},
	{
		id: "layout-contract-previous",
		campaignId: "fixture-a",
		campaignSlug: "cronicas-da-mesa",
		campaignName: "Crônicas da Mesa",
		campaignTechnicalSlug: "yuhara-main",
		title: "Uma memória anterior para validar a navegação",
		date: "2026-09-15",
		arc: "Contrato visual E2E",
		summary:
			"Terceiro registro sintético para garantir navegação scoped.",
		fullSummary: "# Memória anterior\n\nConteúdo sintético.",
	},
] as const satisfies readonly PublishedSession[];

function layoutFixtureEnabled() {
	return process.env.TDA_E2E_FIXTURES === "true";
}

export class PublishedSessionUnavailableError extends Error {
	constructor() {
		super("Published session unavailable");
		this.name = "PublishedSessionUnavailableError";
	}
}

class CampaignRegistrySchemaGapError extends Error {
	constructor() {
		super("Campaign registry schema gap");
		this.name = "CampaignRegistrySchemaGapError";
	}
}

function fixtureArchive(campaignSlug?: string) {
	return layoutFixtureSessions.filter(
		(session) => !campaignSlug || session.campaignSlug === campaignSlug,
	);
}

function firstPublishedSession(
	data: unknown[] | null,
	legacy: boolean,
): PublishedSession | undefined {
	for (const row of data ?? []) {
		if (!row || typeof row !== "object") continue;
		const item = legacy
			? toLegacyPublishedSession(row as PublishedRow)
			: toPublishedSession(row as PublishedRow);
		if (item) return item;
	}
	return undefined;
}

function baseNeighborQuery(
	client: PublishedClient,
	session: PublishedSession,
	legacy: boolean,
) {
	const query = client
		.from("sessions")
		.select(legacy ? legacyNeighborColumns : neighborColumns)
		.eq("status", "published");

	if (legacy) {
		return query.eq("campaigns.slug", LEGACY_CAMPAIGN_TECHNICAL_SLUG);
	}

	return query
		.eq("campaigns.lifecycle", "active")
		.eq("campaigns.visibility", "public")
		.eq("campaigns.public_slug", session.campaignSlug);
}

async function readNeighborCandidate(
	query: PromiseLike<NeighborQueryResult>,
	legacy: boolean,
) {
	const { data, error } = await query;
	if (error) {
		if (!legacy && isCampaignRegistrySchemaGap(error)) {
			throw new CampaignRegistrySchemaGapError();
		}
		throw new PublishedSessionUnavailableError();
	}
	return firstPublishedSession(data, legacy);
}

async function queryPublishedSessionNeighbors(
	client: PublishedClient,
	session: PublishedSession,
	legacy: boolean,
): Promise<PublishedSessionNeighbors> {
	if (session.date) {
		let previous = await readNeighborCandidate(
			baseNeighborQuery(client, session, legacy)
				.eq("session_date", session.date)
				.gt("source_session_id", session.id)
				.order("source_session_id", { ascending: true })
				.order("id", { ascending: true })
				.limit(1),
			legacy,
		);

		if (!previous) {
			previous = await readNeighborCandidate(
				baseNeighborQuery(client, session, legacy)
					.lt("session_date", session.date)
					.order("session_date", {
						ascending: false,
						nullsFirst: false,
					})
					.order("source_session_id", { ascending: true })
					.order("id", { ascending: true })
					.limit(1),
				legacy,
			);
		}

		if (!previous) {
			previous = await readNeighborCandidate(
				baseNeighborQuery(client, session, legacy)
					.is("session_date", null)
					.order("source_session_id", { ascending: true })
					.order("id", { ascending: true })
					.limit(1),
				legacy,
			);
		}

		let next = await readNeighborCandidate(
			baseNeighborQuery(client, session, legacy)
				.eq("session_date", session.date)
				.lt("source_session_id", session.id)
				.order("source_session_id", { ascending: false })
				.order("id", { ascending: false })
				.limit(1),
			legacy,
		);

		if (!next) {
			next = await readNeighborCandidate(
				baseNeighborQuery(client, session, legacy)
					.gt("session_date", session.date)
					.order("session_date", {
						ascending: true,
						nullsFirst: false,
					})
					.order("source_session_id", { ascending: false })
					.order("id", { ascending: false })
					.limit(1),
				legacy,
			);
		}

		return { previous, next };
	}

	const previous = await readNeighborCandidate(
		baseNeighborQuery(client, session, legacy)
			.is("session_date", null)
			.gt("source_session_id", session.id)
			.order("source_session_id", { ascending: true })
			.order("id", { ascending: true })
			.limit(1),
		legacy,
	);

	let next = await readNeighborCandidate(
		baseNeighborQuery(client, session, legacy)
			.is("session_date", null)
			.lt("source_session_id", session.id)
			.order("source_session_id", { ascending: false })
			.order("id", { ascending: false })
			.limit(1),
		legacy,
	);

	if (!next) {
		next = await readNeighborCandidate(
			baseNeighborQuery(client, session, legacy)
				.not("session_date", "is", null)
				.order("session_date", {
					ascending: true,
					nullsFirst: false,
				})
				.order("source_session_id", { ascending: false })
				.order("id", { ascending: false })
				.limit(1),
			legacy,
		);
	}

	return { previous, next };
}

async function queryHomeArchive(): Promise<PublishedSession[] | null> {
	if (layoutFixtureEnabled()) {
		return [...fixtureArchive()]
			.sort(compareHomeSessions)
			.slice(0, HOME_SESSION_FEED_LIMIT);
	}

	const client = publishedDataClient();
	if (!client) return null;

	const { data, error } = await client
		.from("sessions")
		.select(columns)
		.eq("status", "published")
		.eq("campaigns.lifecycle", "active")
		.eq("campaigns.visibility", "public")
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("campaigns(public_slug)", { ascending: true })
		.order("source_session_id", { ascending: true })
		.order("id", { ascending: true })
		.limit(HOME_SESSION_FEED_LIMIT);

	if (error) {
		if (isCampaignRegistrySchemaGap(error)) return queryLegacyHomeArchive();
		throw new PublishedSessionUnavailableError();
	}

	return (data ?? []).flatMap((row) => {
		const item = toPublishedSession(row);
		return item ? [item] : [];
	});
}

async function queryLegacyHomeArchive(): Promise<PublishedSession[] | null> {
	const client = publishedDataClient();
	if (!client) return null;

	const { data, error } = await client
		.from("sessions")
		.select(legacyColumns)
		.eq("status", "published")
		.eq("campaigns.slug", LEGACY_CAMPAIGN_TECHNICAL_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.order("id", { ascending: true })
		.limit(HOME_SESSION_FEED_LIMIT);

	if (error) throw new PublishedSessionUnavailableError();

	return (data ?? []).flatMap((row) => {
		const item = toLegacyPublishedSession(row);
		return item ? [item] : [];
	});
}

async function queryArchive(
	campaignSlug?: string,
): Promise<PublishedSession[] | null> {
	if (layoutFixtureEnabled()) return [...fixtureArchive(campaignSlug)];
	const client = publishedDataClient();
	if (!client) return null;
	const result: PublishedSession[] = [];

	for (let from = 0; ; from += PAGE_SIZE) {
		let query = client
			.from("sessions")
			.select(columns)
			.eq("status", "published")
			.eq("campaigns.lifecycle", "active")
			.eq("campaigns.visibility", "public")
			.order("session_date", { ascending: false, nullsFirst: false })
			.order("source_session_id", { ascending: true })
			.order("id", { ascending: true })
			.range(from, from + PAGE_SIZE - 1);

		if (campaignSlug) {
			query = query.eq("campaigns.public_slug", campaignSlug);
		}

		const { data, error } = await query;
		if (error) {
			if (isCampaignRegistrySchemaGap(error)) {
				return queryLegacyArchive(campaignSlug);
			}
			throw new PublishedSessionUnavailableError();
		}

		const rows = (data ?? []).flatMap((row) => {
			const item = toPublishedSession(row);
			return item ? [item] : [];
		});
		result.push(...rows);
		if ((data ?? []).length < PAGE_SIZE) break;
	}

	return result;
}

async function queryLegacyArchive(
	campaignSlug?: string,
): Promise<PublishedSession[] | null> {
	if (
		campaignSlug &&
		campaignSlug !== LEGACY_CAMPAIGN_PUBLIC_SLUG
	) {
		return [];
	}

	const client = publishedDataClient();
	if (!client) return null;
	const result: PublishedSession[] = [];

	for (let from = 0; ; from += PAGE_SIZE) {
		const { data, error } = await client
			.from("sessions")
			.select(legacyColumns)
			.eq("status", "published")
			.eq("campaigns.slug", LEGACY_CAMPAIGN_TECHNICAL_SLUG)
			.order("session_date", {
				ascending: false,
				nullsFirst: false,
			})
			.order("source_session_id", { ascending: true })
			.order("id", { ascending: true })
			.range(from, from + PAGE_SIZE - 1);

		if (error) throw new PublishedSessionUnavailableError();

		result.push(
			...(data ?? []).flatMap((row) => {
				const item = toLegacyPublishedSession(row);
				return item ? [item] : [];
			}),
		);
		if ((data ?? []).length < PAGE_SIZE) break;
	}

	return result;
}

export async function listHomePublishedSessions(): Promise<
	PublishedSession[] | null
> {
	return queryHomeArchive();
}

export async function listPublishedSessions(
	campaignSlug?: string,
): Promise<PublishedSession[] | null> {
	return queryArchive(campaignSlug);
}

export async function listPublishedSessionArchive(
	campaignSlug?: string,
): Promise<SessionArchiveItem[] | null> {
	return listPublishedSessions(campaignSlug);
}

export const findPublishedSession = cache(
	async (campaignSlug: string, id: string) => {
		if (
			!campaignSlug ||
			campaignSlug.length > 220 ||
			!id ||
			id.length > 220
		) {
			return null;
		}

		if (layoutFixtureEnabled()) {
			return (
				fixtureArchive(campaignSlug).find(
					(session) => session.id === id,
				) ?? null
			);
		}

		const client = publishedDataClient();
		if (!client) throw new PublishedSessionUnavailableError();

		const { data, error } = await client
			.from("sessions")
			.select(
				`source_session_id,title,session_date,arc,summary_short,summary_full,${publicMediaColumns},status,campaigns!inner(${campaignColumns})`,
			)
			.eq("status", "published")
			.eq("campaigns.lifecycle", "active")
			.eq("campaigns.visibility", "public")
			.eq("campaigns.public_slug", campaignSlug)
			.eq("source_session_id", id)
			.maybeSingle();

		if (error) {
			if (
				campaignSlug !== LEGACY_CAMPAIGN_PUBLIC_SLUG ||
				!isCampaignRegistrySchemaGap(error)
			) {
				throw new PublishedSessionUnavailableError();
			}

			const legacy = await client
				.from("sessions")
				.select(
					`source_session_id,title,session_date,arc,summary_short,summary_full,${publicMediaColumns},status,campaigns!inner(id,name,slug)`,
				)
				.eq("status", "published")
				.eq(
					"campaigns.slug",
					LEGACY_CAMPAIGN_TECHNICAL_SLUG,
				)
				.eq("source_session_id", id)
				.maybeSingle();

			if (legacy.error) {
				throw new PublishedSessionUnavailableError();
			}

			return legacy.data
				? toLegacyPublishedSession(legacy.data, true)
				: null;
		}

		return data ? toPublishedSession(data, true) : null;
	},
);

export async function findPublishedSessionNeighbors(
	session: PublishedSession,
): Promise<PublishedSessionNeighbors> {
	if (layoutFixtureEnabled()) {
		const archive = [...fixtureArchive(session.campaignSlug)].sort(
			compareHomeSessions,
		);
		const currentIndex = archive.findIndex(
			(item) => item.id === session.id,
		);
		if (currentIndex < 0) return {};
		return {
			previous: archive[currentIndex + 1],
			next: currentIndex > 0 ? archive[currentIndex - 1] : undefined,
		};
	}

	const client = publishedDataClient();
	if (!client) throw new PublishedSessionUnavailableError();

	try {
		return await queryPublishedSessionNeighbors(
			client,
			session,
			false,
		);
	} catch (error) {
		if (
			error instanceof CampaignRegistrySchemaGapError &&
			session.campaignSlug === LEGACY_CAMPAIGN_PUBLIC_SLUG
		) {
			return queryPublishedSessionNeighbors(
				client,
				session,
				true,
			);
		}
		throw error;
	}
}

export const findLegacyPublishedSession = cache(async (id: string) => {
	if (!id || id.length > 220) return null;

	if (layoutFixtureEnabled()) {
		const matches = layoutFixtureSessions.filter(
			(session) => session.id === id,
		);
		if (matches.length === 0) {
			throw new PublishedSessionUnavailableError();
		}
		return matches.length === 1 &&
			matches[0]?.campaignTechnicalSlug ===
				LEGACY_CAMPAIGN_TECHNICAL_SLUG
			? matches[0]
			: null;
	}

	const archive = await queryArchive();
	if (!archive) throw new PublishedSessionUnavailableError();
	const matches = archive.filter((session) => session.id === id);
	return matches.length === 1 &&
		matches[0]?.campaignTechnicalSlug ===
			LEGACY_CAMPAIGN_TECHNICAL_SLUG
		? matches[0]
		: null;
});
