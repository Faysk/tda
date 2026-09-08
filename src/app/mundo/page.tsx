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

export async function generateMetadata({
	searchParams,
}: MundoPageProps): Promise<Metadata> {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const focusId = resolveWorldFocusId(DANDELION_WORLD_DEMO, requestedFocus);
	const focus = focusId
		? DANDELION_WORLD_DEMO.nodes.find((node) => node.id === focusId)
		: undefined;
	const shareFocusedEntity = Boolean(requestedFocus && focus?.slug);
	const pathname = shareFocusedEntity
		? `/mundo?foco=${encodeURIComponent(focus?.slug ?? "")}`
		: "/mundo";
	const title = shareFocusedEntity
		? `${focus?.label ?? "Memória"} · Ecos da Jornada — demonstração`
		: "Ecos da Jornada — demonstração";
	const description = shareFocusedEntity
		? `Demonstração do World Explorer do TDA com ${focus?.label ?? "uma memória"} em foco. As relações exibidas neste recorte não são canon.`
		: "Demonstração multi-hub do World Explorer do TDA. As relações exibidas neste recorte visual não são canon.";

	return buildPublicMetadata({ title, description, pathname });
}

export default async function MundoPage({ searchParams }: MundoPageProps) {
	const query = await searchParams;
	const requestedFocus = requestedFocusFrom(query);
	const focusId = resolveWorldFocusId(DANDELION_WORLD_DEMO, requestedFocus);
	const projection = buildWorldProjection(DANDELION_WORLD_DEMO, focusId);

	return (
		<main style={{ minWidth: 0, maxWidth: "100%", overflowX: "clip" }}>
			<WorldExplorerClient projection={projection} />
		</main>
	);
}
