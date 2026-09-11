import { describe, expect, it } from "vitest";
import {
	WORLD_INSPECTOR_DEFAULT_WIDTH,
	WORLD_INSPECTOR_MAX_WIDTH,
	WORLD_INSPECTOR_MIN_WIDTH,
	clampWorldInspectorWidth,
	createWorldAuthoringUiState,
	worldAuthoringUiReducer,
} from "./world-authoring-ui-state";

describe("World authoring UI state", () => {
	it("keeps the public workspace inspector docked by default", () => {
		expect(createWorldAuthoringUiState()).toEqual({
			tool: "select",
			chromeMode: "full",
			inspectorMode: "docked",
			inspectorWidth: WORLD_INSPECTOR_DEFAULT_WIDTH,
			commandPaletteOpen: false,
		});
	});

	it("enters authoring canvas-first with the inspector closed", () => {
		const started = worldAuthoringUiReducer(createWorldAuthoringUiState(), {
			type: "authoringStarted",
		});

		expect(started.inspectorMode).toBe("closed");
		expect(started.chromeMode).toBe("full");
		expect(started.tool).toBe("select");
	});

	it("restores the public inspector contract when authoring stops", () => {
		const started = worldAuthoringUiReducer(createWorldAuthoringUiState(), {
			type: "authoringStarted",
		});
		const stopped = worldAuthoringUiReducer(started, { type: "authoringStopped" });

		expect(stopped.inspectorMode).toBe("docked");
		expect(stopped.chromeMode).toBe("full");
	});

	it("clamps the inspector to the existing desktop width contract", () => {
		expect(clampWorldInspectorWidth(WORLD_INSPECTOR_MIN_WIDTH - 80)).toBe(
			WORLD_INSPECTOR_MIN_WIDTH,
		);
		expect(clampWorldInspectorWidth(412)).toBe(412);
		expect(clampWorldInspectorWidth(WORLD_INSPECTOR_MAX_WIDTH + 80)).toBe(
			WORLD_INSPECTOR_MAX_WIDTH,
		);
	});

	it("opens the authoring inspector as an overlay without losing its width", () => {
		const started = worldAuthoringUiReducer(createWorldAuthoringUiState(), {
			type: "authoringStarted",
		});
		const resized = worldAuthoringUiReducer(started, {
			type: "setInspectorWidth",
			width: 444,
		});
		const opened = worldAuthoringUiReducer(resized, {
			type: "toggleInspector",
			openMode: "overlay",
		});
		const closed = worldAuthoringUiReducer(opened, { type: "toggleInspector" });

		expect(opened.inspectorMode).toBe("overlay");
		expect(opened.inspectorWidth).toBe(444);
		expect(closed.inspectorMode).toBe("closed");
		expect(closed.inspectorWidth).toBe(444);
	});

	it("focus mode hides secondary chrome and exits back to a clean canvas", () => {
		const started = worldAuthoringUiReducer(createWorldAuthoringUiState(), {
			type: "authoringStarted",
		});
		const inspectorOpen = worldAuthoringUiReducer(started, {
			type: "toggleInspector",
			openMode: "overlay",
		});
		const focused = worldAuthoringUiReducer(inspectorOpen, { type: "toggleFocusMode" });
		const restored = worldAuthoringUiReducer(focused, { type: "toggleFocusMode" });

		expect(focused.chromeMode).toBe("minimal");
		expect(focused.inspectorMode).toBe("closed");
		expect(restored.chromeMode).toBe("full");
		expect(restored.inspectorMode).toBe("closed");
	});
});
