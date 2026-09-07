import type { Metadata } from "next";
import "@xyflow/react/dist/style.css";
import { WorldExplorerClient } from "@/features/world-explorer/components/world-explorer-client";
import { DANDELION_WORLD_DEMO } from "@/features/world-explorer/fixtures/dandelion";
import {
	buildWorldProjection,
	resolveWorldFocusId,
} from "@/features/world-explorer/projection";

export const metadata: Metadata = {
	title: "Ecos da Jornada",
	description: "Explore visualmente as conexões entre as memórias do TDA.",
	alternates: { canonical: "/mundo" },
};

type MundoPageProps = {
	searchParams: Promise<{ foco?: string | string[] }>;
};

export default async function MundoPage({ searchParams }: MundoPageProps) {
	const query = await searchParams;
	const requestedFocus = Array.isArray(query.foco) ? query.foco[0] : query.foco;
	const focusId = resolveWorldFocusId(DANDELION_WORLD_DEMO, requestedFocus);
	const projection = buildWorldProjection(DANDELION_WORLD_DEMO, focusId);

	return <WorldExplorerClient projection={projection} />;
}
