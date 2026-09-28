import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const PRODUCTION_ORIGIN = "https://dnd.faysk.dev";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SOURCE_ID = /^craig-[0-9a-f]{64}$/u;
const RUN_ID = /^[A-Za-z0-9_-]{1,196}$/u;

function usage() {
	return `Usage:
  pnpm smoke:transcript-handoff:production -- \\
    --storage-state <playwright-storage-state.json> \\
    --source-id <craig-source-id> \\
    --run-id <approved-run-id> \\
    --confirm-production

The browser state must already be authenticated through the normal TDA login.
The selected local review must already be saved as approved_local and bound to a
real session. The script never creates users, sessions, reviews or transcript text.
`;
}

function required(values, key) {
	const value = values[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Missing --${key}\n\n${usage()}`);
	}
	return value.trim();
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function receiptFrom(value) {
	assert(value && typeof value === "object", "Publication response was not JSON.");
	const receipt = value.receipt;
	assert(value.ok === true && receipt && typeof receipt === "object", "Publication did not return a committed receipt.");
	assert(receipt.schemaVersion === "tda_transcript_publication_receipt_v1", "Unexpected publication receipt version.");
	assert(typeof receipt.receiptId === "string" && UUID.test(receipt.receiptId), "Invalid receipt id.");
	assert(typeof receipt.revisionId === "string" && UUID.test(receipt.revisionId), "Invalid revision id.");
	assert(Number.isSafeInteger(receipt.revisionNumber) && receipt.revisionNumber > 0, "Invalid revision number.");
	assert(typeof receipt.operationId === "string" && UUID.test(receipt.operationId), "Invalid receipt operation id.");
	return receipt;
}

function eventFrom(value, input) {
	assert(value && typeof value === "object", "Current mutation response was not JSON.");
	const event = value.event;
	assert(value.ok === true && event && typeof event === "object", "Current mutation did not return a committed event.");
	assert(event.schemaVersion === "tda_transcript_publication_event_v1", "Unexpected current mutation event version.");
	assert(typeof event.eventId === "string" && UUID.test(event.eventId), "Invalid event id.");
	assert(event.operationId === input.operationId, "Current mutation replay identity changed.");
	assert(event.revisionId === input.revisionId, "Current mutation returned a different revision.");
	assert(event.action === (input.revisionId === null ? "unpublish" : "restore"), "Current mutation returned the wrong action.");
	return event;
}

async function postFromPage(page, path, body) {
	return page.evaluate(
		async ({ path: requestPath, body: requestBody }) => {
			const response = await fetch(requestPath, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				cache: "no-store",
				redirect: "error",
				body: requestBody,
			});
			let json = null;
			try {
				json = await response.json();
			} catch {
				// The caller reports only status/reason; never echo the request body.
			}
			return { status: response.status, json };
		},
		{ path, body },
	);
}

async function readCurrent(page, target) {
	const response = await postFromPage(
		page,
		"/api/transcript-publications/current",
		JSON.stringify(target),
	);
	assert(response.status === 200, `Current read failed with HTTP ${response.status}.`);
	const current = response.json?.current;
	assert(response.json?.ok === true && current && typeof current === "object", "Current read did not return metadata.");
	assert(typeof current.actorProfileId === "string" && UUID.test(current.actorProfileId), "Current read returned an invalid actor.");
	assert(current.revisionId === null || (typeof current.revisionId === "string" && UUID.test(current.revisionId)), "Current read returned an invalid revision.");
	return current;
}

async function mutateCurrent(page, body, expectedStatus = 200) {
	const response = await postFromPage(
		page,
		"/api/transcript-publications/current/set",
		JSON.stringify(body),
	);
	assert(
		response.status === expectedStatus,
		`Current mutation returned HTTP ${response.status}; expected ${expectedStatus}.`,
	);
	return response.json;
}

const { values } = parseArgs({
	options: {
		"storage-state": { type: "string" },
		"source-id": { type: "string" },
		"run-id": { type: "string" },
		"confirm-production": { type: "boolean", default: false },
		headed: { type: "boolean", default: false },
		help: { type: "boolean", default: false },
	},
	allowPositionals: false,
});

if (values.help) {
	process.stdout.write(usage());
	process.exit(0);
}
if (!values["confirm-production"]) {
	throw new Error("Refusing to mutate Production without --confirm-production.");
}

const storageState = resolve(required(values, "storage-state"));
const sourceId = required(values, "source-id").toLowerCase();
const runId = required(values, "run-id");
assert(SOURCE_ID.test(sourceId), "--source-id must be the exact Craig source id.");
assert(RUN_ID.test(runId), "--run-id has an invalid format.");
await access(storageState);

const browser = await chromium.launch({ headless: !values.headed });
let rollbackInput = null;
let finalRestoreInput = null;
let rollbackCommitted = false;
let finalRestoreCommitted = false;

try {
	const context = await browser.newContext({ storageState });
	const page = await context.newPage();
	await page.goto(`${PRODUCTION_ORIGIN}/edit/processamento`, {
		waitUntil: "networkidle",
	});

	assert(new URL(page.url()).origin === PRODUCTION_ORIGIN, `Unexpected origin: ${page.url()}`);
	assert(!/\/(entrar|conta)(?:[/?#]|$)/u.test(new URL(page.url()).pathname), "Stored browser state is not an authenticated TDA session.");

	const resultsTab = page.getByRole("tab", { name: "Resultados" });
	await resultsTab.waitFor({ state: "visible", timeout: 30_000 });
	await resultsTab.click();

	const run = page
		.locator("article")
		.filter({ hasText: sourceId })
		.filter({ hasText: runId });
	await run.first().waitFor({ state: "visible", timeout: 30_000 });
	assert((await run.count()) === 1, "The exact source/run pair was not unique in Results.");
	await run.getByRole("button", { name: "Revisar resultado" }).click();

	const status = page.getByLabel("Estado do draft");
	await status.waitFor({ state: "visible", timeout: 30_000 });
	assert((await status.inputValue()) === "approved_local", "Selected review is not approved_local.");

	const prepare = page.getByRole("button", { name: "Preparar sessão" });
	await prepare.waitFor({ state: "visible", timeout: 30_000 });
	assert(await prepare.isEnabled(), "Preparar sessão is disabled for the selected review.");
	await prepare.click();

	const confirmation = page.getByRole("alertdialog");
	await confirmation.waitFor({ state: "visible", timeout: 30_000 });

	const requestPromise = page.waitForRequest(
		(request) =>
			request.method() === "POST" &&
			new URL(request.url()).pathname === "/api/transcript-publications",
		{ timeout: 60_000 },
	);
	const responsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === "/api/transcript-publications",
		{ timeout: 60_000 },
	);
	await confirmation.getByRole("button", { name: "Preparar sessão" }).click();

	const [publicationRequest, publicationResponse] = await Promise.all([
		requestPromise,
		responsePromise,
	]);
	const requestBody = publicationRequest.postData();
	assert(requestBody, "The publication request body was unavailable.");
	assert(publicationResponse.status() === 200, `Initial handoff failed with HTTP ${publicationResponse.status()}.`);
	const receipt = receiptFrom(await publicationResponse.json());
	const requestJson = JSON.parse(requestBody);
	assert(requestJson.operationId === receipt.operationId, "Receipt operation differs from the handoff request.");
	assert(
		requestJson.expectedCurrentRevisionId === null ||
			(typeof requestJson.expectedCurrentRevisionId === "string" &&
				UUID.test(requestJson.expectedCurrentRevisionId)),
		"Initial expected current revision is invalid.",
	);
	assert(requestJson.binding?.sourceId === sourceId, "The UI prepared a different source.");
	assert(requestJson.review?.runId === runId, "The UI prepared a different run.");

	await page
		.getByText(/Sessão preparada no Edit · revisão cloud/u)
		.waitFor({ state: "visible", timeout: 30_000 });

	const replay = await postFromPage(
		page,
		"/api/transcript-publications",
		requestBody,
	);
	assert(replay.status === 200, `Publication replay failed with HTTP ${replay.status}.`);
	const replayReceipt = receiptFrom(replay.json);
	assert(replayReceipt.receiptId === receipt.receiptId, "Replay returned a different receipt.");
	assert(replayReceipt.revisionId === receipt.revisionId, "Replay returned a different revision.");

	const target = {
		campaignSlug: requestJson.binding.campaignSlug,
		sourceSessionId: requestJson.binding.sourceSessionId,
	};
	const current = await readCurrent(page, target);
	assert(current.revisionId === receipt.revisionId, "Current pointer does not match the committed handoff.");

	const staleInput = {
		...target,
		operationId: crypto.randomUUID(),
		revisionId: receipt.revisionId,
		expectedCurrentRevisionId: requestJson.expectedCurrentRevisionId,
		expectedActorProfileId: current.actorProfileId,
	};
	const stale = await mutateCurrent(page, staleInput, 409);
	assert(stale?.ok === false && stale.reason === "stale_current", "Stale-current negative did not fail closed.");

	rollbackInput = {
		...target,
		operationId: crypto.randomUUID(),
		revisionId: requestJson.expectedCurrentRevisionId,
		expectedCurrentRevisionId: receipt.revisionId,
		expectedActorProfileId: current.actorProfileId,
	};
	const rollbackEvent = eventFrom(await mutateCurrent(page, rollbackInput), rollbackInput);
	rollbackCommitted = true;
	const rollbackReplay = eventFrom(await mutateCurrent(page, rollbackInput), rollbackInput);
	assert(rollbackReplay.eventId === rollbackEvent.eventId, "Rollback replay created a different event.");
	const afterRollback = await readCurrent(page, target);
	assert(afterRollback.revisionId === rollbackInput.revisionId, "Rollback did not restore the previous current state.");

	finalRestoreInput = {
		...target,
		operationId: crypto.randomUUID(),
		revisionId: receipt.revisionId,
		expectedCurrentRevisionId: rollbackInput.revisionId,
		expectedActorProfileId: current.actorProfileId,
	};
	const restoreEvent = eventFrom(
		await mutateCurrent(page, finalRestoreInput),
		finalRestoreInput,
	);
	finalRestoreCommitted = true;
	const restoreReplay = eventFrom(
		await mutateCurrent(page, finalRestoreInput),
		finalRestoreInput,
	);
	assert(restoreReplay.eventId === restoreEvent.eventId, "Final restore replay created a different event.");
	const finalCurrent = await readCurrent(page, target);
	assert(finalCurrent.revisionId === receipt.revisionId, "Final current pointer was not restored to the accepted handoff.");

	process.stdout.write(
		`${JSON.stringify(
			{
				origin: PRODUCTION_ORIGIN,
				sourceId,
				runId,
				receiptId: receipt.receiptId,
				revisionId: receipt.revisionId,
				revisionNumber: receipt.revisionNumber,
				previousRevisionId: requestJson.expectedCurrentRevisionId,
				publishReplayVerified: true,
				staleCurrentNegativeVerified: true,
				rollbackAction: rollbackEvent.action,
				rollbackEventId: rollbackEvent.eventId,
				rollbackReplayVerified: true,
				restoreEventId: restoreEvent.eventId,
				restoreReplayVerified: true,
				finalCurrentRevisionId: finalCurrent.revisionId,
				finalStateRestored: true,
			},
			null,
			2,
		)}\n`,
	);
} catch (error) {
	if (rollbackCommitted && !finalRestoreCommitted) {
		process.stderr.write(
			"WARNING: the smoke changed the current pointer but did not confirm the final restore. Re-run with the same real review after inspecting canonical current metadata; do not invent a replacement operation blindly.\n",
		);
	}
	throw error;
} finally {
	await browser.close();
}
