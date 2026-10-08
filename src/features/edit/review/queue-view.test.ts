import { describe, expect, it } from "vitest";
import { reviewQueueView } from "./queue-view";
const candidates = Array.from({ length: 45 }, (_, index) => ({
	title: `Candidato ${index}`,
	claim: index === 30 ? "Uma memória antiga" : "Outra afirmação",
	sessionTitle: "A sessão",
	candidateType: index % 2 ? "event" : "fact",
}));
describe("bounded review presentation", () => {
	it("pages without losing or repeating a candidate", () => {
		const views = ["1", "2", "3"].map((page) =>
			reviewQueueView(candidates, "", "", page),
		);
		expect(views.map((view) => view.items.length)).toEqual([20, 20, 5]);
		expect(views.flatMap((view) => view.items)).toEqual(candidates);
		expect(views[2]).toMatchObject({ from: 41, to: 45, total: 45, pages: 3 });
	});
	it("combines accent-insensitive search and type while clamping stale pages", () => {
		expect(reviewQueueView(candidates, "MEMORIA", "fact", "99")).toMatchObject({
			items: [candidates[30]],
			total: 1,
			page: 1,
		});
		expect(reviewQueueView(candidates, "sessao", "event", "1").total).toBe(22);
	});
	it.each(["-1", "0", "NaN", "999999999999999999", ""])(
		"handles invalid page %s",
		(page) => {
			expect(reviewQueueView(candidates, "", "", page).page).toBe(1);
		},
	);
	it("distinguishes no matches from an empty source without mutating input", () => {
		expect(reviewQueueView(candidates, "missing", "", "1")).toMatchObject({
			items: [],
			total: 0,
			from: 0,
			to: 0,
			pages: 1,
		});
		expect(reviewQueueView([], "", "", "1").types).toEqual([]);
		expect(candidates).toHaveLength(45);
	});
});
