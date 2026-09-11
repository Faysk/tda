import type { WorldAuthoringInspectorMode } from "./world-authoring-ui-state";

export function nextWorldInspectorMode(
	mode: WorldAuthoringInspectorMode,
): WorldAuthoringInspectorMode {
	if (mode === "closed") return "overlay";
	if (mode === "overlay") return "docked";
	return "closed";
}
