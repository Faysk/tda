import { describe, expect, it } from "vitest";
import {
	confirmSessionComposerPendingSubmission,
	resolveSessionComposerPendingSubmission,
} from "./session-composer-storage";

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

const sourceId = `craig-${"a".repeat(64)}`;

describe("session composer pending submission recovery", () => {
	it("reuses the same persisted idempotency key after a reload-like reconstruction", async () => {
		const storage = new MemoryStorage();
		let created = 0;
		const common = {
			storage,
			recoveryScope: "profile-scope-fixture",
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
			sourceId,
			profileId: "whisper-detailed",
			requestSignature: JSON.stringify([
				"yuhara-main",
				"sessao-42",
				sourceId,
				"whisper-detailed",
				"",
				"",
				false,
			]),
		};

		const first = await resolveSessionComposerPendingSubmission({
			...common,
			createKey: () => {
				created += 1;
				return "composer-operation-1";
			},
		});
		expect(first.key).toBe("composer-operation-1");
		expect(first.recoveredFromStorage).toBe(false);
		expect(created).toBe(1);

		const reconstructed = await resolveSessionComposerPendingSubmission({
			...common,
			existing: null,
			createKey: () => {
				created += 1;
				return "composer-operation-2";
			},
		});
		expect(reconstructed.key).toBe("composer-operation-1");
		expect(reconstructed.recoveredFromStorage).toBe(true);
		expect(created).toBe(1);

		confirmSessionComposerPendingSubmission(storage, reconstructed);

		const afterConfirmation = await resolveSessionComposerPendingSubmission({
			...common,
			existing: null,
			createKey: () => {
				created += 1;
				return "composer-operation-3";
			},
		});
		expect(afterConfirmation.key).toBe("composer-operation-3");
		expect(afterConfirmation.recoveredFromStorage).toBe(false);
		expect(created).toBe(2);
	});

	it("reuses the in-memory key when browser recovery scope is unavailable", async () => {
		const storage = new MemoryStorage();
		const common = {
			storage,
			recoveryScope: null,
			campaignId: "yuhara-main",
			sessionId: "sessao-42",
			sourceId,
			profileId: "whisper-detailed",
			requestSignature: "same-request",
		};

		const first = await resolveSessionComposerPendingSubmission({
			...common,
			createKey: () => "in-memory-operation",
		});
		const second = await resolveSessionComposerPendingSubmission({
			...common,
			existing: first,
			createKey: () => "must-not-be-used",
		});
		expect(second).toBe(first);
	});
});
