import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const service = "http://127.0.0.1:8765/api/v1";
const uiOrigin = "http://127.0.0.1:3102";
const browserToken = "browser_session_token_12345678901234567890";
const sourceSha = "a".repeat(64);
const sourceId = "craig-" + sourceSha;
const transcriptSha = "b".repeat(64);

function headers() {
	return { "Access-Control-Allow-Origin": uiOrigin };
}

function capabilities(prepared: boolean) {
	return {
		capabilities: ["transcription.prepare", "transcription.craig", "job.events"],
		sync: false,
		device: { id: "fixture-device", label: "Companion sintético" },
		transcription: {
			profiles: prepared ? ["qwen-quality"] : [],
			catalog: [
				{
					id: "qwen-quality",
					engine: "qwen3",
					ready: prepared,
					preparation_required: !prepared,
					reason: prepared ? null : "QWEN_PHYSICAL_ACCEPTANCE_REQUIRED",
				},
			],
		},
	};
}

function job(status: "queued" | "running" | "succeeded") {
	return {
		id: "craig-job-1",
		kind: "transcription.craig",
		status,
		stage:
			status === "queued"
				? "queued"
				: status === "running"
					? "transcription"
					: "complete",
		progress:
			status === "queued"
				? { completed: 0, total: 1, unit: "tracks" }
				: { completed: 1, total: 1, unit: "tracks" },
		error: null,
		result_available: status === "succeeded",
		updated_at: "2026-09-20T19:30:00Z",
		attempt: 1,
		context: {
			campaign_id: "yuhara-main",
			session_id: "sessao-42",
			source_id: sourceId,
			profile_id: "qwen-quality",
		},
	};
}

async function fillCraigForm(page: import("@playwright/test").Page) {
	await page.getByLabel("ID da sessão").fill("sessao-42");
	await page.getByLabel("Contexto opcional").fill("Conselho em Neverwinter.");
	await page.getByLabel("Glossário opcional").fill("Valyndra, Yllith");
	await page.getByLabel("Export do Craig").setInputFiles({
		name: "craig-synthetic.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic Craig fixture"),
	});
}

test("Craig journey uses browser session, preparation, queue, progress and immutable result identity", async ({
	page,
}) => {
	let prepared = false;
	let submitted = false;
	let jobsReadAfterSubmit = 0;
	let sessionCalls = 0;
	const mutations: string[] = [];

	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health"))
			return route.fulfill({
				headers: headers(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session")) {
			sessionCalls += 1;
			return route.fulfill({
				headers: headers(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		}
		expect(request.headers().authorization).toBe("Bearer " + browserToken);

		if (path.endsWith("/capabilities"))
			return route.fulfill({ headers: headers(), json: capabilities(prepared) });

		if (path.endsWith("/sources/craig") && request.method() === "POST") {
			mutations.push("upload");
			expect(request.headers()["content-type"]).toContain("application/zip");
			return route.fulfill({
				headers: headers(),
				json: {
					schema_version: "tda_craig_ingest_v1",
					source_id: sourceId,
					source_sha256: sourceSha,
					size_bytes: 24,
					track_count: 1,
					reused: false,
				},
			});
		}

		if (path.endsWith("/preparation") && request.method() === "POST") {
			mutations.push("prepare");
			prepared = true;
			return route.fulfill({
				headers: headers(),
				json: {
					schema: "tda_profile_preparation_v1",
					state: "completed",
					active: false,
					operation_id: "prepare-1",
					source_id: sourceId,
					profile_id: "qwen-quality",
					engine: "qwen3",
					stage: "complete",
					title: "Perfil pronto",
					detail: "",
					sequence: 2,
					error_code: null,
					elapsed_seconds: 1,
				},
			});
		}

		if (path.endsWith("/jobs") && request.method() === "POST") {
			mutations.push("submit");
			const key = request.headers()["idempotency-key"];
			expect(key).toBeTruthy();
			const body = request.postDataJSON();
			expect(body).toMatchObject({
				kind: "transcription.craig",
				campaign_id: "yuhara-main",
				session_id: "sessao-42",
				source_id: sourceId,
				profile_id: "qwen-quality",
				context: "Conselho em Neverwinter.",
				glossary: "Valyndra, Yllith",
				cpu: false,
			});
			submitted = true;
			return route.fulfill({ headers: headers(), json: job("queued") });
		}

		if (path.endsWith("/jobs") && request.method() === "GET") {
			if (!submitted)
				return route.fulfill({ headers: headers(), json: { jobs: [] } });
			jobsReadAfterSubmit += 1;
			const state =
				jobsReadAfterSubmit === 1
					? "queued"
					: jobsReadAfterSubmit === 2
						? "running"
						: "succeeded";
			return route.fulfill({ headers: headers(), json: { jobs: [job(state)] } });
		}

		if (path.endsWith("/events"))
			return route.fulfill({
				headers: headers(),
				json: {
					events: [
						{
							seq: 1,
							code: "QWEN_WINDOW_TRANSCRIBED",
							at: "2026-09-20T19:30:00Z",
							level: "info",
							data: { track: 1, total_tracks: 1, speaker: "Alice", window: 1 },
						},
					],
				},
			});

		if (path.endsWith("/result"))
			return route.fulfill({
				headers: headers(),
				json: {
					schema_version: "tda_local_result_v1",
					campaign_id: "yuhara-main",
					session_id: "sessao-42",
					source_id: sourceId,
					job_id: "craig-job-1",
					transcription: {
						schema_version: "tda_transcript_v1",
						profile_id: "qwen-quality",
						artifact: "transcript.json",
						run_id: "run-craig-job-1-a1",
						sha256: transcriptSha,
					},
					sync: { status: "not_configured" },
				},
			});

		throw new Error("unexpected request: " + request.method() + " " + path);
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Nova transcrição Craig" })).toBeVisible();
	await fillCraigForm(page);
	await page.getByRole("button", { name: "Adicionar à fila local" }).click();

	await expect(page.getByText(/entrou na fila local/)).toBeVisible();
	expect(mutations).toEqual(["upload", "prepare", "submit"]);
	expect(sessionCalls).toBe(1);

	for (let index = 0; index < 3; index += 1) {
		await page.getByRole("button", { name: "Atualizar estado" }).click();
	}
	await expect(page.getByText("Concluído localmente", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Consultar resultado local" }).click();
	await expect(page.getByText("Resultado local", { exact: true })).toBeVisible();
	await expect(page.getByText(/run-craig-job-1-a1/i)).toBeVisible();
	await expect(page.getByText(transcriptSha.slice(0, 12), { exact: false })).toBeVisible();

	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
	).toBe(true);
});

test("ambiguous submit reuses the exact idempotency key on retry", async ({ page }) => {
	let attempts = 0;
	let firstKey = "";
	let submitted = false;

	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health"))
			return route.fulfill({
				headers: headers(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session"))
			return route.fulfill({
				headers: headers(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		if (path.endsWith("/capabilities"))
			return route.fulfill({ headers: headers(), json: capabilities(true) });
		if (path.endsWith("/sources/craig"))
			return route.fulfill({
				headers: headers(),
				json: {
					schema_version: "tda_craig_ingest_v1",
					source_id: sourceId,
					source_sha256: sourceSha,
					size_bytes: 24,
					track_count: 1,
					reused: false,
				},
			});
		if (path.endsWith("/jobs") && request.method() === "POST") {
			attempts += 1;
			const key = request.headers()["idempotency-key"] ?? "";
			if (attempts === 1) {
				firstKey = key;
				return route.abort("failed");
			}
			expect(key).toBe(firstKey);
			submitted = true;
			return route.fulfill({ headers: headers(), json: job("queued") });
		}
		if (path.endsWith("/jobs"))
			return route.fulfill({
				headers: headers(),
				json: { jobs: submitted ? [job("queued")] : [] },
			});
		throw new Error("unexpected request: " + path);
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await fillCraigForm(page);
	await page.getByRole("button", { name: "Adicionar à fila local" }).click();
	await expect(page.getByText(/tentativa ficou ambígua/)).toBeVisible();
	await page.getByRole("button", { name: "Adicionar à fila local" }).click();
	await expect(page.getByText(/entrou na fila local/)).toBeVisible();
	expect(attempts).toBe(2);
	expect(firstKey.length).toBeGreaterThan(10);
});

test("UTF-8 envelope overflow is blocked before upload or job submission", async ({
	page,
}) => {
	let mutations = 0;
	await page.route(service + "/**", async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith("/health"))
			return route.fulfill({
				headers: headers(),
				json: { api_version: "1", service_version: "0.3.14", lifecycle: "ready" },
			});
		if (path.endsWith("/session"))
			return route.fulfill({
				headers: headers(),
				json: {
					schema: "tda_loopback_session_v1",
					token: browserToken,
					expires_in_seconds: 300,
				},
			});
		if (path.endsWith("/capabilities"))
			return route.fulfill({ headers: headers(), json: capabilities(true) });
		if (request.method() === "POST") mutations += 1;
		if (path.endsWith("/jobs"))
			return route.fulfill({ headers: headers(), json: { jobs: [] } });
		throw new Error("unexpected mutation: " + path);
	});

	await page.goto("/");
	await expect(page.getByText("Pronto", { exact: true })).toBeVisible();
	await page.getByLabel("ID da sessão").fill("sessao-42");
	await page.getByLabel("Contexto opcional").fill("😀".repeat(1000));
	await page.getByLabel("Export do Craig").setInputFiles({
		name: "craig-synthetic.zip",
		mimeType: "application/zip",
		buffer: Buffer.from("PK synthetic Craig fixture"),
	});

	await expect(page.getByRole("alert")).toContainText("bytes UTF-8");
	await expect(page.getByRole("button", { name: "Adicionar à fila local" })).toBeDisabled();
	expect(mutations).toBe(0);
});
