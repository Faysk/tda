import { describe, expect, it } from "vitest";
import type { CraigSource } from "./protocol";
import {
	clearSessionIntentRecovery,
	loadSessionIntentRecovery,
	saveSessionIntentRecovery,
} from "./session-intent-recovery";

class MemoryStorage implements Storage {
	readonly data = new Map<string, string>();
	get length() { return this.data.size; }
	clear() { this.data.clear(); }
	getItem(key: string) { return this.data.get(key) ?? null; }
	key(index: number) { return [...this.data.keys()][index] ?? null; }
	removeItem(key: string) { this.data.delete(key); }
	setItem(key: string, value: string) { this.data.set(key, value); }
}

const source: CraigSource = {
	schemaVersion: "tda_craig_ingest_v1",
	sourceId: `craig-${"a".repeat(64)}`,
	sourceSha256: "a".repeat(64),
	recordingId: "recording-a",
	sizeBytes: 1234,
	trackCount: 2,
	audioWorkSeconds: 42,
	sessionDurationSeconds: 21,
	minimumTrackDurationSeconds: 20,
	reused: true,
};

describe("session intent recovery receipt", () => {
	it("round-trips bounded processing intent and authoritative job/run identities", () => {
		const storage = new MemoryStorage();
		saveSessionIntentRecovery(
			storage,
			"profile-a",
			{
				sessionId: "sessao-a",
				sources: [{ source, label: "Craig 1.zip" }],
				profile: "qwen-quality",
				context: "Contexto local",
				glossary: "Yuhara",
			},
			new Map([[source.sourceId, "job-a"]]),
			new Map([[source.sourceId, "run-a"]]),
		);
		const recovered = loadSessionIntentRecovery(storage, "profile-a", "sessao-a");
		expect(recovered?.intent).toEqual({
			sessionId: "sessao-a",
			sources: [{ source, label: "Craig 1.zip" }],
			profile: "qwen-quality",
			context: "Contexto local",
			glossary: "Yuhara",
		});
		expect([...recovered?.jobIds ?? []]).toEqual([[source.sourceId, "job-a"]]);
		expect([...recovered?.runIds ?? []]).toEqual([[source.sourceId, "run-a"]]);
	});

	it("is isolated by recovery scope and session, then can be cleared", () => {
		const storage = new MemoryStorage();
		const intent = {
			sessionId: "sessao-a",
			sources: [{ source, label: "Craig.zip" }],
			profile: "whisper-turbo" as const,
			context: "",
			glossary: "",
		};
		saveSessionIntentRecovery(storage, "profile-a", intent);
		expect(loadSessionIntentRecovery(storage, "profile-b", "sessao-a")).toBeNull();
		expect(loadSessionIntentRecovery(storage, "profile-a", "sessao-b")).toBeNull();
		clearSessionIntentRecovery(storage, "profile-a", "sessao-a");
		expect(loadSessionIntentRecovery(storage, "profile-a", "sessao-a")).toBeNull();
	});

	it("fails closed for corrupted, unscoped or source-mismatched receipts", () => {
		const storage = new MemoryStorage();
		saveSessionIntentRecovery(storage, null, {
			sessionId: "sessao-a",
			sources: [{ source, label: "Craig.zip" }],
			profile: "qwen-fast",
			context: "",
			glossary: "",
		});
		expect(storage.length).toBe(0);

		saveSessionIntentRecovery(storage, "profile-a", {
			sessionId: "sessao-a",
			sources: [{ source, label: "Craig.zip" }],
			profile: "qwen-fast",
			context: "",
			glossary: "",
		});
		const [key] = [...storage.data.keys()];
		if (!key) throw new Error("expected recovery key");
		const parsed = JSON.parse(storage.getItem(key) ?? "{}") as {
			job_ids: Array<[string, string]>;
		};
		parsed.job_ids = [[`craig-${"f".repeat(64)}`, "job-foreign"]];
		storage.setItem(key, JSON.stringify(parsed));
		expect(loadSessionIntentRecovery(storage, "profile-a", "sessao-a")).toBeNull();

		storage.setItem(key, "{not-json");
		expect(loadSessionIntentRecovery(storage, "profile-a", "sessao-a")).toBeNull();
	});
});
