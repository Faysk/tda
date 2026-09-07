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

export function whatsappShareUrl({
	title,
	description,
	url,
}: {
	title: string;
	description: string;
	url: string;
}) {
	const text = [title, description, url].filter(Boolean).join("\n\n");
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
