import type {
	WorldEdgeDTO,
	WorldGraphProjection,
	WorldNodeDTO,
	WorldRelationFamily,
} from "../model";

const HUBS = [
	{ id: "stress-hub-a", label: "Hub A", x: -900, y: -600 },
	{ id: "stress-hub-b", label: "Hub B", x: 900, y: -600 },
	{ id: "stress-hub-c", label: "Hub C", x: -900, y: 600 },
	{ id: "stress-hub-d", label: "Hub D", x: 900, y: 600 },
] as const;

const FAMILIES: WorldRelationFamily[] = [
	"affinity",
	"family",
	"conflict",
	"origin",
	"mystic",
	"context",
];

const nodes: WorldNodeDTO[] = [];
for (const hub of HUBS) {
	nodes.push({
		id: hub.id,
		slug: hub.id,
		kind: "entity",
		entityType: "pc",
		label: hub.label,
		prominence: "hero",
		layoutHint: { x: hub.x, y: hub.y },
	});
	for (let index = 0; index < 6; index += 1) {
		const angle = (Math.PI * 2 * index) / 6;
		nodes.push({
			id: `${hub.id}-node-${index + 1}`,
			slug: `${hub.id}-node-${index + 1}`,
			kind: "entity",
			entityType: "npc",
			label: `${hub.label} · ${index + 1}`,
			prominence: index < 2 ? "primary" : index < 4 ? "supporting" : "context",
			layoutHint: {
				x: hub.x + Math.round(Math.cos(angle) * 310),
				y: hub.y + Math.round(Math.sin(angle) * 240),
			},
		});
	}
}

const edges: WorldEdgeDTO[] = [];
for (const [hubIndex, hub] of HUBS.entries()) {
	for (let index = 0; index < 6; index += 1) {
		edges.push({
			id: `${hub.id}-spoke-${index + 1}`,
			source: hub.id,
			target: `${hub.id}-node-${index + 1}`,
			relationType: "stress_link",
			label: `Vínculo ${index + 1}`,
			direction: index % 2 === 0 ? "directed" : "symmetric",
			family: FAMILIES[(hubIndex + index) % FAMILIES.length] ?? "context",
		});
	}

	edges.push(
		{
			id: `${hub.id}-ring-a`,
			source: `${hub.id}-node-1`,
			target: `${hub.id}-node-4`,
			relationType: "stress_cross",
			label: "Travessia A",
			direction: "symmetric",
			family: "context",
		},
		{
			id: `${hub.id}-ring-b`,
			source: `${hub.id}-node-2`,
			target: `${hub.id}-node-5`,
			relationType: "stress_cross",
			label: "Travessia B",
			direction: "symmetric",
			family: "conflict",
		},
	);
}

edges.push(
	{
		id: "stress-cross-ad",
		source: "stress-hub-a",
		target: "stress-hub-d",
		relationType: "stress_cross_hub",
		label: "Diagonal A-D",
		direction: "symmetric",
		family: "mystic",
	},
	{
		id: "stress-cross-bc",
		source: "stress-hub-b",
		target: "stress-hub-c",
		relationType: "stress_cross_hub",
		label: "Diagonal B-C",
		direction: "symmetric",
		family: "conflict",
	},
	{
		id: "stress-cross-ab",
		source: "stress-hub-a-node-3",
		target: "stress-hub-b-node-6",
		relationType: "stress_cross_hub",
		label: "Corredor norte 1",
		direction: "directed",
		family: "origin",
	},
	{
		id: "stress-cross-ab-2",
		source: "stress-hub-a-node-6",
		target: "stress-hub-b-node-3",
		relationType: "stress_cross_hub",
		label: "Corredor norte 2",
		direction: "directed",
		family: "affinity",
	},
	{
		id: "stress-cross-cd",
		source: "stress-hub-c-node-3",
		target: "stress-hub-d-node-6",
		relationType: "stress_cross_hub",
		label: "Corredor sul 1",
		direction: "symmetric",
		family: "family",
	},
	{
		id: "stress-cross-cd-2",
		source: "stress-hub-c-node-6",
		target: "stress-hub-d-node-3",
		relationType: "stress_cross_hub",
		label: "Corredor sul 2",
		direction: "symmetric",
		family: "context",
	},
	{
		id: "stress-cross-ac",
		source: "stress-hub-a-node-5",
		target: "stress-hub-c-node-2",
		relationType: "stress_cross_hub",
		label: "Corredor oeste",
		direction: "directed",
		family: "creative",
	},
	{
		id: "stress-cross-bd",
		source: "stress-hub-b-node-5",
		target: "stress-hub-d-node-2",
		relationType: "stress_cross_hub",
		label: "Corredor leste",
		direction: "directed",
		family: "origin",
	},
);

export const WORLD_RELATION_STRESS_FIXTURE: WorldGraphProjection = {
	demo: true,
	mode: "overview",
	focusId: null,
	heroIds: HUBS.map((hub) => hub.id),
	nodes,
	edges,
	relationTypes: [],
};
