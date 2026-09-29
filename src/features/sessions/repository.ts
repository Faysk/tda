import "server-only";
import { cache } from "react";
import { publishedDataClient } from "@/integrations/supabase/server";
import type { SessionArchiveItem } from "./archive";
import {
	CAMPAIGN_SLUG,
	toPublishedSession,
	type PublishedSession,
} from "./model";

const publicMediaColumns =
	"cover_image_url:metadata->>coverImageUrl,hero_image_url:metadata->>heroImageUrl";
const columns = `source_session_id,title,session_date,arc,summary_short,${publicMediaColumns},status,campaigns!inner(slug)`;

const layoutFixtureSessions = [
	{
		id: "layout-contract-latest",
		title: "A memória mais recente do arquivo sintético",
		date: "2026-09-29",
		arc: "Contrato visual E2E",
		summary:
			"Uma memória sintética curta para validar densidade, filtros e navegação sem tocar em conteúdo privado.",
		fullSummary:
			"# Memória mais recente\n\nConteúdo sintético usado somente pelos testes E2E do layout público.",
	},
	{
		id: "layout-contract-synthetic",
		title: "Sessão Sintética de Layout com um título editorial mais longo",
		date: "2026-09-22",
		arc: "Contrato visual E2E",
		summary:
			"Resumo público sintético usado somente para validar a composição da página de sessão e o ritmo do arquivo.",
		fullSummary:
			"# Memória sintética\n\nEste conteúdo existe apenas no ambiente E2E e não representa fatos da campanha.\n\n## Continuidade\n\nO artigo mantém texto suficiente para exercitar a largura de leitura e o fluxo editorial sem acessar dados privados.\n\nA composição precisa continuar confortável com parágrafos, subtítulos e navegação entre memórias.",
	},
	{
		id: "layout-contract-previous",
		title: "Uma memória anterior para validar a navegação",
		date: "2026-09-15",
		arc: "Contrato visual E2E",
		summary:
			"Terceiro registro sintético para garantir que o leitor central possua sessão anterior e próxima.",
		fullSummary:
			"# Memória anterior\n\nConteúdo sintético usado somente pelos testes E2E do layout público.",
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

export async function listPublishedSessions(): Promise<
	PublishedSession[] | null
> {
	if (layoutFixtureEnabled()) return [...layoutFixtureSessions];
	const client = publishedDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("sessions")
		.select(columns)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.order("session_date", { ascending: false, nullsFirst: false })
		.order("source_session_id", { ascending: true })
		.limit(500);
	if (error) throw new Error("Published sessions unavailable");
	return (data ?? []).flatMap((row) => {
		const item = toPublishedSession(row);
		return item ? [item] : [];
	});
}

export async function listPublishedSessionArchive(): Promise<
	SessionArchiveItem[] | null
> {
	return listPublishedSessions();
}

export const findPublishedSession = cache(async (id: string) => {
	if (!id || id.length > 220) return null;
	if (layoutFixtureEnabled()) {
		const fixture = layoutFixtureSessions.find((session) => session.id === id);
		if (fixture) return fixture;
	}
	const client = publishedDataClient();
	if (!client) throw new PublishedSessionUnavailableError();
	const { data, error } = await client
		.from("sessions")
		.select(
			`source_session_id,title,session_date,arc,summary_short,summary_full,${publicMediaColumns},status,campaigns!inner(slug)`,
		)
		.eq("status", "published")
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.eq("source_session_id", id)
		.maybeSingle();
	if (error) throw new PublishedSessionUnavailableError();
	return data ? toPublishedSession(data, true) : null;
});
