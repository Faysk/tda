export function statisticsReadModelV2Enabled(
	value: string | undefined = process.env.TDA_STATS_READ_MODEL_V2_ENABLED,
): boolean {
	return value === "true";
}
