export const WORLD_INSPECTOR_MIN_WIDTH = 320;
export const WORLD_INSPECTOR_DEFAULT_WIDTH = 370;
export const WORLD_INSPECTOR_MAX_WIDTH = 520;

export type WorldAuthoringTool = "select" | "pan" | "create" | "connect";
export type WorldAuthoringChromeMode = "full" | "minimal";
export type WorldAuthoringInspectorMode = "closed" | "overlay" | "docked";

/**
 * Ephemeral interaction state for the World authoring surface.
 *
 * This state deliberately contains no lease, capability, audience, canon,
 * publication revision or draft payload. Those contracts remain owned by the
 * existing server-authorized edit session and domain boundaries.
 */
export type WorldAuthoringUiState = Readonly<{
	tool: WorldAuthoringTool;
	chromeMode: WorldAuthoringChromeMode;
	inspectorMode: WorldAuthoringInspectorMode;
	inspectorWidth: number;
	commandPaletteOpen: boolean;
}>;

export type WorldAuthoringUiAction =
	| Readonly<{ type: "authoringStarted" }>
	| Readonly<{ type: "authoringStopped" }>
	| Readonly<{ type: "toggleInspector"; openMode?: Exclude<WorldAuthoringInspectorMode, "closed"> }>
	| Readonly<{ type: "toggleFocusMode" }>
	| Readonly<{ type: "setInspectorMode"; mode: WorldAuthoringInspectorMode }>
	| Readonly<{ type: "setInspectorWidth"; width: number }>
	| Readonly<{ type: "setTool"; tool: WorldAuthoringTool }>
	| Readonly<{ type: "setChromeMode"; mode: WorldAuthoringChromeMode }>
	| Readonly<{ type: "setCommandPaletteOpen"; open: boolean }>;

export function clampWorldInspectorWidth(value: number): number {
	return Math.min(WORLD_INSPECTOR_MAX_WIDTH, Math.max(WORLD_INSPECTOR_MIN_WIDTH, value));
}

export function createWorldAuthoringUiState(): WorldAuthoringUiState {
	return {
		tool: "select",
		chromeMode: "full",
		inspectorMode: "docked",
		inspectorWidth: WORLD_INSPECTOR_DEFAULT_WIDTH,
		commandPaletteOpen: false,
	};
}

export function worldAuthoringUiReducer(
	state: WorldAuthoringUiState,
	action: WorldAuthoringUiAction,
): WorldAuthoringUiState {
	switch (action.type) {
		case "authoringStarted":
			return {
				...state,
				tool: "select",
				chromeMode: "full",
				inspectorMode: "closed",
				commandPaletteOpen: false,
			};
		case "authoringStopped":
			return {
				...state,
				tool: "select",
				chromeMode: "full",
				inspectorMode: "docked",
				commandPaletteOpen: false,
			};
		case "toggleInspector":
			return {
				...state,
				inspectorMode:
					state.inspectorMode === "closed" ? (action.openMode ?? "docked") : "closed",
			};
		case "toggleFocusMode":
			return state.chromeMode === "minimal"
				? { ...state, chromeMode: "full", inspectorMode: "closed" }
				: {
						...state,
						chromeMode: "minimal",
						inspectorMode: "closed",
						commandPaletteOpen: false,
					};
		case "setInspectorMode":
			return { ...state, inspectorMode: action.mode };
		case "setInspectorWidth":
			return { ...state, inspectorWidth: clampWorldInspectorWidth(action.width) };
		case "setTool":
			return { ...state, tool: action.tool };
		case "setChromeMode":
			return { ...state, chromeMode: action.mode };
		case "setCommandPaletteOpen":
			return { ...state, commandPaletteOpen: action.open };
	}
}
