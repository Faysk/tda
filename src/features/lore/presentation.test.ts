import { describe, expect, it } from "vitest";
import {
	resolveLoreMotionDefinition,
	resolveLorePresentation,
	resolveLoreScene,
} from "./presentation";

describe("lore presentation", () => {
	it("provides a safe standard presentation when no art direction exists", () => {
		const presentation = resolveLorePresentation();
		expect(presentation.hero.mode).toBe("standard");
		expect(presentation.hero.layers).toEqual([]);
		expect(presentation.scenes).toEqual([]);
		expect(presentation.motion.pointerParallax).toBe(true);
	});

	it("resolves a scene without mutating the shared base", () => {
		const presentation = resolveLorePresentation({
			hero: { focalPoint: { x: 50, y: 40 } },
			scenes: [
				{
					id: "turn",
					focalPoint: { x: 65, y: 38 },
					motion: { preset: "cinematic-push", intensity: 1.25 },
				},
			],
		});
		const scene = resolveLoreScene(presentation, "turn");
		expect(scene.hero.focalPoint).toEqual({ x: 65, y: 38 });
		expect(scene.motion.preset).toBe("cinematic-push");
		expect(presentation.hero.focalPoint).toEqual({ x: 50, y: 40 });
	});

	it("clamps motion intensity before deriving frame-level amplitudes", () => {
		const presentation = resolveLorePresentation({
			motion: { preset: "battle-drift", intensity: 99 },
		});
		const motion = resolveLoreMotionDefinition(presentation.motion);
		expect(motion.pointerAmplitudeX).toBe(50);
	});
});
