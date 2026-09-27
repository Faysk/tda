import { describe, expect, it } from "vitest";
import {
	buildTranscriptDownload,
	transcriptDownloadFailureStatus,
} from "./download";

const first = {
	source: "current_revision" as const,
	revisionId: "11111111-1111-4111-8111-111111111111",
	revisionNumber: 4,
	segments: [
		{
			id: "r-1-a",
			trackNumber: 1,
			startMs: 3_210,
			endMs: 4_000,
			speaker: "Álya",
			text: "Primeiro snapshot 🌲",
		},
	],
};

describe("private transcript markdown download", () => {
	it("uses private no-store markdown headers and a safe filename", () => {
		const download = buildTranscriptDownload({
			title: "Entre Canções / Raízes",
			sessionDate: "2026-08-19",
			arc: "Raízes",
			sourceSessionId: "sessao-19",
			snapshot: first,
		});
		expect(download.filename).toBe(
			"2026-08-19-entre-cancoes-raizes-transcricao-r4.md",
		);
		expect(download.headers).toMatchObject({
			"Cache-Control": "private, no-store",
			"Content-Type": "text/markdown; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		});
		expect(download.headers["Content-Disposition"]).toContain("attachment");
		expect(download.body).toContain("Primeiro snapshot 🌲");
	});

	it("renders exactly the captured revision even if a newer snapshot exists later", () => {
		const captured = buildTranscriptDownload({
			title: "Sessão",
			sessionDate: null,
			arc: null,
			sourceSessionId: "sessao",
			snapshot: first,
		});
		const newer = {
			...first,
			revisionId: "22222222-2222-4222-8222-222222222222",
			revisionNumber: 5,
			segments: [{ ...first.segments[0], text: "Segundo snapshot" }],
		};
		expect(captured.body).toContain("Primeiro snapshot");
		expect(captured.body).not.toContain("Segundo snapshot");
		expect(buildTranscriptDownload({
			title: "Sessão",
			sessionDate: null,
			arc: null,
			sourceSessionId: "sessao",
			snapshot: newer,
		}).body).toContain("Segundo snapshot");
	});

	it("does not disclose forbidden targets through status differences", () => {
		expect(transcriptDownloadFailureStatus("unauthenticated")).toBe(401);
		expect(transcriptDownloadFailureStatus("forbidden")).toBe(404);
		expect(transcriptDownloadFailureStatus("profile_unresolved")).toBe(404);
		expect(transcriptDownloadFailureStatus("dependency_unavailable")).toBe(503);
	});
});
