import { describe, expect, it } from "vitest";
import {
	filterAndSortSessionLibrary,
	sessionEditorialLabel,
	sessionLibraryArcs,
	type EditSessionLibraryItem,
} from "./library";

const item = (
	id: string,
	overrides: Partial<EditSessionLibraryItem> = {},
): EditSessionLibraryItem => ({
	id,
	sourceSessionId: `source-${id}`,
	title: `Sessão ${id}`,
	sessionDate: "2026-09-01",
	arc: "Arco A",
	status: "ready_for_review",
	transcriptPrepared: true,
	...overrides,
});

describe("editorial session library", () => {
	it("maps lifecycle and private handoff state to human labels", () => {
		expect(sessionEditorialLabel(item("1"))).toBe("Aguardando edição");
		expect(sessionEditorialLabel(item("2", { status: "reviewing" }))).toBe("Em edição");
		expect(sessionEditorialLabel(item("3", { status: "approved" }))).toBe("Pronto para publicar");
		expect(sessionEditorialLabel(item("4", { status: "published" }))).toBe("Publicado");
		expect(
			sessionEditorialLabel(item("5", { transcriptPrepared: false, status: "published" })),
		).toBe("Sem transcrição preparada");
		expect(sessionEditorialLabel(item("6", { status: "unexpected" }))).toBe(
			"Atenção necessária",
		);
	});

	it("searches metadata only and filters prepared/publication/arc", () => {
		const sessions = [
			item("1", { title: "Raízes Antigas", arc: "Valcinzento", status: "published" }),
			item("2", { title: "Noite Longa", arc: "Yuhara", transcriptPrepared: false }),
			item("3", { sourceSessionId: "craig-special", arc: "Valcinzento", status: "approved" }),
		];

		expect(
			filterAndSortSessionLibrary(sessions, {
				query: "raízes",
				state: "all",
				publication: "all",
				arc: "all",
				sort: "date-desc",
			}).map((session) => session.id),
		).toEqual(["1"]);
		expect(
			filterAndSortSessionLibrary(sessions, {
				query: "craig-special",
				state: "prepared",
				publication: "unpublished",
				arc: "Valcinzento",
				sort: "date-desc",
			}).map((session) => session.id),
		).toEqual(["3"]);
		expect(
			filterAndSortSessionLibrary(sessions, {
				query: "",
				state: "unprepared",
				publication: "all",
				arc: "all",
				sort: "date-desc",
			}).map((session) => session.id),
		).toEqual(["2"]);
	});

	it("sorts deterministically and supports more than 250 metadata rows", () => {
		const sessions = Array.from({ length: 301 }, (_, index) =>
			item(String(index).padStart(3, "0"), {
				title: `Sessão ${String(300 - index).padStart(3, "0")}`,
				sessionDate: index % 2 ? "2026-09-02" : "2026-09-01",
			}),
		);
		const result = filterAndSortSessionLibrary(sessions, {
			query: "",
			state: "all",
			publication: "all",
			arc: "all",
			sort: "title",
		});
		expect(result).toHaveLength(301);
		expect(result[0]?.title).toBe("Sessão 000");
		expect(result.at(-1)?.title).toBe("Sessão 300");
	});

	it("builds a stable unique arc filter list", () => {
		expect(
			sessionLibraryArcs([
				item("1", { arc: "Yuhara" }),
				item("2", { arc: "Valcinzento" }),
				item("3", { arc: "Yuhara" }),
				item("4", { arc: null }),
			]),
		).toEqual(["Valcinzento", "Yuhara"]);
	});
});
