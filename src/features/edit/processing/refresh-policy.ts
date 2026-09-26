/**
 * Polling policy for the local Processing workspace.
 *
 * Fast reads fetch jobs/events/telemetry only. Deep reads additionally recheck
 * health/capabilities. Results/library data is invalidated explicitly instead
 * of being swept on every tick.
 */
export const PROCESSING_REFRESH_POLICY = {
	activePollMs: 1_500,
	idlePollMs: 6_000,
	activeDeepRefreshMs: 15_000,
	idleDeepRefreshMs: 30_000,
	capabilitiesPollMs: 30_000,
} as const;
