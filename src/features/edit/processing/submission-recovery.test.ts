import { describe, expect, it } from "vitest";
import {
	clearPendingSubmission,
	clearPendingSubmissionsForSession,
	loadPendingSubmission,
	pendingSubmissionRecoveryIdentity,
	savePendingSubmission,
	SUBMISSION_RECOVERY_MAX_PER_SCOPE,
	SUBMISSION_RECOVERY_TTL_MS,
} from "./submission-recovery";

class MemoryStorage implements Storage {
	private values = new Map<string, string>();

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
		return Array.from(this.values.keys())[index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

const sourceId = `craig-${"a".repeat(64)}`;

async function identity(
	overrides: Partial<{
		profileScope: string;
		campaignId: string;
		sessionId: string;
		sourceId: string;
		profileId: string;
		requestSignature: string;
	}> = {},
) {
	const profileScope = overrides.profileScope ?? "private-profile-id:yuhara-main";
	const campaignId = overrides.campaignId ?? "yuhara-main";
	const sessionId = overrides.sessionId ?? "sessao-42";
	const effectiveSourceId = overrides.sourceId ?? sourceId;
	const profileId = overrides.profileId ?? "qwen-quality";
	const requestSignature =
		overrides.requestSignature ??
		JSON.stringify([
			campaignId,
			sessionId,
			effectiveSourceId,
			profileId,
			"glossario-secreto",
			"contexto-secreto",
			false,
		]);
	return pendingSubmissionRecoveryIdentity({
		profileScope,
		campaignId,
		sessionId,
		sourceId: effectiveSourceId,
		profileId,
		requestSignature,
	});
}

describe("pending Craig submission recovery", () => {
	it("survives remount with only hashed request/scope metadata", async () => {
		const storage = new MemoryStorage();
		const value = await identity();
		expect(
			savePendingSubmission(
				storage,
				value,
				"123e4567-e89b-12d3-a456-426614174000",
				1_000_000,
			),
		).toBe(true);

		expect(
			loadPendingSubmission(storage, value, 1_000_001)?.idempotencyKey,
		).toBe("123e4567-e89b-12d3-a456-426614174000");

		const serialized = Array.from(
			{ length: storage.length },
			(_, index) => storage.getItem(storage.key(index) ?? "") ?? "",
		).join(" ");
		expect(serialized).not.toContain("private-profile-id");
		expect(serialized).not.toContain("glossario-secreto");
		expect(serialized).not.toContain("contexto-secreto");
		expect(serialized).toContain("tda_processing_pending_submission_v1");
	});

	it("does not extend the original recovery TTL when the same key is retried", async () => {
		const storage = new MemoryStorage();
		const value = await identity();
		const createdAt = 1_500_000;
		savePendingSubmission(storage, value, "key-stable", createdAt);
		savePendingSubmission(
			storage,
			value,
			"key-stable",
			createdAt + SUBMISSION_RECOVERY_TTL_MS - 1,
		);

		expect(
			loadPendingSubmission(
				storage,
				value,
				createdAt + SUBMISSION_RECOVERY_TTL_MS + 1,
			),
		).toBeNull();
	});

	it("never crosses actor scope or request identity", async () => {
		const storage = new MemoryStorage();
		const original = await identity();
		savePendingSubmission(storage, original, "key-original", 2_000_000);

		expect(
			loadPendingSubmission(
				storage,
				await identity({ profileScope: "other-profile:yuhara-main" }),
				2_000_001,
			),
		).toBeNull();
		expect(
			loadPendingSubmission(
				storage,
				await identity({ sessionId: "sessao-43" }),
				2_000_001,
			),
		).toBeNull();
		expect(
			loadPendingSubmission(
				storage,
				await identity({ requestSignature: "different-request" }),
				2_000_001,
			),
		).toBeNull();
		expect(loadPendingSubmission(storage, original, 2_000_001)).not.toBeNull();
	});

	it("never reuses a pending idempotency key across campaigns with the same session/source/profile", async () => {
		const storage = new MemoryStorage();
		const shared = {
			profileScope: "private-profile-id",
			sessionId: "same-session",
			sourceId,
			profileId: "qwen-quality",
		};
		const campaignA = await identity({
			...shared,
			campaignId: "campaign-a",
		});
		const campaignB = await identity({
			...shared,
			campaignId: "campaign-b",
		});

		expect(campaignA.requestSignatureHash).not.toBe(
			campaignB.requestSignatureHash,
		);
		savePendingSubmission(storage, campaignA, "key-campaign-a", 2_500_000);

		expect(
			loadPendingSubmission(storage, campaignB, 2_500_001),
		).toBeNull();
		expect(
			loadPendingSubmission(storage, campaignA, 2_500_001)?.idempotencyKey,
		).toBe("key-campaign-a");
	});

	it("fresh session restart clears every unresolved enqueue identity for that session only", async () => {
		const storage = new MemoryStorage();
		const now = Date.now();
		const first = await identity({ sourceId });
		const second = await identity({
			sourceId: `craig-${"b".repeat(64)}`,
			requestSignature: "second-source",
		});
		const otherSession = await identity({
			sessionId: "sessao-other",
			requestSignature: "other-session",
		});
		savePendingSubmission(storage, first, "key-first", now);
		savePendingSubmission(storage, second, "key-second", now + 1);
		savePendingSubmission(storage, otherSession, "key-other", now + 2);

		await clearPendingSubmissionsForSession(storage, {
			profileScope: "private-profile-id:yuhara-main",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
		});

		expect(loadPendingSubmission(storage, first, now + 3)).toBeNull();
		expect(loadPendingSubmission(storage, second, now + 3)).toBeNull();
		expect(
			loadPendingSubmission(storage, otherSession, now + 3)?.idempotencyKey,
		).toBe("key-other");
	});

	it("expires unresolved intent and clears it after a confirmed response", async () => {
		const storage = new MemoryStorage();
		const value = await identity();
		savePendingSubmission(storage, value, "key-expiring", 3_000_000);

		expect(
			loadPendingSubmission(
				storage,
				value,
				3_000_000 + SUBMISSION_RECOVERY_TTL_MS + 1,
			),
		).toBeNull();
		expect(storage.length).toBe(0);

		savePendingSubmission(storage, value, "key-resolved", 4_000_000);
		clearPendingSubmission(storage, value);
		expect(loadPendingSubmission(storage, value, 4_000_001)).toBeNull();
	});

	it("keeps unresolved browser metadata bounded per actor/campaign scope", async () => {
		const storage = new MemoryStorage();
		for (let index = 0; index < SUBMISSION_RECOVERY_MAX_PER_SCOPE + 3; index += 1) {
			const value = await identity({
				sessionId: `sessao-${index}`,
				requestSignature: `request-${index}`,
			});
			savePendingSubmission(storage, value, `key-${index}`, 5_000_000 + index);
		}
		expect(storage.length).toBe(SUBMISSION_RECOVERY_MAX_PER_SCOPE);
	});
});
