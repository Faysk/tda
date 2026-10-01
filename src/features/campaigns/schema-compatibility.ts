type RegistryError = Readonly<{ code?: string | null; message?: string | null }>;

/** Only the additive registry columns introduced together by the registry migration. */
export function isCampaignRegistrySchemaGap(error: RegistryError | null | undefined): boolean {
	if (error?.code !== "42703" && error?.code !== "PGRST204") return false;
	const message = error.message?.toLowerCase() ?? "";
	return /\bcampaigns(?:_\d+)?\b/u.test(message) &&
		/\b(public_slug|lifecycle|visibility)\b/u.test(message);
}
