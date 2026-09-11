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
	it("starts with the current public/editor chrome contract intact", () => {
		expect(createWorldAuthoringUiState()).toEqual({
			tool: "select",
			chromeMode: "full",
			inspectorMode: "docked",
			inspectorWidth: WORLD_INSPECTOR_DEFAULT_WIDTH,
			commandPaletteOpen: false,
		});
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

	it("keeps authoring interaction state independent from edit-session state", () => {
		const initial = createWorldAuthoringUiState();
		const customized = worldAuthoringUiReducer(
			worldAuthoringUiReducer(
				worldAuthoringUiReducer(initial, { type: "setTool", tool: "connect" }),
				{ type: "setChromeMode", mode: "minimal" },
			),
			{ type: "setCommandPaletteOpen", open: true },
		);
		const started = worldAuthoringUiReducer(customized, { type: "authoringStarted" });

		expect(started).toEqual({
			...initial,
			inspectorWidth: customized.inspectorWidth,
		});
	});

	it("closes and restores the inspector without losing its width", () => {
		const resized = worldAuthoringUiReducer(createWorldAuthoringUiState(), {
			type: "setInspectorWidth",
			width: 444,
		});
		const closed = worldAuthoringUiReducer(resized, { type: "toggleInspector" });
		const reopened = worldAuthoringUiReducer(closed, { type: "toggleInspector" });

		expect(closed.inspectorMode).toBe("closed");
		expect(closed.inspectorWidth).toBe(444);
		expect(reopened.inspectorMode).toBe("docked");
		expect(reopened.inspectorWidth).toBe(444);
	});
});
