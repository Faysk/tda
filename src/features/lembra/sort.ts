export type LembraSort = "newest" | "oldest" | "title" | "author";

export type LembraSortableReference = Readonly<{
	id: string;
	title: string;
	author: string;
	createdAt: string;
}>;

const COLLATOR = new Intl.Collator("pt-BR", {
	sensitivity: "base",
	numeric: true,
});

function timestamp(value: string) {
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : 0;
}

export function sortLembraReferences<T extends LembraSortableReference>(
	items: readonly T[],
	sort: LembraSort,
): T[] {
	const copy = [...items];

	copy.sort((left, right) => {
		switch (sort) {
			case "oldest":
				return timestamp(left.createdAt) - timestamp(right.createdAt);
			case "title":
				return (
					COLLATOR.compare(left.title, right.title) ||
					timestamp(right.createdAt) - timestamp(left.createdAt)
				);
			case "author":
				return (
					COLLATOR.compare(left.author, right.author) ||
					timestamp(right.createdAt) - timestamp(left.createdAt)
				);
			case "newest":
			default:
				return timestamp(right.createdAt) - timestamp(left.createdAt);
		}
	});

	return copy;
}
