import { describe, expect, test } from "vitest";
import {
	appendCraigFiles,
	markExactSourceDuplicates,
	moveCraigFileSelection,
	removeCraigFileSelection,
	reorderCraigFileSelection,
	uniqueStagedCraigSources,
} from "./craig-file-selection";
import type { CraigSource } from "./protocol";

function file(name: string, size = 10): File {
	return { name, size, lastModified: 1 } as File;
}

function source(seed: string): CraigSource {
	return {
		schemaVersion: "tda_craig_ingest_v1",
		sourceId: "craig-" + seed.repeat(64),
		sourceSha256: seed.repeat(64),
		recordingId: null,
		sizeBytes: 10,
		trackCount: 1,
		audioWorkSeconds: 10,
		sessionDurationSeconds: 10,
		minimumTrackDurationSeconds: 10,
		reused: false,
	};
}

describe("Craig multi-file selection", () => {
	test.each([1, 2, 3, 20])("keeps %i independently addressable ZIPs", (count) => {
		let sequence = 0;
		const selections = appendCraigFiles(
			[],
			Array.from({ length: count }, (_, index) => file(`part-${index + 1}.zip`)),
			() => `id-${++sequence}`,
		);
		expect(selections).toHaveLength(count);
		expect(new Set(selections.map((item) => item.id)).size).toBe(count);
		expect(selections.every((item) => item.state === "selected")).toBe(true);
	});

	test("keeps invalid files beside valid files instead of clearing the selection", () => {
		let sequence = 0;
		const selections = appendCraigFiles(
			[],
			[file("a.zip"), file("notes.txt"), file("empty.zip", 0), file("b.zip")],
			() => `id-${++sequence}`,
		);
		expect(selections.map((item) => item.state)).toEqual([
			"selected",
			"invalid",
			"invalid",
			"selected",
		]);
		expect(selections[1]?.error).toMatch(/\.zip/u);
		expect(selections[2]?.error).toMatch(/vazio/u);
	});

	test("appends later selections and removes only the requested item", () => {
		let sequence = 0;
		const first = appendCraigFiles([], [file("a.zip")], () => `id-${++sequence}`);
		const all = appendCraigFiles(first, [file("b.zip"), file("c.zip")], () => `id-${++sequence}`);
		expect(removeCraigFileSelection(all, "id-2").map((item) => item.file.name)).toEqual([
			"a.zip",
			"c.zip",
		]);
	});

	test("reorders the editorial session sequence deterministically", () => {
		let sequence = 0;
		const selections = appendCraigFiles(
			[],
			[file("a.zip"), file("b.zip"), file("c.zip")],
			() => `id-${++sequence}`,
		);
		expect(
			reorderCraigFileSelection(selections, "id-3", 0).map((item) => item.file.name),
		).toEqual(["c.zip", "a.zip", "b.zip"]);
		expect(
			moveCraigFileSelection(selections, "id-2", -1).map((item) => item.file.name),
		).toEqual(["b.zip", "a.zip", "c.zip"]);
		expect(
			moveCraigFileSelection(selections, "id-2", 1).map((item) => item.file.name),
		).toEqual(["a.zip", "c.zip", "b.zip"]);
	});

	test("keeps boundary moves stable even with twenty ZIPs", () => {
		let sequence = 0;
		const selections = appendCraigFiles(
			[],
			Array.from({ length: 20 }, (_, index) => file(`part-${index + 1}.zip`)),
			() => `id-${++sequence}`,
		);
		expect(moveCraigFileSelection(selections, "id-1", -1)).toEqual(selections);
		expect(moveCraigFileSelection(selections, "id-20", 1)).toEqual(selections);
	});

	test("marks exact staged source duplicates while preserving one canonical source", () => {
		const a = source("1");
		const b = source("2");
		const selections = [
			{ id: "a", file: file("a.zip"), state: "valid" as const, error: null, source: a },
			{ id: "a2", file: file("a-copy.zip"), state: "valid" as const, error: null, source: a },
			{ id: "b", file: file("b.zip"), state: "valid" as const, error: null, source: b },
		];
		const marked = markExactSourceDuplicates(selections);
		expect(marked.map((item) => item.state)).toEqual(["valid", "duplicate", "valid"]);
		expect(uniqueStagedCraigSources(marked).map((item) => item.sourceId)).toEqual([
			a.sourceId,
			b.sourceId,
		]);
	});
});
