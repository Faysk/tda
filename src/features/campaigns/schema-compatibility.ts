export type CampaignRegistrySchemaError = Readonly<{
	code?: string | null;
	message?: string | null;
	details?: string | null;
	hint?: string | null;
}>;

const REGISTRY_COLUMNS = ["public_slug", "lifecycle", "visibility"] as const;
const SCHEMA_GAP_CODES = new Set(["42703", "PGRST204"]);

export function isCampaignRegistrySchemaGap(
	error: CampaignRegistrySchemaError | null | undefined,
): boolean {
	if (!error?.code || !SCHEMA_GAP_CODES.has(error.code)) return false;

	const diagnostic = [error.message, error.details, error.hint]
		.filter((part): part is string => typeof part === "string")
		.join(" ")
		.toLowerCase();

	return (
		diagnostic.includes("campaign") &&
		REGISTRY_COLUMNS.some((column) => diagnostic.includes(column))
	);
}
