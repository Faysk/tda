import { describe, expect, it } from "vitest";
import type { WorldGraphDraft } from "./model";
import { appendWorldDraftNode, WORLD_DIRECT_CREATE_TYPES } from "./world-direct-create";

const draft: WorldGraphDraft = {
	schemaVersion: 1,
	revision: 7,
	nodes: [
		{
			id: "existing",
			name: "Lúcia",
			slug: "lucia",
			entityType: "npc",
			status: "active",
			visibility: "private_players",
			summary: "",
			aliases: [],
		},
	],
	edges: [],
	relationTypes: [],
};

describe("World direct create", () => {
	it("uses only the current domain entity types", () => {
		expect(WORLD_DIRECT_CREATE_TYPES).toEqual([
			"pc",
			"npc",
			"location",
			"faction",
			"organization",
			"song",
			"quest",
			"concept",
			"item",
			"arc",
			"other",
		]);
	});

	it("appends a private draft node with a unique normalized slug", () => {
		const result = appendWorldDraftNode(draft, {
			id: "new-node",
			name: "  Lúcia  ",
			entityType: "location",
		});

		expect(result?.node).toMatchObject({
			id: "new-node",
			name: "Lúcia",
			slug: "lucia-2",
			entityType: "location",
			status: "active",
			visibility: "private_players",
			summary: "",
			aliases: [],
		});
		expect(result?.draft.nodes).toHaveLength(2);
		expect(draft.nodes).toHaveLength(1);
	});

	it("does not mutate the draft when the name is blank", () => {
		expect(
			appendWorldDraftNode(draft, {
				id: "blank",
				name: "   ",
				entityType: "npc",
			}),
		).toBeNull();
		expect(draft.nodes).toHaveLength(1);
	});
});
