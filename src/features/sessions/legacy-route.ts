export function legacyHashTarget(hash: string) {
	if (hash === "#/" || hash === "#") return "/";
	const match = hash.match(/^#\/sessao\/([^/]+)(?:\/resumo)?\/?$/);
	if (!match?.[1]) return null;
	try {
		const id = decodeURIComponent(match[1]).trim();
		if (!id || id.length > 220) return null;
		return `/sessoes/${encodeURIComponent(id)}`;
	} catch {
		return null;
	}
}
