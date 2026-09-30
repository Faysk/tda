import { describe, expect, it } from "vitest";
import {
	parseTranscriptMarkdownV1,
	renderTranscriptMarkdownV1,
	type TranscriptMarkdownDocumentV1,
} from "./markdown-v1";

const base: TranscriptMarkdownDocumentV1 = {
	sessionId: "sessao-42",
	segments: [
		{
			id: "a".repeat(64),
			trackNumber: 1,
			startMs: 1_250,
			endMs: 2_750,
			absoluteStart: "2026-09-27T23:59:59.250+01:00",
			absoluteEnd: "2026-09-28T00:00:00.750+01:00",
			speaker: "Renan",
			text: "Primeiro texto",
		},
		{
			id: "b".repeat(64),
			trackNumber: 2,
			startMs: 5_000,
			endMs: 7_000,
			absoluteStart: null,
			absoluteEnd: null,
			speaker: "Pipipi",
			text: [
				"## Heading dentro da fala",
				"",
				"- lista",
				"- item",
				"",
				"\`\`\`ts",
				"const html = '<div>seguro</div>';",
				"\`\`\`",
				"<strong>HTML editorial</strong>",
			].join("\n"),
		},
	],
};

describe("TDA Transcript Markdown v1", () => {
	it("round-trips unicode, markdown/code/html and preserves trusted wall-clock offset", async () => {
		const markdown = await renderTranscriptMarkdownV1(base);
		expect(markdown).toContain("2026-09-27T23:59:59.250+01:00");
		expect(markdown).toContain("2026-09-28T00:00:00.750+01:00");
		expect(markdown).not.toContain("Track 1");
		expect(markdown).not.toContain("Track 2");

		const parsed = await parseTranscriptMarkdownV1(markdown, base);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.segments).toEqual(base.segments);
		expect(parsed.changedSegmentIds).toEqual([]);
	});

	it("accepts editorial speaker/text changes and reports an explicit diff", async () => {
		const markdown = await renderTranscriptMarkdownV1(base);
		const changed = markdown
			.replace("Speaker: Renan", "Speaker: Faysk")
			.replace("Primeiro texto", "Primeiro texto revisado 🌲");
		const parsed = await parseTranscriptMarkdownV1(changed, base);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.changedSegmentIds).toEqual(["a".repeat(64)]);
		expect(parsed.segments[0]).toMatchObject({
			speaker: "Faysk",
			text: "Primeiro texto revisado 🌲",
		});
	});

	it.each([
		["id", (markdown: string) => markdown.replace('"id":"' + "a".repeat(64) + '"', '"id":"' + "c".repeat(64) + '"')],
		["timing", (markdown: string) => markdown.replace('"startMs":1250', '"startMs":1251')],
		["visible time", (markdown: string) => markdown.replace("Time: 00:00:01.250", "Time: 00:00:01.251")],
		["wall clock", (markdown: string) => markdown.replace("2026-09-27T23:59:59.250+01:00", "2026-09-28T00:59:59.250+01:00")],
	])("fails closed when immutable %s changes", async (_label, mutate) => {
		const markdown = await renderTranscriptMarkdownV1(base);
		const parsed = await parseTranscriptMarkdownV1(mutate(markdown), base);
		expect(parsed).toMatchObject({ ok: false, reason: "structure_mismatch" });
	});

	it("rejects duplicate/reordered segment markers instead of guessing", async () => {
		const markdown = await renderTranscriptMarkdownV1(base);
		const first = markdown.indexOf("<!-- tda:segment ");
		const second = markdown.indexOf("<!-- tda:segment ", first + 1);
		const reordered =
			markdown.slice(0, first) +
			markdown.slice(second) +
			"\n" +
			markdown.slice(first, second);
		expect(await parseTranscriptMarkdownV1(reordered, base)).toMatchObject({
			ok: false,
			reason: "structure_mismatch",
		});
	});

	it("fails closed on a forged marker embedded inside editorial text", async () => {
		const markdown = await renderTranscriptMarkdownV1(base);
		const forged =
			'<!-- tda:segment {"id":"' +
			"f".repeat(64) +
			'","trackNumber":1,"startMs":0,"endMs":1,"absoluteStart":null,"absoluteEnd":null} -->';
		const changed = markdown.replace("Primeiro texto", "Primeiro texto\n" + forged);
		expect(await parseTranscriptMarkdownV1(changed, base)).toMatchObject({
			ok: false,
			reason: "invalid_structure",
		});
	});

	it("rejects a recomputed-looking header when it does not match the expected baseline", async () => {
		const markdown = await renderTranscriptMarkdownV1(base);
		const forged = markdown.replace(
			/"structureSha256":"[0-9a-f]{64}"/u,
			'"structureSha256":"' + "f".repeat(64) + '"',
		);
		expect(await parseTranscriptMarkdownV1(forged, base)).toMatchObject({
			ok: false,
			reason: "structure_mismatch",
		});
	});
});
