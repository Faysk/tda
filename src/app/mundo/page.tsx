import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import { buildPublicMetadata } from "@/config/public-metadata";
import { WorldExplorerClient } from "@/features/world-explorer/components/world-explorer-client";
import { DANDELION_WORLD_DEMO } from "@/features/world-explorer/fixtures/dandelion";
import {
	buildWorldProjection,
	resolveWorldFocusId,
} from "@/features/world-explorer/projection";

type MundoPageProps = {
	searchParams: Promise<{ foco?: string | string[] }>;
};

function requestedFocusFrom(
	query: Awaited<MundoPageProps["searchParams"]>,
): string | undefined {
	return Array.isArray(query.foco) ? query.foco[0] : query.foco;
}

function isExplicitDemoFocus(requestedFocus: string | undefined, focusId: string) {
	const normalized = requestedFocus?.trim().toLocaleLowerCase("pt-BR");
	if (!normalized) return false;
	const focus = DANDELION_WORLD_DEMO.nodes.find((node) => node.id === focusId);
	if (!focus) return false;
	return (
		focus.id.toLocaleLowerCase("pt-BR") === normalized ||
		focus.slug?.toLocaleLowerCase("pt-BR") === normalized
	);
}

export async function generateMetadata({
	searchParams,
}: MundoPageProps): Promise<Metadata> {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const focusId = resolveWorldFocusId(DANDELION_WORLD_DEMO, requestedFocus);
	const focus = DANDELION_WORLD_DEMO.nodes.find((node) => node.id === focusId);
	const shareFocusedEntity = Boolean(
		focus?.slug &&
			focus.id !== "dandelion" &&
			isExplicitDemoFocus(requestedFocus, focusId),
	);
	const pathname = shareFocusedEntity
		? `/mundo?foco=${encodeURIComponent(focus?.slug ?? "")}`
		: "/mundo";
	const title = shareFocusedEntity
		? `${focus?.label ?? "Memória"} · Ecos da Jornada — demonstração`
		: "Ecos da Jornada — demonstração";
	const description = shareFocusedEntity
		? `Demonstração do World Explorer do TDA com ${focus?.label ?? "uma memória"} em foco. As relações exibidas neste recorte não são canon.`
		: "Demonstração do World Explorer do TDA. As relações exibidas neste recorte visual não são canon.";

	return buildPublicMetadata({
		title,
		description,
		pathname,
	});
}

export default async function MundoPage({ searchParams }: MundoPageProps) {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const focusId = resolveWorldFocusId(DANDELION_WORLD_DEMO, requestedFocus);
	const projection = buildWorldProjection(DANDELION_WORLD_DEMO, focusId);

	return <WorldExplorerClient projection={projection} />;
}
