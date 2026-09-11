"use client";

import {
	useCallback,
	useReducer,
	useRef,
	type PointerEvent as ReactPointerEvent,
} from "react";
import {
	WORLD_INSPECTOR_MAX_WIDTH,
	WORLD_INSPECTOR_MIN_WIDTH,
	createWorldAuthoringUiState,
	worldAuthoringUiReducer,
	type WorldAuthoringChromeMode,
	type WorldAuthoringInspectorMode,
	type WorldAuthoringTool,
} from "../world-authoring-ui-state";
import { nextInspectorMode } from "../world-inspector-mode";

export function useWorldAuthoringUi() {
	const [state, dispatch] = useReducer(
		worldAuthoringUiReducer,
		undefined,
		createWorldAuthoringUiState,
	);
	const resizeStart = useRef<{ x: number; width: number } | null>(null);

	const inspectorCollapsed = state.inspectorMode === "closed";
	const focusMode = state.chromeMode === "minimal";

	const authoringStarted = useCallback(() => {
		dispatch({ type: "authoringStarted" });
	}, []);

	const authoringStopped = useCallback(() => {
		dispatch({ type: "authoringStopped" });
	}, []);

	const toggleInspector = useCallback(
		(openMode: Exclude<WorldAuthoringInspectorMode, "closed"> = "docked") => {
			if (openMode === "overlay") {
				dispatch({ type: "setInspectorMode", mode: nextInspectorMode(state.inspectorMode) });
				return;
			}
			dispatch({ type: "toggleInspector", openMode });
		},
		[state.inspectorMode],
	);

	const toggleFocusMode = useCallback(() => {
		dispatch({ type: "toggleFocusMode" });
	}, []);

	function setInspectorMode(mode: WorldAuthoringInspectorMode) {
		dispatch({ type: "setInspectorMode", mode });
	}

	function setInspectorWidth(width: number) {
		dispatch({ type: "setInspectorWidth", width });
	}

	function adjustInspectorWidth(delta: number) {
		setInspectorWidth(state.inspectorWidth + delta);
	}

	function setTool(tool: WorldAuthoringTool) {
		dispatch({ type: "setTool", tool });
	}

	function setChromeMode(mode: WorldAuthoringChromeMode) {
		dispatch({ type: "setChromeMode", mode });
	}

	function setCommandPaletteOpen(open: boolean) {
		dispatch({ type: "setCommandPaletteOpen", open });
	}

	function startInspectorResize(event: ReactPointerEvent<HTMLElement>) {
		resizeStart.current = { x: event.clientX, width: state.inspectorWidth };
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function resizeInspector(event: ReactPointerEvent<HTMLElement>) {
		if (!resizeStart.current) return;
		setInspectorWidth(
			resizeStart.current.width + resizeStart.current.x - event.clientX,
		);
	}

	function stopInspectorResize(event: ReactPointerEvent<HTMLElement>) {
		resizeStart.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	}

	return {
		state,
		inspectorCollapsed,
		focusMode,
		authoringStarted,
		authoringStopped,
		toggleInspector,
		toggleFocusMode,
		setInspectorMode,
		setInspectorWidth,
		adjustInspectorWidth,
		setTool,
		setChromeMode,
		setCommandPaletteOpen,
		startInspectorResize,
		resizeInspector,
		stopInspectorResize,
		inspectorMinWidth: WORLD_INSPECTOR_MIN_WIDTH,
		inspectorMaxWidth: WORLD_INSPECTOR_MAX_WIDTH,
	};
}
