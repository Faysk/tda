import { expect, test } from "@playwright/test";
import {
	CRAIG_SOURCE_ID,
	SECOND_SOURCE_ID,
	TRANSCRIPT_SHA,
	fixtureReview,
	fixtureRun,
	installCompanionFixture,
} from "./companion-fixture";

function reviewSummary(
	status: "draft" | "reviewed" | "approved_local",
	revision = 1,
) {
	return {
		schema_version: "tda_local_review_summary_v1",
		status,
		draft_revision: revision,
		updated_at: "2026-09-25T10:05:00Z",
	};
}

function runSet(count: number) {
	return Array.from({ length: count }, (_, index) => {
		const id = `run-library-${String(index + 1).padStart(2, "0")}`;
		const profile = index % 2 === 0 ? "qwen-quality" : "whisper-detailed";
		const engine = profile === "qwen-quality" ? "qwen3" : "faster-whisper";
		const seconds = 120 + index * 9;
		const rtf = 0.12 + index * 0.01;
		return fixtureRun(id, {
			profile_id: profile,
			engine,
			model: profile === "qwen-quality" ? "Qwen3-ASR" : "large-v3",
			completed_at: new Date(
				Date.parse("2026-09-25T10:00:00Z") - index * 60_000,
			).toISOString(),
			stats: {
				audio_work_seconds: 3600,
				processing_seconds: seconds,
				session_duration_seconds: 1800,
				rtf,
				word_count: 10_000 + index,
				segment_count: 700 + index,
				track_count: 4,
				turn_count: 300 + index,
				deduplicated_segment_count: index,
				warning_count: index % 7 === 0 ? 2 : 0,
			},
			publication_target: {
				schema_version: "tda_publication_target_v1",
				campaign_slug: "yuhara-main",
				source_session_id: `sessao-${String(index + 1).padStart(2, "0")}`,
				source_id: CRAIG_SOURCE_ID,
				run_id: id,
				job_id: `job-${index + 1}`,
				attempt: 1,
				transcript_sha256: TRANSCRIPT_SHA,
			},
			review_summary:
				index === 0
					? reviewSummary("draft")
					: index === 1
						? reviewSummary("reviewed", 2)
						: index === 2
							? reviewSummary("approved_local", 3)
							: null,
		});
	});
}

async function openResults(page: import("@playwright/test").Page) {
	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.locator("[data-results-library='true']")).toBeVisible();
}

test("biblioteca escala para dezenas de runs e mantém detalhe somente no selecionado", async ({
	page,
}) => {
	const runs = runSet(30);
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		localRuns: runs,
		localReviews: {
			"run-library-01": fixtureReview("run-library-01", {
				status: "draft",
				draft_revision: 1,
			}),
		},
	});

	await openResults(page);

	const library = page.locator("[data-results-library='true']");
	await expect(library).toContainText("30 runs");
	await expect(
		library.getByRole("button", { name: /sessao-01/i }),
	).toBeVisible();
	await expect(
		library.getByRole("button", { name: /sessao-30/i }),
	).toBeVisible();

	if ((page.viewportSize()?.width ?? 1024) <= 760)
		await library.getByRole("button", { name: /sessao-01/i }).click();

	await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Output" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Execution" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Revisar", exact: true })).toHaveCount(1);
	await expect(page.getByText("Source ID", { exact: true })).not.toBeVisible();

	await page.getByText("Integrity e IDs", { exact: true }).click();
	await expect(page.getByText("Source ID", { exact: true })).toBeVisible();
	await expect(page.getByText("Transcript SHA-256", { exact: true })).toBeVisible();
});

test("search filtros review/lineage e sorting usam somente fatos do run", async ({
	page,
}) => {
	const legacy = fixtureRun("run-legacy", {
		source_id: SECOND_SOURCE_ID,
		profile_id: "qwen-fast",
		engine: "qwen3",
		execution_lineage: null,
		completed_at: "2026-08-01T08:00:00Z",
		transcript_sha256: "f".repeat(64),
		publication_target: null,
		review_summary: {
			schema_version: "tda_local_review_summary_v1",
			status: "invalid",
			draft_revision: null,
			updated_at: null,
		},
	});
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		localRuns: [...runSet(8), legacy],
	});

	await openResults(page);
	const library = page.locator("[data-results-library='true']");

	await library.getByLabel("Buscar").fill("sessao-02");
	await expect(library).toContainText("1 de 9 runs");
	await expect(
		library.getByRole("button", { name: /sessao-02/i }),
	).toBeVisible();

	await library.getByLabel("Buscar").fill("");
	await library.getByLabel("Profile").selectOption("whisper-detailed");
	await expect(library).toContainText("4 de 9 runs");

	await library.getByLabel("Profile").selectOption("all");
	await library.getByText("Mais filtros", { exact: true }).click();
	await library.getByLabel("Revisão").selectOption("approved_local");
	await expect(
		library.getByRole("button", { name: /sessao-03/i }),
	).toBeVisible();

	await library.getByLabel("Revisão").selectOption("all");
	await library.getByLabel("Lineage").selectOption("legacy");
	const legacyRun = library.getByRole("button", { name: /craig-/i });
	await expect(legacyRun).toHaveCount(1);
	await legacyRun.click();
	await expect(
		page.getByText("Lineage histórico não registrado.", { exact: true }),
	).toBeVisible();

	await library.getByLabel("Lineage").selectOption("all");
	await library.getByLabel("Ordenar").selectOption("rtf");
	const firstItem = library.locator("button[data-selected]").first();
	await expect(firstItem).toContainText("sessao-01");
});

test("run listing não carrega transcript e revisar preserva seleção e dirty state entre tabs", async ({
	page,
}) => {
	const run = fixtureRun("run-review-e2e", {
		review_summary: reviewSummary("draft", 1),
	});
	const review = fixtureReview("run-review-e2e", {
		draft_revision: 1,
		status: "draft",
		draft_sha256: "9".repeat(64),
	});
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		localRuns: [run],
		localReviews: { "run-review-e2e": review },
	});

	await openResults(page);

	expect(state.requests.filter((item) => item.path.endsWith("/review"))).toHaveLength(0);
	const selectedRun = page.getByRole("button", { name: /sessao-42/i });
	if ((page.viewportSize()?.width ?? 1024) <= 760) await selectedRun.click();
	await expect(
		page.locator("[data-results-detail='true']"),
	).toContainText("Draft");

	await page.getByRole("button", { name: "Revisar", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Qwen Quality" })).toBeVisible();
	expect(
		state.requests.filter(
			(item) =>
				item.method === "GET" &&
				item.path.endsWith("/run-review-e2e/review"),
		),
	).toHaveLength(1);

	const editor = page.locator("section[aria-labelledby='local-review-title']");
	const text = editor.getByLabel("Texto").first();
	await text.fill("Texto alterado e ainda não salvo");
	await expect(page.getByText("Alterações não salvas neste draft.", { exact: true })).toBeVisible();

	await page.getByRole("tab", { name: "Fila" }).click();
	await page.getByRole("tab", { name: "Resultados" }).click();
	await expect(page.getByLabel("Texto").first()).toHaveValue(
		"Texto alterado e ainda não salvo",
	);

	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "Voltar aos resultados" }).click();

	await expect(page.locator("[data-results-library='true']")).toHaveAttribute(
		"data-detail-open",
		"true",
	);
	await expect(
		page.locator("[data-results-detail='true']").getByRole("heading", {
			name: "sessao-42",
		}),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Revisar", exact: true })).toBeVisible();
});

test("salvar revisão atualiza o badge do run imediatamente sem refetch da biblioteca", async ({
	page,
}) => {
	const run = fixtureRun("run-save-state", {
		review_summary: reviewSummary("draft", 0),
	});
	const review = fixtureReview("run-save-state");
	const state = await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		localRuns: [run],
		localReviews: { "run-save-state": review },
	});

	await openResults(page);
	const selectedRun = page.getByRole("button", { name: /sessao-42/i });
	if ((page.viewportSize()?.width ?? 1024) <= 760) await selectedRun.click();
	await page.getByRole("button", { name: "Revisar", exact: true }).click();

	await page.getByLabel("Estado do draft").selectOption("approved_local");
	await page.getByRole("button", { name: "Salvar revisão" }).click();
	await expect(
		page.getByText("Draft salvo localmente.", { exact: true }),
	).toBeVisible();

	const libraryReadsBefore = state.requests.filter(
		(item) => item.path === "/sources" || /\/sources\/[^/]+\/runs$/u.test(item.path),
	).length;

	await page.getByRole("button", { name: "Voltar aos resultados" }).click();

	await expect(
		page.locator("[data-results-detail='true']"),
	).toContainText("Aprovado localmente");
	const libraryReadsAfter = state.requests.filter(
		(item) => item.path === "/sources" || /\/sources\/[^/]+\/runs$/u.test(item.path),
	).length;
	expect(libraryReadsAfter).toBe(libraryReadsBefore);
	expect(
		state.requests.filter(
			(item) => item.method === "POST" && item.path.endsWith("/review"),
		),
	).toHaveLength(1);
});

test("mobile usa lista → detalhe → voltar sem split comprimido", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 780 });
	await installCompanionFixture(page, {
		profileReady: true,
		advanceJobs: false,
		localRuns: runSet(6),
	});

	await openResults(page);
	const library = page.locator("[data-results-library='true']");
	await expect(library.getByRole("button", { name: /sessao-01/i })).toBeVisible();
	await expect(page.getByRole("button", { name: "Voltar à lista" })).not.toBeVisible();

	await library.getByRole("button", { name: /sessao-01/i }).click();
	await expect(page.getByRole("button", { name: "Voltar à lista" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);

	await page.getByRole("button", { name: "Voltar à lista" }).click();
	await expect(library.getByRole("button", { name: /sessao-01/i })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Performance" })).not.toBeVisible();
});
