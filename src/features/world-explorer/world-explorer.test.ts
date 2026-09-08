import { describe, expect, it } from "vitest";
import { constellationWorldLayout } from "./constellation-layout";
import { DANDELION_WORLD_DEMO } from "./fixtures/dandelion";
import {
	buildWorldProjection,
	filterWorldRelations,
	resolveWorldFocusId,
	searchWorldProjection,
} from "./projection";

describe("World Explorer V2 projection", () => {
	it("opens as a campaign overview instead of forcing Dandelion as centre", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO);
		expect(projection.mode).toBe("overview");
		expect(projection.focusId).toBeNull();
		expect(projection.heroIds).toEqual(expect.arrayContaining(["dandelion", "screacky", "astel"]));
		expect(projection.nodes).toHaveLength(DANDELION_WORLD_DEMO.nodes.length);
		expect(projection.edges).toHaveLength(DANDELION_WORLD_DEMO.edges.length);
	});

	it("resolves an explicit focus without falling back to a different hero", () => {
		expect(resolveWorldFocusId(DANDELION_WORLD_DEMO, "ASTEL")).toBe("astel");
		expect(resolveWorldFocusId(DANDELION_WORLD_DEMO, "missing")).toBeNull();
		expect(resolveWorldFocusId(DANDELION_WORLD_DEMO, undefined)).toBeNull();
	});

	it("keeps explicit focus as a bounded direct-neighbour exploration", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO, "astel");
		expect(projection.mode).toBe("focus");
		expect(projection.focusId).toBe("astel");
		expect(projection.nodes.some((node) => node.id === "raven-queen")).toBe(true);
		expect(
			projection.edges.every((edge) => edge.source === "astel" || edge.target === "astel"),
		).toBe(true);
	});

	it("can filter relation families and search while preserving connected context", () => {
		const overview = buildWorldProjection(DANDELION_WORLD_DEMO);
		const conflicts = filterWorldRelations(overview, "conflict");
		expect(conflicts.edges.length).toBeGreaterThan(0);
		expect(conflicts.edges.every((edge) => edge.family === "conflict")).toBe(true);

		const result = searchWorldProjection(overview, "Astel");
		expect(result.nodes.some((node) => node.id === "astel")).toBe(true);
		expect(result.nodes.some((node) => node.id === "raven-queen")).toBe(true);
	});
});

describe("World Explorer constellation layout", () => {
	it("is deterministic and gives peer heroes distinct positions", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO);
		const first = constellationWorldLayout(projection);
		const second = constellationWorldLayout(projection);
		expect(first).toEqual(second);
		expect(first.dandelion).not.toEqual({ x: 0, y: 0 });
		expect(first.dandelion).not.toEqual(first.astel);
		expect(first.screacky).not.toEqual(first.astel);
	});

	it("centres only an explicitly focused exploration", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO, "astel");
		const layout = constellationWorldLayout(projection);
		expect(layout.astel).toEqual({ x: 0, y: 0 });
	});
});
