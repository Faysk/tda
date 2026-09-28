import { describe, expect, test } from "vitest";
import {
	parseSessionAssemblyList,
	parseSessionAssemblyManifest,
	parseSessionAssemblyReview,
} from "./protocol";

const SOURCE_SHA = "a".repeat(64);
const SOURCE_ID = `craig-${SOURCE_SHA}`;
const ASSEMBLY_ID = "b".repeat(64);
const TRANSCRIPT_SHA = "c".repeat(64);
const RUN_ID = "run-a";
const PART_ID = "d".repeat(32);
const PARTICIPANT_ID = "e".repeat(32);
const SEGMENT_ID = "f".repeat(64);

function manifest() {
	return {
		schema_version: "tda_session_assembly_v1",
		assembly_id: ASSEMBLY_ID,
		status: "completed",
		campaign_id: "yuhara",
		session_id: "sessao-42",
		canonicalization_version: "tda_session_assembly_canonical_v1",
		inputs_sha256: ASSEMBLY_ID,
		timeline_fingerprint_sha256: "1".repeat(64),
		participant_mapping_sha256: "2".repeat(64),
		participant_approval_blocked: false,
		transcript_artifact: "transcript.json",
		transcript_sha256: TRANSCRIPT_SHA,
		transcript_size_bytes: 512,
		segment_count: 1,
		created_at: "2026-09-28T01:00:00.000Z",
		parts: [
			{
				part_id: PART_ID,
				source_id: SOURCE_ID,
				source_sha256: SOURCE_SHA,
				run_id: RUN_ID,
				transcript_sha256: TRANSCRIPT_SHA,
				ordinal: 0,
				session_offset_seconds: 0,
				trim_start_seconds: 0,
				trim_end_seconds: null,
				overlap_resolution: null,
				overlap_boundary_seconds: null,
			},
		],
	};
}

describe("session assembly protocol", () => {
	test("parses an immutable assembly manifest and rejects source/hash mismatch", () => {
		const parsed = parseSessionAssemblyManifest(manifest());
		expect(parsed.assemblyId).toBe(ASSEMBLY_ID);
		expect(parsed.parts[0]).toMatchObject({
			sourceId: SOURCE_ID,
			runId: RUN_ID,
			ordinal: 0,
		});

		const invalid = structuredClone(manifest());
		invalid.parts[0]!.source_sha256 = "9".repeat(64);
		expect(() => parseSessionAssemblyManifest(invalid)).toThrow();
	});

	test("parses a bounded session assembly catalog", () => {
		const parsed = parseSessionAssemblyList({
			schema_version: "tda_session_assemblies_v1",
			campaign_id: "yuhara",
			session_id: "sessao-42",
			assemblies: [
				{
					assembly_id: ASSEMBLY_ID,
					transcript_sha256: TRANSCRIPT_SHA,
					inputs_sha256: ASSEMBLY_ID,
					segment_count: 1,
					part_count: 1,
					participant_approval_blocked: false,
					created_at: "2026-09-28T01:00:00.000Z",
				},
			],
		});
		expect(parsed.assemblies).toHaveLength(1);
		expect(parsed.assemblies[0]?.partCount).toBe(1);
	});

	test("parses assembly review provenance and CAS state", () => {
		const parsed = parseSessionAssemblyReview({
			schema_version: "tda_session_assembly_review_v1",
			snapshot_contract: "tda_session_assembly_review_cas_v1",
			persistence: "ephemeral_base",
			base: {
				kind: "session_assembly",
				assembly_id: ASSEMBLY_ID,
				transcript_sha256: TRANSCRIPT_SHA,
				inputs_sha256: ASSEMBLY_ID,
			},
			draft_revision: null,
			draft_sha256: null,
			status: "draft",
			approval_current: false,
			approval_blocked: false,
			approved_at: null,
			created_at: null,
			updated_at: null,
			review: {
				reviewed_segments: 0,
				total_segments: 1,
				review_percent: 0,
				edited_segments: 0,
				word_count: 1,
			},
			segments: [
				{
					assembly_segment_id: SEGMENT_ID,
					part_id: PART_ID,
					source_id: SOURCE_ID,
					run_id: RUN_ID,
					source_segment_id: "seg-1",
					track_number: 1,
					participant_id: PARTICIPANT_ID,
					start: 1,
					end: 2,
					text: "Olá",
					speaker: "Renan",
					reviewed: false,
				},
			],
		});
		expect(parsed.base.kind).toBe("session_assembly");
		expect(parsed.segments[0]?.sourceId).toBe(SOURCE_ID);
		expect(parsed.persistence).toBe("ephemeral_base");
	});
});
