export type LembraCampaignRegistryError = Readonly<{
	code?: string | null;
	message?: string | null;
}>;

const REGISTRY_COLUMNS = ["lifecycle", "visibility", "public_slug"] as const;

export function isLembraCampaignRegistryUnavailable(
	error: LembraCampaignRegistryError | null | undefined,
): boolean {
	if (error?.code !== "PGRST204") return false;
	const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
	return (
		message.includes("campaigns") &&
		REGISTRY_COLUMNS.some((column) => message.includes(column))
	);
}
