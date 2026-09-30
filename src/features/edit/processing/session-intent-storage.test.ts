import { describe, expect, test } from "vitest";
import {
	createSessionIntentReceipt,
	loadSessionIntentReceipt,
	saveSessionIntentReceipt,
	sessionIntentReceiptIdentity,
	updateSessionIntentReceipt,
} from "./session-intent-storage";

class MemoryStorage implements Storage {
	private readonly values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

const NOW = Date.parse("2026-09-30T00:00:00.000Z");
const SOURCE_A = `craig-${"1".repeat(64)}`;
const SOURCE_B = `craig-${"2".repeat(64)}`;

describe("session intent recovery receipt", () => {
	test("persists only bounded orchestration state and restores job/run authority", async () => {
		const storage = new MemoryStorage();
		const identity = await sessionIntentReceiptIdentity({
			profileScope: "profile-42:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
		});
		let receipt = createSessionIntentReceipt(
			identity,
			{
				requestId: "intent-42",
				sourceIds: [SOURCE_A, SOURCE_B],
				profileId: "whisper-detailed",
				context: "mesa de quinta",
				glossary: "Yuhara",
			},
			NOW,
		);
		receipt = updateSessionIntentReceipt(receipt, {
			enqueue: { sourceId: SOURCE_B, key: "enqueue-b" },
		});
		receipt = updateSessionIntentReceipt(receipt, {
			job: { sourceId: SOURCE_B, jobId: "job-b" },
		});
		receipt = updateSessionIntentReceipt(receipt, {
			run: { sourceId: SOURCE_B, runId: "run-b" },
		});
		expect(saveSessionIntentReceipt(storage, identity, receipt, NOW + 1_000)).toBe(
			true,
		);

		const restored = loadSessionIntentReceipt(storage, identity, NOW + 2_000);
		expect(restored).toMatchObject({
			requestId: "intent-42",
			sourceIds: [SOURCE_A, SOURCE_B],
			profileId: "whisper-detailed",
			context: "mesa de quinta",
			glossary: "Yuhara",
			enqueueKeys: { [SOURCE_B]: "enqueue-b" },
			jobIds: { [SOURCE_B]: "job-b" },
			runIds: { [SOURCE_B]: "run-b" },
		});
		const serialized = JSON.stringify(restored);
		expect(serialized).not.toContain("PK-");
		expect(serialized).not.toContain("audio");
	});

	test("scope hash prevents another signed-in profile from loading the receipt", async () => {
		const storage = new MemoryStorage();
		const owner = await sessionIntentReceiptIdentity({
			profileScope: "profile-a:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
		});
		const other = await sessionIntentReceiptIdentity({
			profileScope: "profile-b:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
		});
		const receipt = createSessionIntentReceipt(
			owner,
			{
				requestId: "intent-42",
				sourceIds: [SOURCE_A],
				profileId: "whisper-detailed",
				context: "",
				glossary: "",
			},
			NOW,
		);
		expect(saveSessionIntentReceipt(storage, owner, receipt, NOW)).toBe(true);
		expect(loadSessionIntentReceipt(storage, other, NOW + 1)).toBeNull();
		expect(loadSessionIntentReceipt(storage, owner, NOW + 1)).not.toBeNull();
	});

	test("rejects stale receipts and refuses out-of-bounds user text", async () => {
		const storage = new MemoryStorage();
		const identity = await sessionIntentReceiptIdentity({
			profileScope: "profile-42:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
		});
		const receipt = createSessionIntentReceipt(
			identity,
			{
				requestId: "intent-42",
				sourceIds: [SOURCE_A],
				profileId: "whisper-detailed",
				context: "",
				glossary: "",
			},
			NOW,
		);
		expect(saveSessionIntentReceipt(storage, identity, receipt, NOW)).toBe(true);
		expect(
			loadSessionIntentReceipt(storage, identity, NOW + 25 * 60 * 60 * 1_000),
		).toBeNull();

		expect(() =>
			createSessionIntentReceipt(
				identity,
				{
					requestId: "intent-too-large",
					sourceIds: [SOURCE_A],
					profileId: "whisper-detailed",
					context: "x".repeat(1201),
					glossary: "",
				},
				NOW,
			),
		).toThrow("SESSION_INTENT_RECOVERY_RECEIPT_INVALID");
	});
});
