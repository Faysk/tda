import { describe, expect, it } from "vitest";
import {
	filterSessionLibrary,
	sessionEditorialLabel,
	sessionEditorialState,
	type EditSessionLibraryItem,
} from "./library-model";

function session(overrides: Partial<EditSessionLibraryItem> = {}): EditSessionLibraryItem {
	return {
		id: "session-1",
		sourceSessionId: "sessao-1",
		title: "Entre Canções",
		sessionDate: "2026-09-19",
		arc: "Valcinzento",
		status: "ready_for_review",
		transcriptRevisionNumber: 2,
		transcriptRevisionCreatedAt: "2026-09-27T18:00:00Z",
		...overrides,
	};
}

describe("session editorial library", () => {
	it("maps lifecycle labels and unprepared handoffs", () => {
		expect(sessionEditorialState(session({ transcriptRevisionNumber: null }))).toBe("unprepared");
		expect(sessionEditorialState(session({ status: "reviewing" }))).toBe("reviewing");
		expect(sessionEditorialState(session({ status: "approved" }))).toBe("approved");
		expect(sessionEditorialState(session({ status: "published" }))).toBe("published");
		expect(sessionEditorialLabel("approved")).toBe("Pronto para publicar");
	});

	it("combines metadata search, publication and arc filters", () => {
		const input = [
			session(),
			session({
				id: "session-2",
				sourceSessionId: "sessao-pipipi",
				title: "O Gato Prometido",
				arc: "O Passado de Poppe",
				status: "published",
				transcriptRevisionNumber: 4,
			}),
		];
		expect(filterSessionLibrary(input, {
			query: "pipipi",
			state: "all",
			publication: "published",
			arc: "O Passado de Poppe",
			sort: "activity",
		}).map((item) => item.id)).toEqual(["session-2"]);
	});

	it("sorts more than 250 metadata rows by editorial activity", () => {
		const input = Array.from({ length: 300 }, (_, index) =>
			session({
				id: `session-${index}`,
				sourceSessionId: `sessao-${index}`,
				transcriptRevisionCreatedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
			}),
		);
		const result = filterSessionLibrary(input, {
			query: "",
			state: "all",
			publication: "all",
			arc: "all",
			sort: "activity",
		});
		expect(result).toHaveLength(300);
		expect(result[0]?.id).toBe("session-299");
		expect(result.at(-1)?.id).toBe("session-0");
	});
});
