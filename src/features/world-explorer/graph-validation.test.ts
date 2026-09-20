import { describe, expect, it } from "vitest";
import type { WorldGraphDraft } from "./model";
import {
	firstWorldGraphDraftValidationIssue,
	worldGraphDraftValidationIssues,
} from "./graph-validation";

const NODE_A = "11111111-1111-4111-8111-111111111111";
const NODE_B = "22222222-2222-4222-8222-222222222222";
const EDGE = "33333333-3333-4333-8333-333333333333";

function validDraft(): WorldGraphDraft {
	return {
		schemaVersion: 1,
		revision: 8,
		nodes: [
			{
				id: NODE_A,
				name: "Astel",
				slug: "astel",
				entityType: "pc",
				status: "active",
				visibility: "private_players",
				summary: "",
				aliases: [],
			},
			{
				id: NODE_B,
				name: "Screaky",
				slug: "screaky",
				entityType: "pc",
				status: "active",
				visibility: "private_players",
				summary: "",
				aliases: [],
			},
		],
		relationTypes: [
			{
				slug: "amigos",
				label: "Amigos",
				direction: "symmetric",
				family: "affinity",
				description: "",
				isActive: true,
				color: "#00ff1e",
				lineStyle: "solid",
				lineWidth: 3,
			},
		],
		edges: [
			{
				id: EDGE,
				source: NODE_A,
				target: NODE_B,
				relationType: "amigos",
				labelOverride: null,
				status: "active",
				visibility: "private_players",
				colorOverride: null,
				lineStyleOverride: null,
				lineWidthOverride: null,
			},
		],
	};
}

describe("World graph draft validation diagnostics", () => {
	it("accepts a valid draft", () => {
		expect(worldGraphDraftValidationIssues(validDraft())).toEqual([]);
		expect(firstWorldGraphDraftValidationIssue(validDraft())).toBeNull();
	});

	it("identifies the exact required entity field", () => {
		const draft = validDraft();
		const broken: WorldGraphDraft = {
			...draft,
			nodes: draft.nodes.map((node, index) =>
				index === 0 ? { ...node, name: "" } : node,
			),
		};
		expect(firstWorldGraphDraftValidationIssue(broken)).toMatchObject({
			code: "required",
			path: `nodes.${NODE_A}.name`,
			message: "Elemento #1 → Nome: obrigatório.",
		});
	});

	it("identifies an invalid relation-type label instead of generic invalid payload", () => {
		const draft = validDraft();
		const broken: WorldGraphDraft = {
			...draft,
			relationTypes: draft.relationTypes.map((type) => ({ ...type, label: "" })),
		};
		expect(firstWorldGraphDraftValidationIssue(broken)).toMatchObject({
			code: "required",
			path: "relationTypes.amigos.label",
			message: "Tipo de ligação #1 → Nome: obrigatório.",
		});
	});

	it("detects semantic duplicates including reversed symmetric edges", () => {
		const draft = validDraft();
		const broken: WorldGraphDraft = {
			...draft,
			edges: [
				...draft.edges,
				{
					...draft.edges[0],
					id: "44444444-4444-4444-8444-444444444444",
					source: NODE_B,
					target: NODE_A,
				},
			],
		};
		expect(worldGraphDraftValidationIssues(broken)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "duplicate_relation",
					message: "A ligação ativa “Amigos” está duplicada entre os mesmos elementos.",
				}),
			]),
		);
	});
});
