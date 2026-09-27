export type EditSessionLibraryItem = Readonly<{
	id: string;
	sourceSessionId: string;
	title: string;
	sessionDate: string | null;
	arc: string | null;
	status: string;
	transcriptRevisionNumber: number | null;
	transcriptRevisionCreatedAt: string | null;
}>;

export type SessionEditorialState =
	| "unprepared"
	| "ready_for_review"
	| "reviewing"
	| "approved"
	| "published"
	| "archived"
	| "attention";

export type SessionLibrarySort = "activity" | "session_date" | "title";

export type SessionLibraryFilters = Readonly<{
	query: string;
	state: SessionEditorialState | "all";
	publication: "all" | "published" | "unpublished";
	arc: string;
	sort: SessionLibrarySort;
}>;

export function sessionEditorialState(
	session: EditSessionLibraryItem,
): SessionEditorialState {
	const status = session.status.trim().toLowerCase();
	if (status === "archived") return "archived";
	if (status === "published") return "published";
	if (status === "approved") return "approved";
	if (status === "reviewing") return "reviewing";
	if (status === "ready_for_review" || status === "draft") {
		return session.transcriptRevisionNumber === null
			? "unprepared"
			: "ready_for_review";
	}
	if (["error", "failed", "invalid"].includes(status)) return "attention";
	return session.transcriptRevisionNumber === null ? "unprepared" : "attention";
}

export function sessionEditorialLabel(state: SessionEditorialState): string {
	return {
		unprepared: "Sem transcrição preparada",
		ready_for_review: "Aguardando edição",
		reviewing: "Em edição",
		approved: "Pronto para publicar",
		published: "Publicado",
		archived: "Arquivado",
		attention: "Atenção necessária",
	}[state];
}

function normalized(value: string | null): string {
	return (value ?? "").trim().toLocaleLowerCase("pt-BR");
}

function sessionDateTimestamp(value: string | null): number {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 0;
	const parsed = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(parsed) ? parsed : 0;
}

function activityTimestamp(session: EditSessionLibraryItem): number {
	const revision = session.transcriptRevisionCreatedAt
		? Date.parse(session.transcriptRevisionCreatedAt)
		: Number.NaN;
	return Number.isFinite(revision)
		? revision
		: sessionDateTimestamp(session.sessionDate);
}

export function filterSessionLibrary(
	sessions: readonly EditSessionLibraryItem[],
	filters: SessionLibraryFilters,
): EditSessionLibraryItem[] {
	const query = normalized(filters.query);
	const visible = sessions.filter((session) => {
		const state = sessionEditorialState(session);
		if (filters.state !== "all" && state !== filters.state) return false;
		if (
			filters.publication === "published" &&
			session.status.toLowerCase() !== "published"
		)
			return false;
		if (
			filters.publication === "unpublished" &&
			session.status.toLowerCase() === "published"
		)
			return false;
		if (filters.arc !== "all" && session.arc !== filters.arc) return false;
		if (!query) return true;
		return [session.title, session.arc, session.sourceSessionId]
			.map(normalized)
			.some((value) => value.includes(query));
	});

	return [...visible].sort((left, right) => {
		if (filters.sort === "title") {
			return left.title.localeCompare(right.title, "pt-BR", {
				sensitivity: "base",
			});
		}
		if (filters.sort === "session_date") {
			return (
				sessionDateTimestamp(right.sessionDate) -
					sessionDateTimestamp(left.sessionDate) ||
				left.title.localeCompare(right.title, "pt-BR", {
					sensitivity: "base",
				})
			);
		}
		return (
			activityTimestamp(right) -
				activityTimestamp(left) ||
			sessionDateTimestamp(right.sessionDate) -
				sessionDateTimestamp(left.sessionDate) ||
			left.title.localeCompare(right.title, "pt-BR", {
				sensitivity: "base",
			})
		);
	});
}
