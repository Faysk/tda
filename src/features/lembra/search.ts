export type LembraSearchableReference = Readonly<{
	title: string;
	description: string;
	author: string;
	createdAt: string;
}>;

export type LembraDateRange = Readonly<{
	from: string;
	to: string;
}>;

const SEARCH_DATE_FORMATS = [
	new Intl.DateTimeFormat("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	}),
	new Intl.DateTimeFormat("pt-BR", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	}),
	new Intl.DateTimeFormat("pt-BR", {
		day: "numeric",
		month: "long",
		year: "numeric",
	}),
	new Intl.DateTimeFormat("pt-BR", {
		month: "long",
		year: "numeric",
	}),
];

export function normalizeLembraSearchValue(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLocaleLowerCase("pt-BR")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function searchableDateValues(isoDate: string) {
	const date = new Date(isoDate);
	if (Number.isNaN(date.getTime())) return [];

	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	return [
		isoDate,
		`${year}-${month}-${day}`,
		`${day}/${month}/${year}`,
		`${day}-${month}-${year}`,
		...SEARCH_DATE_FORMATS.map((formatter) => formatter.format(date)),
	];
}

export function matchesLembraSearch(item: LembraSearchableReference, query: string) {
	const terms = normalizeLembraSearchValue(query).split(" ").filter(Boolean);
	if (terms.length === 0) return true;

	const haystack = normalizeLembraSearchValue(
		[
			item.title,
			item.description,
			item.author,
			...searchableDateValues(item.createdAt),
		].join(" "),
	);

	return terms.every((term) => haystack.includes(term));
}

function parseBoundary(value: string, endOfDay: boolean) {
	if (!value) return null;
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return null;

	return new Date(
		year,
		month - 1,
		day,
		endOfDay ? 23 : 0,
		endOfDay ? 59 : 0,
		endOfDay ? 59 : 0,
		endOfDay ? 999 : 0,
	);
}

export function isWithinLembraDateRange(
	createdAt: string,
	range: LembraDateRange,
) {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return false;

	const from = parseBoundary(range.from, false);
	const to = parseBoundary(range.to, true);

	if (from && date < from) return false;
	if (to && date > to) return false;
	return true;
}

export function hasLembraDateFilter(range: LembraDateRange) {
	return Boolean(range.from || range.to);
}
