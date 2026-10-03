export function normalizedCatalogueCover(cover: unknown): string | null {
	if (typeof cover !== "string") return null;
	const normalized = cover.trim();
	return normalized.length > 0 ? normalized : null;
}
