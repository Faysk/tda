import { describe, expect, it } from "vitest";
import fixture from "./fixtures/python-import.json";
import { syncTranscript } from "./client";
import { deniedImportDependencies, consumeTranscript } from "./consumer";
import {
	IMPORT_VERSION,
	MAX_IMPORT_BYTES,
	RECEIPT_VERSION,
	type ImportReceipt,
	type PreparedImport,
} from "./contract";
import { createImportHandler } from "./http";
import { prepareImport, sha256 } from "./validate";

const raw = JSON.stringify(fixture);
const parsed = prepareImport(raw);
if (!parsed.ok) throw new Error(parsed.reason);
const prepared: PreparedImport = parsed.value;
const receipt: ImportReceipt = {
	...prepared,
	schemaVersion: RECEIPT_VERSION,
	status: "committed",
	receiptId: "33333333-3333-4333-8333-333333333333",
	segmentCount: 2,
	committedAt: "2026-01-01T12:00:00Z",
};
function modify(change: (input: typeof fixture) => void, rehash = false) {
	const input = structuredClone(fixture);
	change(input);
	if (rehash) {
		const {
			publication_id: _id,
			generated_at: _time,
			...payload
		} = input.result.publication_bundle;
		input.result.import_artifacts.publication_payload_json =
			JSON.stringify(payload);
		input.result.publication_bundle.publication_id = sha256(
			JSON.stringify(payload),
		);
	}
	return JSON.stringify(input);
}

describe("Python exporter compatibility and boundary", () => {
	it("verifies original Python floats/UTF8 hashes and preserves every segment", () => {
		expect(fixture.result.import_artifacts.transcript_json).toContain(
			'"start":1.0',
		);
		expect(prepared.publicationId).toBe(
			"f2950f2ae3d35e1f342985d93034dd434c1c2369faea97359208d4f359d94369",
		);
		expect(prepared.segments).toEqual([
			{
				sourceSegmentId: "speaker-0",
				startMs: 1000,
				endMs: 2125,
				text: "Olá, dragão 🐉!",
				speakerName: "Jogadora Á",
				trackKey: "track-1.flac",
			},
			{
				sourceSegmentId: "speaker-1",
				startMs: 2500,
				endMs: 4000,
				text: "A porta está fechada.",
				speakerName: "Mestre",
				trackKey: "track-2.flac",
			},
		]);
	});
	it("requires transcript artifacts, strict versions and size", () => {
		expect(
			prepareImport(
				JSON.stringify({
					schemaVersion: IMPORT_VERSION,
					result: { publication_bundle: fixture.result.publication_bundle },
				}),
			).ok,
		).toBe(false);
		expect(
			prepareImport(
				modify((v) => {
					v.schemaVersion = "v2";
				}),
			),
		).toEqual({ ok: false, reason: "unsupported_version" });
		expect(prepareImport(" ".repeat(MAX_IMPORT_BYTES + 1))).toEqual({
			ok: false,
			reason: "too_large",
		});
	});
	it("rejects altered hash, empty timeline, synthetic runtime and crossed source", () => {
		expect(
			prepareImport(
				modify((v) => {
					v.result.import_artifacts.transcript_json += " ";
				}),
			),
		).toEqual({ ok: false, reason: "hash_mismatch" });
		expect(
			prepareImport(
				modify((v) => {
					v.result.publication_bundle.source_manifest.recording_format =
						"synthetic.fixture";
				}, true),
			),
		).toEqual({ ok: false, reason: "synthetic_payload" });
		expect(
			prepareImport(
				modify((v) => {
					v.result.source_id = "other";
				}),
			).ok,
		).toBe(false);
		expect(
			prepareImport(
				modify((v) => {
					v.result.import_artifacts.transcript_json = "[]";
					v.result.publication_bundle.source_manifest.transcript_sha256 =
						sha256("[]");
					v.result.publication_bundle.source_manifest.transcript_segments = 0;
				}, true),
			).ok,
		).toBe(false);
	});
	it("rejects path and unexpected fields even with valid recomputed hashes", () => {
		const invalid = modify((v) => {
			const timeline = JSON.parse(v.result.import_artifacts.transcript_json);
			timeline[0].track = "C:/private/audio.flac";
			v.result.import_artifacts.transcript_json = JSON.stringify(timeline);
			v.result.publication_bundle.source_manifest.transcript_sha256 = sha256(
				v.result.import_artifacts.transcript_json,
			);
		}, true);
		expect(prepareImport(invalid).ok).toBe(false);
		expect(prepareImport(JSON.stringify({ ...fixture, audio: "raw" })).ok).toBe(
			false,
		);
	});
});

describe("authenticated HTTP and receipt client", () => {
	it("default dependency stays denied regardless of valid login or payload", async () => {
		expect(
			await consumeTranscript(raw, "operator", deniedImportDependencies),
		).toEqual({ ok: false, reason: "import_capability_undefined" });
		expect(
			await consumeTranscript(raw, null, deniedImportDependencies),
		).toEqual({ ok: false, reason: "unauthenticated" });
	});
	it("rejects absent/foreign Origin before any authorization", async () => {
		let identities = 0;
		const handler = createImportHandler({
			origin: () => "https://tda.invalid",
			identity: async () => {
				identities++;
				return { ok: true, authUserId: "operator" };
			},
			consumer: deniedImportDependencies,
		});
		for (const origin of [null, "https://evil.invalid"]) {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (origin) headers.Origin = origin;
			expect(
				(
					await handler(
						new Request("https://tda.invalid/api/transcript-imports", {
							method: "POST",
							headers,
							body: raw,
						}),
					)
				).status,
			).toBe(403);
		}
		expect(identities).toBe(0);
	});
	it("stream size does not trust Content-Length", async () => {
		const handler = createImportHandler({
			origin: () => "https://tda.invalid",
			identity: async () => ({ ok: true, authUserId: "operator" }),
			consumer: deniedImportDependencies,
		});
		const result = await handler(
			new Request("https://tda.invalid/api/transcript-imports", {
				method: "POST",
				headers: {
					Origin: "https://tda.invalid",
					"Content-Type": "application/json",
					"Content-Length": "1",
				},
				body: " ".repeat(MAX_IMPORT_BYTES + 1),
			}),
		);
		expect(result.status).toBe(413);
	});
	it("requires readback with matching durable identity, count and receipt", async () => {
		for (const second of [
			null,
			{ ...receipt, status: "accepted" },
			{ ...receipt, sessionId: "other" },
			{ ...receipt, segmentCount: 3 },
			{ ...receipt, receiptId: "44444444-4444-4444-8444-444444444444" },
		]) {
			let calls = 0;
			const state = await syncTranscript(
				{ result: fixture.result, expected: prepared, segmentCount: 2 },
				undefined,
				async (_path, init) => {
					expect(init.credentials).toBe("same-origin");
					expect(init.headers).toEqual({ "Content-Type": "application/json" });
					return Response.json({
						ok: true,
						receipt: calls++ ? second : receipt,
					});
				},
			);
			expect(state.status).toBe("pending");
		}
	});
	it("lost response never marks synchronized", async () => {
		const state = await syncTranscript(
			{ result: fixture.result, expected: prepared, segmentCount: 2 },
			undefined,
			async () => {
				throw new Error("connection lost after commit");
			},
		);
		expect(state).toEqual({ status: "pending", reason: "retry_required" });
	});
});
