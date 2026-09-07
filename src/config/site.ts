export const CANONICAL_SITE_ORIGIN = "https://dnd.faysk.dev";

export function canonicalPublicUrl({
	pathname,
	search = "",
	hash = "",
}: {
	pathname: string;
	search?: string;
	hash?: string;
}) {
	return `${CANONICAL_SITE_ORIGIN}${pathname}${search}${hash}`;
}
