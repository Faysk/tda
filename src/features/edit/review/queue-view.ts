export const REVIEW_PAGE_SIZE = 20;
type Candidate = Readonly<{
	title: string;
	claim: string;
	sessionTitle: string | null;
	candidateType: string;
}>;
function normalize(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase("pt-BR");
}
/** Presentation over an already authorized, bounded server result; never an access filter. */
export function reviewQueueView<T extends Candidate>(
	candidates: readonly T[],
	query: string,
	type: string,
	requestedPage: string,
) {
	const search = normalize(query.trim().slice(0, 200));
	const matching = candidates.filter(
		(candidate) =>
			(!type || candidate.candidateType === type) &&
			(!search ||
				normalize(
					`${candidate.title} ${candidate.claim} ${candidate.sessionTitle ?? ""}`,
				).includes(search)),
	);
	const pages = Math.max(1, Math.ceil(matching.length / REVIEW_PAGE_SIZE));
	const number = /^\d{1,8}$/u.test(requestedPage) ? Number(requestedPage) : 1;
	const page = Math.min(pages, Math.max(1, number));
	const start = (page - 1) * REVIEW_PAGE_SIZE;
	return {
		items: matching.slice(start, start + REVIEW_PAGE_SIZE),
		total: matching.length,
		pages,
		page,
		from: matching.length ? start + 1 : 0,
		to: Math.min(start + REVIEW_PAGE_SIZE, matching.length),
		types: [
			...new Set(candidates.map((candidate) => candidate.candidateType)),
		].sort(),
	};
}
