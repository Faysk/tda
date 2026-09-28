import { describe, expect, it } from "vitest";
import {
	SESSION_DRAFT_LIMITS,
	sessionDraftReadiness,
	sessionDraftScalarLength,
	validateSessionEditorialDraftInput,
} from "./editorial-draft-model";

const base = {
	sessionId: "11111111-1111-4111-8111-111111111111",
	expectedRevision: 0,
	baseTranscriptRevisionId: "22222222-2222-4222-8222-222222222222",
	coverAssetId: "",
	arc: "",
	title: "",
	shortDescription: "",
	fullSummary: "",
	sessionDate: "",
} as const;

describe("session editorial draft contract", () => {
	it("accepts exact Unicode scalar limits without truncation", () => {
		const input = {
			...base,
			coverAssetId: "c".repeat(SESSION_DRAFT_LIMITS.coverAssetId),
			arc: "á".repeat(SESSION_DRAFT_LIMITS.arc),
			title: "🦆".repeat(SESSION_DRAFT_LIMITS.title),
			shortDescription: "ç".repeat(SESSION_DRAFT_LIMITS.shortDescription),
			fullSummary: "★".repeat(SESSION_DRAFT_LIMITS.fullSummary),
		};
		expect(validateSessionEditorialDraftInput(input)).toEqual([]);
		expect(sessionDraftScalarLength(input.title)).toBe(SESSION_DRAFT_LIMITS.title);
		expect(input.title.length).toBe(SESSION_DRAFT_LIMITS.title * 2);
	});

	it.each([
		["coverAssetId", SESSION_DRAFT_LIMITS.coverAssetId, "cover_asset_id_too_long"],
		["arc", SESSION_DRAFT_LIMITS.arc, "arc_too_long"],
		["title", SESSION_DRAFT_LIMITS.title, "title_too_long"],
		[
			"shortDescription",
			SESSION_DRAFT_LIMITS.shortDescription,
			"short_description_too_long",
		],
		["fullSummary", SESSION_DRAFT_LIMITS.fullSummary, "full_summary_too_long"],
	] as const)("rejects %s at the scalar limit + 1", (field, limit, issue) => {
		expect(
			validateSessionEditorialDraftInput({
				...base,
				[field]: "🦆".repeat(limit + 1),
			}),
		).toContain(issue);
	});

	it("rejects NUL and lone surrogates before persistence", () => {
		expect(validateSessionEditorialDraftInput({ ...base, title: "a\u0000b" })).toContain(
			"null_character",
		);
		expect(validateSessionEditorialDraftInput({ ...base, title: "bad\ud800" })).toContain(
			"title_too_long",
		);
	});


	it.each([
		["", []],
		["2026-01-01", []],
		["2024-02-29", []],
		["2026-02-29", ["session_date"]],
		["2026-02-30", ["session_date"]],
		["19/08/2026", ["session_date"]],
		["2026-08-19T00:00:00Z", ["session_date"]],
		[" 2026-08-19 ", ["session_date"]],
	] as const)("validates canonical date-only input %s", (sessionDate, expected) => {
		expect(validateSessionEditorialDraftInput({ ...base, sessionDate })).toEqual(expected);
	});

	it("reports publication readiness from actual required copy", () => {
		expect(
			sessionDraftReadiness({
				coverAssetId: "",
				title: " ",
				shortDescription: "Card",
				fullSummary: "# Resumo",
				sessionDate: "",
			}),
		).toEqual(["capa", "data da sessão", "título"]);
		expect(
			sessionDraftReadiness({
				coverAssetId: "session-covers/key.webp",
				title: "Sessão",
				shortDescription: "Card",
				fullSummary: "# Resumo",
				sessionDate: "2024-02-29",
			}),
		).toEqual([]);
	});
});
