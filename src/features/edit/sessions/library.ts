export type EditSessionLibraryItem = Readonly<{
	id: string;
	sourceSessionId: string;
	title: string;
	sessionDate: string | null;
	arc: string | null;
	status: string;
	transcriptPrepared: boolean;
}>;

export type SessionLibraryFilters = Readonly<{
	query: string;
	state: string;
	publication: string;
	arc: string;
	sort: "date-desc" | "date-asc" | "title";
}>;

const STATUS_LABELS: Record<string, string> = {
	ready_for_review: "Aguardando edição",
	reviewing: "Em edição",
	approved: "Pronto para publicar",
	published: "Publicado",
	archived: "Arquivado",
};

export function sessionEditorialLabel(session: EditSessionLibraryItem): string {
	if (!session.transcriptPrepared) return "Sem transcrição preparada";
	return STATUS_LABELS[session.status] ?? "Atenção necessária";
}

export function sessionEditorialTone(
	session: EditSessionLibraryItem,
): "success" | "accent" | "neutral" {
	if (session.status === "published") return "success";
	if (session.transcriptPrepared && session.status === "approved") return "accent";
	return "neutral";
}

function normalized(value: string): string {
	return value.trim().toLocaleLowerCase("pt-BR");
}

export function filterAndSortSessionLibrary(
	sessions: readonly EditSessionLibraryItem[],
	filters: SessionLibraryFilters,
): EditSessionLibraryItem[] {
	const query = normalized(filters.query);
	const filtered = sessions.filter((session) => {
		if (query) {
			const haystack = normalized(
				[session.title, session.arc ?? "", session.sourceSessionId].join(" "),
			);
			if (!haystack.includes(query)) return false;
		}

		if (filters.state === "prepared" && !session.transcriptPrepared) return false;
		if (filters.state === "unprepared" && session.transcriptPrepared) return false;
		if (
			filters.state &&
			!["all", "prepared", "unprepared"].includes(filters.state) &&
			session.status !== filters.state
		) {
			return false;
		}

		if (filters.publication === "published" && session.status !== "published")
			return false;
		if (filters.publication === "unpublished" && session.status === "published")
			return false;
		if (filters.arc && filters.arc !== "all" && session.arc !== filters.arc)
			return false;

		return true;
	});

	return [...filtered].sort((left, right) => {
		if (filters.sort === "title") {
			return (
				left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" }) ||
				left.sourceSessionId.localeCompare(right.sourceSessionId)
			);
		}
		const leftDate = left.sessionDate ?? "";
		const rightDate = right.sessionDate ?? "";
		const dateOrder =
			filters.sort === "date-asc"
				? leftDate.localeCompare(rightDate)
				: rightDate.localeCompare(leftDate);
		return (
			dateOrder ||
			left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" }) ||
			left.sourceSessionId.localeCompare(right.sourceSessionId)
		);
	});
}

export function sessionLibraryArcs(
	sessions: readonly EditSessionLibraryItem[],
): string[] {
	return Array.from(
		new Set(
			sessions
				.map((session) => session.arc)
				.filter((arc): arc is string => Boolean(arc)),
		),
	).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
}
