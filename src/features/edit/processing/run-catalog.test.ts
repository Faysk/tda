import { expect, it } from "vitest";
import { parseLocalRunCatalogPage } from "./protocol";

const run = {
	run_id: "run-job-a1",
	status: "completed",
	source_id: "craig-" + "a".repeat(64),
	profile_id: "qwen-fast",
	engine: "qwen3",
	model: "model",
	model_revision: null,
	device: "cuda",
	compute_type: "float16",
	alignment: "forced",
	execution_lineage: null,
	language: "pt",
	completed_at: "2026-09-27T01:00:00.000Z",
	transcript_sha256: "b".repeat(64),
	transcript_size_bytes: 123,
	stats: {},
	publication_target: null,
	review: { status: "unknown", draft_revision: null, review_percent: null, updated_at: null },
};

it("parses bounded catalog pages and cursor state", () => {
	const page = parseLocalRunCatalogPage({
		schema_version: "tda_local_run_catalog_v1",
		runs: [run],
		has_more: true,
		next_cursor: "cursor-1",
	});
	expect(page.runs).toHaveLength(1);
	expect(page.runs[0]?.sourceId).toBe(run.source_id);
	expect(page.hasMore).toBe(true);
	expect(page.nextCursor).toBe("cursor-1");
});

it("rejects inconsistent pagination and duplicate run identities", () => {
	expect(() =>
		parseLocalRunCatalogPage({
			schema_version: "tda_local_run_catalog_v1",
			runs: [run],
			has_more: false,
			next_cursor: "unexpected",
		}),
	).toThrow();
	expect(() =>
		parseLocalRunCatalogPage({
			schema_version: "tda_local_run_catalog_v1",
			runs: [run, run],
			has_more: false,
			next_cursor: null,
		}),
	).toThrow();
});
