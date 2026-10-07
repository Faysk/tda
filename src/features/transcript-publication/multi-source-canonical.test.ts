import { describe, expect, it } from "vitest";
import {
	MULTI_SOURCE_PUBLICATION_PAYLOAD_VERSION,
	MULTI_SOURCE_PUBLICATION_REQUEST_VERSION,
	preparePublication,
	sha256Utf8,
} from "./contract";

const ASSEMBLY_ID = "a".repeat(64);
const TRANSCRIPT_SHA = "b".repeat(64);
const DRAFT_SHA = "c".repeat(64);
const TIMELINE_SHA = "d".repeat(64);
const PARTICIPANT_SHA = "e".repeat(64);

function hexId(value: number, width: number) {
	return value.toString(16).padStart(width, "0");
}

function requestValue(partCount = 2) {
	const parts = Array.from({ length: partCount }, (_, index) => {
		const sourceSha = hexId(index + 1, 64);
		return {
			partId: hexId(index + 1, 32),
			sourceId: `craig-${sourceSha}`,
			sourceSha256: sourceSha,
			runId: `run-${index + 1}`,
			transcriptSha256: hexId(index + 101, 64),
			ordinal: index,
			sessionOffsetSeconds: index * 60,
			trimStartSeconds: 0,
			trimEndSeconds: null,
			overlapResolution: null,
			overlapBoundarySeconds: null,
		};
	});
	const segments = parts.map((part, index) => ({
		assemblySegmentId: hexId(index + 201, 64),
		partId: part.partId,
		sourceId: part.sourceId,
		runId: part.runId,
		sourceSegmentId: `segment-${index + 1}`,
		trackNumber: index + 1,
		start: index * 60,
		end: index * 60 + 1,
		text: "fala",
		speaker: `Pessoa ${index + 1}`,
		reviewed: true,
	}));

	return {
		schemaVersion: MULTI_SOURCE_PUBLICATION_REQUEST_VERSION,
		operationId: "11111111-1111-4111-8111-111111111111",
		expectedCurrentRevisionId: null,
		target: {
			schemaVersion: "tda_publication_session_target_v1",
			campaignSlug: "yuhara-main",
			sourceSessionId: "sessao-851",
		},
		assembly: {
			schemaVersion: "tda_session_assembly_v1",
			canonicalizationVersion: "tda_session_assembly_canonical_v1",
			assemblyId: ASSEMBLY_ID,
			inputsSha256: ASSEMBLY_ID,
			campaignId: "yuhara-main",
			sessionId: "sessao-851",
			transcriptSha256: TRANSCRIPT_SHA,
			timingPolicyVersion: "tda_session_timeline_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			timelineFingerprintSha256: TIMELINE_SHA,
			participantMappingSchemaVersion: "tda_session_participant_mapping_v1",
			participantMappingPolicy: "strong_discord_or_manual_v1",
			participantMappingSha256: PARTICIPANT_SHA,
			parts,
		},
		review: {
			baseTranscriptSha256: TRANSCRIPT_SHA,
			draftRevision: 1,
			draftSha256: DRAFT_SHA,
			status: "approved_local",
			warnings: [],
			review: {
				reviewedSegments: segments.length,
				totalSegments: segments.length,
				reviewPercent: 100,
				editedSegments: 0,
				wordCount: segments.length,
				warningCount: 0,
			},
			segments,
		},
	};
}

describe("multi-source transcript publication contract", () => {
	it("preserves v3 exact overlap identity and rejects downgraded or untrusted overlap", () => {
		const input = requestValue(2);
		Object.assign(input.assembly, {
			canonicalizationVersion: "tda_session_assembly_canonical_v3",
			timingPolicyVersion: "tda_session_timeline_v2",
			timelineStrategy: "trusted_absolute",
			wallClock: "trusted",
			unknownIntervalCount: 0,
		});
		Object.assign(input.assembly.parts[0], { physicalIntervalState: "first" });
		Object.assign(input.assembly.parts[1], {
			physicalIntervalState: "trusted_absolute",
			overlapResolution: "preserve_both_exact_v1",
			overlapBoundarySeconds: null,
		});
		const result = preparePublication(JSON.stringify(input));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.provenance?.canonicalization_version).toBe(
			"tda_session_assembly_canonical_v3",
		);
		expect(result.value.provenance?.parts[1].overlap_resolution).toBe(
			"preserve_both_exact_v1",
		);
		for (const mutation of [
			{ canonicalizationVersion: "tda_session_assembly_canonical_v2" },
			{ canonicalizationVersion: "unknown" },
		]) {
			const invalid = structuredClone(input);
			Object.assign(invalid.assembly, mutation);
			expect(preparePublication(JSON.stringify(invalid))).toEqual({
				ok: false,
				reason: "invalid_payload",
			});
		}
		for (const mutation of [
			{ physicalIntervalState: "manual" },
			{ overlapBoundarySeconds: 60 },
		]) {
			const invalid = structuredClone(input);
			Object.assign(invalid.assembly.parts[1], mutation);
			expect(preparePublication(JSON.stringify(invalid))).toEqual({
				ok: false,
				reason: "invalid_payload",
			});
		}
	});

	it.each([1, 2, 20])(
		"canonicalizes %i ordered parts without inventing a primary source",
		(partCount) => {
			const input = requestValue(partCount);
			const result = preparePublication(JSON.stringify(input));
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.publicationKind).toBe("session_assembly");
			expect(result.value.sourceId).toBeNull();
			expect(result.value.runId).toBeNull();
			const provenance = result.value.provenance;
			if (!provenance) throw new Error("expected assembly provenance");
			expect(provenance.parts).toHaveLength(partCount);
			expect(provenance.parts.map((part) => part.ordinal)).toEqual(
				Array.from({ length: partCount }, (_, index) => index),
			);
			expect(result.value.payloadSha256).toBe(
				sha256Utf8(result.value.payloadJson),
			);

			const payload = JSON.parse(result.value.payloadJson);
			expect(payload.schema_version).toBe(
				MULTI_SOURCE_PUBLICATION_PAYLOAD_VERSION,
			);
			expect(payload.publication_kind).toBe("session_assembly");
			expect(payload.provenance.parts).toHaveLength(partCount);
			expect(payload).not.toHaveProperty("source_id");
			expect(payload).not.toHaveProperty("run_id");
		},
	);

	it("preserves user-confirmed sequence provenance without inventing wall-clock gaps", () => {
		const input = requestValue(3);
		Object.assign(input.assembly as Record<string, unknown>, {
			canonicalizationVersion: "tda_session_assembly_canonical_v2",
			timingPolicyVersion: "tda_session_timeline_v2",
			timelineStrategy: "user_confirmed_sequence",
			wallClock: "partial",
			unknownIntervalCount: 1,
		});
		Object.assign(input.assembly.parts[0] as Record<string, unknown>, {
			physicalIntervalState: "first",
		});
		Object.assign(input.assembly.parts[1] as Record<string, unknown>, {
			physicalIntervalState: "trusted_absolute",
		});
		Object.assign(input.assembly.parts[2] as Record<string, unknown>, {
			physicalIntervalState: "unknown",
		});

		const result = preparePublication(JSON.stringify(input));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const provenance = result.value.provenance;
		if (!provenance) throw new Error("expected assembly provenance");
		expect(provenance).toMatchObject({
			canonicalization_version: "tda_session_assembly_canonical_v2",
			timing_policy_version: "tda_session_timeline_v2",
			timeline_strategy: "user_confirmed_sequence",
			wall_clock: "partial",
			unknown_interval_count: 1,
		});
		expect(
			provenance.parts.map((part) => part.physical_interval_state),
		).toEqual(["first", "trusted_absolute", "unknown"]);

		const tampered = structuredClone(input);
		Object.assign(tampered.assembly as Record<string, unknown>, {
			unknownIntervalCount: 0,
		});
		expect(preparePublication(JSON.stringify(tampered))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});

	it("preserves trusted wall-clock provenance for each assembly source", () => {
		const input = requestValue(2);
		Object.assign(input.review.segments[0] as Record<string, unknown>, {
			absoluteTime: {
				startIso: "2026-09-12T23:59:59+01:00",
				endIso: "2026-09-13T00:00:00+01:00",
				source: input.review.segments[0].sourceId,
			},
		});
		const result = preparePublication(JSON.stringify(input));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(JSON.parse(result.value.payloadJson).segments[0]).toMatchObject({
			absolute_time_state: "trusted_absolute",
			absolute_start: "2026-09-12T23:59:59+01:00",
			absolute_end: "2026-09-13T00:00:00+01:00",
			absolute_time_source: input.review.segments[0].sourceId,
		});

		const tampered = requestValue(2);
		Object.assign(tampered.review.segments[0] as Record<string, unknown>, {
			absoluteTime: {
				startIso: "2026-09-12T23:59:59+01:00",
				endIso: "2026-09-13T00:00:00+01:00",
				source: tampered.review.segments[1].sourceId,
			},
		});
		expect(preparePublication(JSON.stringify(tampered))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});

	it("rejects duplicate part/source identity and non-contiguous ordinals", () => {
		for (const mutate of [
			(value: ReturnType<typeof requestValue>) => {
				value.assembly.parts[1].partId = value.assembly.parts[0].partId;
			},
			(value: ReturnType<typeof requestValue>) => {
				value.assembly.parts[1].sourceId = value.assembly.parts[0].sourceId;
				value.assembly.parts[1].sourceSha256 =
					value.assembly.parts[0].sourceSha256;
			},
			(value: ReturnType<typeof requestValue>) => {
				value.assembly.parts[1].ordinal = 7;
			},
		]) {
			const input = requestValue(2);
			mutate(input);
			expect(preparePublication(JSON.stringify(input))).toEqual({
				ok: false,
				reason: "invalid_payload",
			});
		}
	});

	it("binds reviewed segments to the exact part/source/run provenance", () => {
		for (const patch of [
			{ sourceId: `craig-${"f".repeat(64)}` },
			{ runId: "run-tampered" },
			{ partId: "f".repeat(32) },
		]) {
			const input = requestValue(2);
			Object.assign(input.review.segments[0], patch);
			expect(preparePublication(JSON.stringify(input))).toEqual({
				ok: false,
				reason: "invalid_payload",
			});
		}
	});

	it("rejects assembly/transcript drift and unknown privacy-sensitive metadata", () => {
		const transcriptDrift = requestValue(2);
		transcriptDrift.review.baseTranscriptSha256 = "f".repeat(64);
		expect(preparePublication(JSON.stringify(transcriptDrift))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});

		const assemblyDrift = requestValue(2);
		assemblyDrift.assembly.inputsSha256 = "f".repeat(64);
		expect(preparePublication(JSON.stringify(assemblyDrift))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});

		const privateMetadata = requestValue(2) as ReturnType<
			typeof requestValue
		> & {
			localPath?: string;
		};
		privateMetadata.localPath = "C:\\Users\\fixture\\private.zip";
		expect(preparePublication(JSON.stringify(privateMetadata))).toEqual({
			ok: false,
			reason: "invalid_payload",
		});
	});
});
