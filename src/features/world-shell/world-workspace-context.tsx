"use client";

import { createContext, useContext } from "react";

export type WorldWorkspaceControls = Readonly<{
	authoringActive: boolean;
	setAuthoringActive: (active: boolean) => void;
	openNavigation: () => void;
}>;

export const WorldWorkspaceControlsContext = createContext<WorldWorkspaceControls>({
	authoringActive: false,
	setAuthoringActive: () => undefined,
	openNavigation: () => undefined,
});

export function useWorldWorkspaceControls() {
	return useContext(WorldWorkspaceControlsContext);
}
