export function sessionShareDescription(summary: string, title: string) {
	const normalized = summary
		.replace(/[#>*_`~-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return (
		normalized.slice(0, 240) ||
		`Resumo público de ${title} no TDA — Tem Dado Aqui.`
	);
}
