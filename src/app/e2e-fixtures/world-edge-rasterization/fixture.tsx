import { WorldExplorerClient } from "@/features/world-explorer/components/world-explorer-client";
import type { WorldGraphProjection } from "@/features/world-explorer/model";
import { WorldWorkspaceShell } from "@/features/world-shell/world-workspace-shell";

const RASTERIZATION_PROJECTION: WorldGraphProjection = {
	demo: true,
	mode: "overview",
	focusId: null,
	heroIds: ["raster-a"],
	relationTypes: [],
	nodes: [
		{
			id: "raster-a",
			slug: "raster-a",
			kind: "entity",
			entityType: "pc",
			label: "Aster",
			prominence: "hero",
			layoutHint: { x: -220, y: -120 },
		},
		{
			id: "raster-b",
			slug: "raster-b",
			kind: "entity",
			entityType: "npc",
			label: "Bram",
			prominence: "primary",
			layoutHint: { x: 80, y: -180 },
		},
		{
			id: "raster-c",
			slug: "raster-c",
			kind: "entity",
			entityType: "npc",
			label: "Cira",
			prominence: "primary",
			layoutHint: { x: 240, y: 20 },
		},
		{
			id: "raster-d",
			slug: "raster-d",
			kind: "entity",
			entityType: "npc",
			label: "Daro",
			prominence: "supporting",
			layoutHint: { x: 80, y: 200 },
		},
		{
			id: "raster-e",
			slug: "raster-e",
			kind: "entity",
			entityType: "npc",
			label: "Eli",
			prominence: "supporting",
			layoutHint: { x: -220, y: 180 },
		},
		{
			id: "raster-f",
			slug: "raster-f",
			kind: "entity",
			entityType: "location",
			label: "Farol",
			prominence: "context",
			layoutHint: { x: -360, y: 20 },
		},
	],
	edges: [
		{
			id: "raster-solid-directed",
			source: "raster-a",
			target: "raster-b",
			relationType: "raster_solid",
			label: "Guia",
			direction: "directed",
			family: "affinity",
		},
		{
			id: "raster-dashed-directed",
			source: "raster-a",
			target: "raster-c",
			relationType: "raster_dashed",
			label: "Rival",
			direction: "directed",
			family: "conflict",
		},
		{
			id: "raster-dotted-directed",
			source: "raster-a",
			target: "raster-d",
			relationType: "raster_dotted",
			label: "Presságio",
			direction: "directed",
			family: "mystic",
		},
		{
			id: "raster-family",
			source: "raster-b",
			target: "raster-e",
			relationType: "raster_family",
			label: "Família",
			direction: "symmetric",
			family: "family",
		},
		{
			id: "raster-origin",
			source: "raster-c",
			target: "raster-f",
			relationType: "raster_origin",
			label: "Origem",
			direction: "directed",
			family: "origin",
		},
		{
			id: "raster-creative",
			source: "raster-d",
			target: "raster-e",
			relationType: "raster_creative",
			label: "Criou",
			direction: "symmetric",
			family: "creative",
		},
		{
			id: "raster-context",
			source: "raster-e",
			target: "raster-f",
			relationType: "raster_context",
			label: "Contexto",
			direction: "symmetric",
			family: "context",
		},
		{
			id: "raster-affinity",
			source: "raster-b",
			target: "raster-f",
			relationType: "raster_affinity",
			label: "Aliado",
			direction: "symmetric",
			family: "affinity",
		},
	],
};

export function WorldEdgeRasterizationFixture({
	editable,
}: {
	editable: boolean;
}) {
	const href = editable
		? "/e2e-fixtures/world-edge-rasterization/edit"
		: "/e2e-fixtures/world-edge-rasterization/public";

	return (
		<WorldWorkspaceShell>
			<WorldExplorerClient
				projection={RASTERIZATION_PROJECTION}
				campaignSlug="fixture-world"
				campaignName={editable ? "Fixture Edit" : "Fixture Public"}
				campaignWorldHref={href}
				campaignSwitchOptions={[
					{
						key: "fixture-world",
						name: editable ? "Fixture Edit" : "Fixture Public",
						href,
						current: true,
					},
				]}
				canEditLayout={editable}
				canEditContent={editable}
			/>
		</WorldWorkspaceShell>
	);
}
