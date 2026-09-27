export function editSessionHref(sourceSessionId: string): string {
	return `/edit/sessoes/${encodeURIComponent(sourceSessionId)}`;
}

export function sessionHandoffLabel(
	preparing: boolean,
	revisionNumber: number | null,
): string {
	if (revisionNumber !== null) return `Preparada · r${revisionNumber}`;
	return preparing ? "Preparando…" : "Preparar sessão";
}
