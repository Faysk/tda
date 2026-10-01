export function editSessionLibraryHref(campaignSlug: string): string {
	return `/edit/${encodeURIComponent(campaignSlug)}/sessoes`;
}

export function editSessionDetailHref(
	campaignSlug: string,
	sourceSessionId: string,
): string {
	return `${editSessionLibraryHref(campaignSlug)}/${encodeURIComponent(sourceSessionId)}`;
}
