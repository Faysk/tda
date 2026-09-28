import { describe, expect, it } from "vitest";
import {
	applyTranscriptRevisionPatches,
	validateTranscriptRevisionEditInput,
} from "./revision-edit-contract";

const SESSION = "22222222-2222-4222-8222-222222222222";
const REVISION = "44444444-4444-4444-8444-444444444444";
const OPERATION = "90000000-0000-4000-8000-000000000001";
const raw = [
	{
		track_number: 1,
		segment_id: "a-1",
		start: 1.25,
		end: 2.5,
		text: "Texto original",
		speaker: "Alya",
		reviewed: true,
	},
	{
		track_number: 2,
		segment_id: "b-2",
		start: 3,
		end: 4.75,
		text: "Outra fala",
		speaker: "Borin",
		reviewed: false,
	},
];

describe("transcript revision edit contract", () => {
	it("accepts a bounded whole-save patch request", () => {
		expect(
			validateTranscriptRevisionEditInput({
				sessionId: SESSION,
				expectedCurrentRevisionId: REVISION,
				operationId: OPERATION,
				patches: [{ id: "r-1-a-1", speaker: "Alya", text: "Editado" }],
			}),
		).toEqual([]);
	});

	it("rejects duplicate identities and blank content", () => {
		const issues = validateTranscriptRevisionEditInput({
			sessionId: SESSION,
			expectedCurrentRevisionId: REVISION,
			operationId: OPERATION,
			patches: [
				{ id: "r-1-a-1", speaker: "Alya", text: "" },
				{ id: "r-1-a-1", speaker: "", text: "x" },
			],
		});
		expect(issues).toContain("patch_id");
		expect(issues).toContain("speaker");
		expect(issues).toContain("text");
	});

	it("changes only speaker/text while preserving timing and structural fields", () => {
		const result = applyTranscriptRevisionPatches(raw, [
			{ id: "r-1-a-1", speaker: "Alya Renomeada", text: "Texto revisado" },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.changed).toBe(1);
		expect(result.segments[0]).toEqual({
			...raw[0],
			speaker: "Alya Renomeada",
			text: "Texto revisado",
		});
		expect(result.segments[0].start).toBe(1.25);
		expect(result.segments[0].end).toBe(2.5);
		expect(result.segments[1]).toEqual(raw[1]);
		expect(raw[0].text).toBe("Texto original");
	});

	it("fails closed for a patch outside the authoritative revision", () => {
		expect(
			applyTranscriptRevisionPatches(raw, [
				{ id: "r-9-missing", speaker: "Mesa", text: "Nada" },
			]),
		).toEqual({ ok: false, reason: "unknown_segment" });
	});
});
