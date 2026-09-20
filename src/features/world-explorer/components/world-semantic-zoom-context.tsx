"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { WorldSemanticZoomTier } from "../world-semantic-zoom";

const WorldSemanticZoomContext = createContext<WorldSemanticZoomTier>("detail");

export function WorldSemanticZoomProvider({
	tier,
	children,
}: {
	tier: WorldSemanticZoomTier;
	children: ReactNode;
}) {
	return (
		<WorldSemanticZoomContext.Provider value={tier}>
			{children}
		</WorldSemanticZoomContext.Provider>
	);
}

export function useWorldSemanticZoomTier(): WorldSemanticZoomTier {
	return useContext(WorldSemanticZoomContext);
}
