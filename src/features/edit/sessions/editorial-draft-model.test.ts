import { describe, expect, it } from "vitest";
import {
	SESSION_DRAFT_LIMITS,
	sessionDraftReadiness,
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
} as const;

describe("session editorial draft contract", () => {
	it("accepts exact limits without truncating unicode", () => {
		const input = {
			...base,
			coverAssetId: "c".repeat(SESSION_DRAFT_LIMITS.coverAssetId),
			arc: "á".repeat(SESSION_DRAFT_LIMITS.arc),
			title: "🦆".repeat(SESSION_DRAFT_LIMITS.title),
			shortDescription: "ç".repeat(SESSION_DRAFT_LIMITS.shortDescription),
			fullSummary: "★".repeat(SESSION_DRAFT_LIMITS.fullSummary),
		};
		expect(validateSessionEditorialDraftInput(input)).toEqual([]);
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
	] as const)("rejects %s at the contract limit + 1", (field, limit, issue) => {
		expect(
			validateSessionEditorialDraftInput({
				...base,
				[field]: "a".repeat(limit + 1),
			}),
		).toContain(issue);
	});

	it("reports publication readiness from actual required copy", () => {
		expect(
			sessionDraftReadiness({
				coverAssetId: "",
				title: " ",
				shortDescription: "Card",
				fullSummary: "# Resumo",
			}),
		).toEqual(["capa", "título"]);
		expect(
			sessionDraftReadiness({
				coverAssetId: "session-covers/key.webp",
				title: "Sessão",
				shortDescription: "Card",
				fullSummary: "# Resumo",
			}),
		).toEqual([]);
	});
});
