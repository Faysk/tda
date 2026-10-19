import "server-only";

/** Disabled by default until the HQ schema, editor and publication have been verified. */
export function sessionComicFeatureEnabled(): boolean {
	return process.env.TDA_SESSION_COMICS_ENABLED === "true";
}
