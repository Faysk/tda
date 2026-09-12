import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBridge } from "./bridge";
import { parseCapabilities, parseResultSummary } from "./protocol";

const token = "real_processing_token_123456789012345678901";
const signal = () => new AbortController().signal;

afterEach(() => {
	new LocalBridge().disconnect();
});

describe("real local processing bridge", () => {
	it("uploads Craig bytes only to fixed loopback and submits opaque source id", async () => {
		const digest = "a".repeat(64);
		const sourceId = `craig-${digest}`;
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(
				Response.json({
					schema_version: "tda_craig_ingest_v1",
					source_id: sourceId,
					source_sha256: digest,
					size_bytes: 123,
					track_count: 2,
					reused: false,
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					id: "job-real",
					kind: "transcription.craig",
					status: "queued",
					stage: "queued",
					progress: { completed: 0, total: 2, unit: "tracks" },
					error: null,
					result_available: false,
					updated_at: "2026-09-12T18:00:00Z",
					attempt: 0,
					context: {
						campaign_id: "yuhara-main",
						session_id: "sessao-42",
						source_id: sourceId,
						profile_id: "whisper-turbo",
					},
				}),
			);
		const bridge = new LocalBridge(request);
		bridge.pair(token);
		const file = new File(["PK fixture"], "craig.zip", { type: "application/zip" });

		const source = await bridge.craigSource(file, signal());
		expect(source.sourceId).toBe(sourceId);
		const [, upload] = request.mock.calls[0];
		expect(upload).toMatchObject({
			method: "POST",
			body: file,
			credentials: "omit",
			redirect: "error",
			referrerPolicy: "no-referrer",
		});
		expect(upload?.headers).toEqual({
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/zip",
		});

		await bridge.transcription(
			{
				campaignId: "yuhara-main",
				sessionId: "sessao-42",
				sourceId,
				profileId: "whisper-turbo",
				glossary: "Pipipi",
				context: "Sessão principal",
			},
			"idem-real-1",
			signal(),
		);
		const [, submit] = request.mock.calls[1];
		expect(submit?.headers).toMatchObject({
			Authorization: `Bearer ${token}`,
			"Idempotency-Key": "idem-real-1",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(submit?.body))).toEqual({
			kind: "transcription.craig",
			campaign_id: "yuhara-main",
			session_id: "sessao-42",
			source_id: sourceId,
			profile_id: "whisper-turbo",
			glossary: "Pipipi",
			context: "Sessão principal",
			cpu: false,
		});
	});

	it("accepts only known executable profile ids from capabilities", () => {
		expect(
			parseCapabilities({
				capabilities: ["transcription.craig"],
				sync: false,
				device: { id: "device-1", label: "TDA local" },
				transcription: { profiles: ["whisper-turbo", "qwen-fast"] },
			}).transcription.profiles,
		).toEqual(["whisper-turbo", "qwen-fast"]);
		expect(() =>
			parseCapabilities({
				capabilities: ["transcription.craig"],
				sync: false,
				device: { id: "device-1", label: "TDA local" },
				transcription: { profiles: ["made-up-model"] },
			}),
		).toThrow();
	});

	it("keeps only identity and hashes from a real transcript result", () => {
		const digest = "b".repeat(64);
		expect(
			parseResultSummary(
				{
					schema_version: "tda_local_result_v1",
					campaign_id: "yuhara-main",
					session_id: "sessao-42",
					source_id: `craig-${"a".repeat(64)}`,
					job_id: "job-real",
					transcription: {
						schema_version: "tda_transcript_v1",
						profile_id: "qwen-quality",
						artifact: "transcript.json",
						sha256: digest,
					},
					sync: { status: "not_configured" },
				},
				"job-real",
			),
		).toEqual({
			jobId: "job-real",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
			sourceId: `craig-${"a".repeat(64)}`,
			publicationId: digest,
			profileId: "qwen-quality",
			transcriptSha256: digest,
		});
	});
});
