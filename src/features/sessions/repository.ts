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

export class PublishedSessionUnavailableError extends Error {
	constructor() {
		super("Published session unavailable");
		this.name = "PublishedSessionUnavailableError";
	}
}

const E2E_PUBLIC_SESSIONS = [
	{
		id: "layout-contract-synthetic",
		title: "Sessão Sintética de Layout",
		date: "2026-09-29",
		arc: "Contrato visual E2E",
		summary:
			"Resumo público sintético usado somente para validar a composição do arquivo e da página de leitura.",
		fullSummary:
			"# Memória sintética\n\nEste conteúdo existe apenas no ambiente E2E e não representa fatos da campanha.\n\n## Continuidade\n\nA leitura mantém texto suficiente para exercitar largura, hierarquia e navegação sem acessar dados privados.",
	},
	{
		id: "layout-contract-previous",
		title: "Memória Sintética Anterior",
		date: "2026-09-22",
		arc: "Contrato visual E2E",
		summary:
			"Segunda memória sintética para exercitar a navegação anterior e o arquivo público.",
		fullSummary:
			"# Memória sintética anterior\n\nFixture sem conteúdo privado.",
	},
] as const satisfies readonly PublishedSession[];

function e2ePublicSessions() {
	if (process.env.TDA_E2E_FIXTURES !== "true") return null;
	return E2E_PUBLIC_SESSIONS;
}

export async function listPublishedSessions(): Promise<
	PublishedSession[] | null
> {
	const fixtures = e2ePublicSessions();
	if (fixtures) {
		return fixtures.map(({ fullSummary: _fullSummary, ...session }) => session);
	}
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
	const fixtures = e2ePublicSessions();
	if (fixtures) {
		return fixtures.find((session) => session.id === id) ?? null;
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
