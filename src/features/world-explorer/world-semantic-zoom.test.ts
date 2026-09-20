import { describe, expect, it } from "vitest";
import {
	worldEdgeSemanticPresentation,
	worldLabelCounterScale,
	worldNodeSemanticPresentation,
	worldSemanticZoomTier,
} from "./world-semantic-zoom";

describe("World semantic zoom", () => {
	it("separates atlas, region and detail camera scales", () => {
		expect(worldSemanticZoomTier(0.12)).toBe("atlas");
		expect(worldSemanticZoomTier(0.34)).toBe("region");
		expect(worldSemanticZoomTier(0.71)).toBe("region");
		expect(worldSemanticZoomTier(0.72)).toBe("detail");
		expect(worldSemanticZoomTier(1.4)).toBe("detail");
	});

	it("keeps labels readable without allowing unbounded inverse scale", () => {
		expect(worldLabelCounterScale(1)).toBe(1);
		expect(worldLabelCounterScale(0.5)).toBe(2);
		expect(worldLabelCounterScale(0.05)).toBe(20);
		expect(worldLabelCounterScale(0.005)).toBe(48);
	});

	it("keeps only navigation-critical labels in atlas mode", () => {
		expect(
			worldNodeSemanticPresentation("atlas", {
				isHero: true,
				isFocus: false,
				selected: false,
				prominence: "hero",
				authoringConnectable: false,
			}),
		).toEqual({
			showLabel: true,
			showSubtitle: false,
			showKindMark: true,
		});

		expect(
			worldNodeSemanticPresentation("atlas", {
				isHero: false,
				isFocus: false,
				selected: false,
				prominence: "supporting",
				authoringConnectable: false,
			}),
		).toEqual({
			showLabel: false,
			showSubtitle: false,
			showKindMark: false,
		});
	});

	it("always reveals the selected node even when zoomed far out", () => {
		expect(
			worldNodeSemanticPresentation("atlas", {
				isHero: false,
				isFocus: false,
				selected: true,
				prominence: "context",
				authoringConnectable: false,
			}).showLabel,
		).toBe(true);
	});

	it("reduces edge noise progressively while preserving highlighted context", () => {
		expect(
			worldEdgeSemanticPresentation("atlas", {
				highlighted: false,
				dimmed: false,
			}),
		).toMatchObject({
			showLabel: false,
			showHalo: false,
			showMotion: false,
			strokeOpacity: 0.2,
		});

		expect(
			worldEdgeSemanticPresentation("region", {
				highlighted: false,
				dimmed: false,
			}),
		).toMatchObject({
			showLabel: false,
			strokeOpacity: 0.5,
		});

		expect(
			worldEdgeSemanticPresentation("atlas", {
				highlighted: true,
				dimmed: false,
			}),
		).toMatchObject({
			showLabel: true,
			strokeOpacity: 1,
		});
	});
});
