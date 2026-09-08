import { describe, expect, it } from "vitest";
import {
	captureWorldLayoutCandidate,
	parseWorldLayoutCandidate,
	serializeWorldLayoutCandidate,
} from "./editorial-layout";
import { DANDELION_WORLD_DEMO } from "./fixtures/dandelion";
import { buildWorldProjection } from "./projection";

describe("World Explorer editorial layout candidate", () => {
	it("captures only authorized finite overview positions and preserves observed revision", () => {
		const projection = {
			...buildWorldProjection(DANDELION_WORLD_DEMO),
			layout: {
				schemaVersion: 1 as const,
				view: "overview" as const,
				revision: 8,
				positions: { dandelion: { x: 10, y: 20 } },
			},
		};
		const candidate = captureWorldLayoutCandidate(projection, {
			astel: { x: -230, y: 74 },
			dandelion: { x: 180, y: -90 },
			"secret-node": { x: 5, y: 5 },
			ivory: { x: Number.POSITIVE_INFINITY, y: 0 },
		});

		expect(candidate).toEqual({
			schemaVersion: 1,
			view: "overview",
			revision: 8,
			positions: {
				astel: { x: -230, y: 74 },
				dandelion: { x: 180, y: -90 },
			},
		});
	});

	it("serializes stably and parses fail-closed against the current projection", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO);
		const candidate = captureWorldLayoutCandidate(projection, {
			dandelion: { x: 120, y: -80 },
			astel: { x: -300, y: 90 },
		});
		expect(candidate).toBeDefined();
		if (!candidate) return;

		const serialized = serializeWorldLayoutCandidate(candidate);
		expect(serialized.indexOf('"astel"')).toBeLessThan(serialized.indexOf('"dandelion"'));
		expect(parseWorldLayoutCandidate(serialized, projection)).toEqual(candidate);

		const withHiddenNode = serialized.replace(
			'"dandelion": {',
			'"secret-node": { "x": 1, "y": 1 },\n    "dandelion": {',
		);
		expect(parseWorldLayoutCandidate(withHiddenNode, projection)?.positions["secret-node"]).toBeUndefined();
	});

	it("does not capture or import overview persistence while exploring focus mode", () => {
		const projection = buildWorldProjection(DANDELION_WORLD_DEMO, "astel");
		expect(
			captureWorldLayoutCandidate(projection, { astel: { x: 10, y: 20 } }),
		).toBeUndefined();
		expect(
			parseWorldLayoutCandidate(
				'{"schemaVersion":1,"view":"overview","revision":0,"positions":{"astel":{"x":10,"y":20}}}',
				projection,
			),
		).toBeUndefined();
	});
});
