import { describe, expect, it } from "vitest";
import {
	clearSessionCampaignMoveRecovery,
	loadSessionCampaignMoveRecovery,
	saveSessionCampaignMoveRecovery,
	SESSION_CAMPAIGN_MOVE_RECOVERY_MAX_PER_SCOPE,
	SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA,
	SESSION_CAMPAIGN_MOVE_RECOVERY_TTL_MS,
} from "./session-campaign-move-recovery";

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

const identity = {
	scope: "a".repeat(64),
	sessionId: "11111111-1111-4111-8111-111111111111",
	sourceSessionId: "shared-session",
	sourceCampaignSlug: "campaign-a",
	destinationCampaignSlug: "campaign-b",
} as const;

describe("session campaign move recovery", () => {
	it("survives remount with only bounded move identity metadata", () => {
		const storage = new MemoryStorage();
		const operationId = "22222222-2222-4222-8222-222222222222";
		expect(
			saveSessionCampaignMoveRecovery(
				storage,
				identity,
				operationId,
				{ publishedPolicy: "unpublish", sessionGrantPolicy: "preserve" },
				1_000_000,
			),
		).toBe(true);

		const recovered = loadSessionCampaignMoveRecovery(
			storage,
			identity,
			1_000_001,
		);
		expect(recovered?.operationId).toBe(operationId);
		expect(recovered?.options).toEqual({
			publishedPolicy: "unpublish",
			sessionGrantPolicy: "preserve",
		});

		const serialized = Array.from(
			{ length: storage.length },
			(_, index) => storage.getItem(storage.key(index) ?? "") ?? "",
		).join(" ");
		expect(serialized).toContain(SESSION_CAMPAIGN_MOVE_RECOVERY_SCHEMA);
		expect(serialized).not.toContain("transcript");
		expect(serialized).not.toContain("summary");
		expect(serialized).not.toContain("coverUrl");
	});

	it("never crosses actor scope, destination or source-session identity", () => {
		const storage = new MemoryStorage();
		saveSessionCampaignMoveRecovery(
			storage,
			identity,
			"22222222-2222-4222-8222-222222222222",
			{},
			2_000_000,
		);

		expect(
			loadSessionCampaignMoveRecovery(
				storage,
				{ ...identity, scope: "b".repeat(64) },
				2_000_001,
			),
		).toBeNull();
		expect(
			loadSessionCampaignMoveRecovery(
				storage,
				{ ...identity, destinationCampaignSlug: "campaign-c" },
				2_000_001,
			),
		).toBeNull();
		expect(
			loadSessionCampaignMoveRecovery(
				storage,
				{ ...identity, sourceSessionId: "other-session" },
				2_000_001,
			),
		).toBeNull();
		expect(
			loadSessionCampaignMoveRecovery(storage, identity, 2_000_001),
		).not.toBeNull();
	});

	it("expires without extending the original unresolved intent", () => {
		const storage = new MemoryStorage();
		const operationId = "22222222-2222-4222-8222-222222222222";
		const createdAt = 3_000_000;
		saveSessionCampaignMoveRecovery(
			storage,
			identity,
			operationId,
			{ publishedPolicy: "unpublish" },
			createdAt,
		);
		saveSessionCampaignMoveRecovery(
			storage,
			identity,
			operationId,
			{ publishedPolicy: "unpublish" },
			createdAt + SESSION_CAMPAIGN_MOVE_RECOVERY_TTL_MS - 1,
		);

		expect(
			loadSessionCampaignMoveRecovery(
				storage,
				identity,
				createdAt + SESSION_CAMPAIGN_MOVE_RECOVERY_TTL_MS + 1,
			),
		).toBeNull();
		expect(storage.length).toBe(0);
	});

	it("clears only the matching intent after a terminal reconciliation", () => {
		const storage = new MemoryStorage();
		saveSessionCampaignMoveRecovery(
			storage,
			identity,
			"22222222-2222-4222-8222-222222222222",
			{},
			4_000_000,
		);
		clearSessionCampaignMoveRecovery(storage, identity);
		expect(
			loadSessionCampaignMoveRecovery(storage, identity, 4_000_001),
		).toBeNull();
	});

	it("keeps unresolved intents bounded per opaque actor scope", () => {
		const storage = new MemoryStorage();
		for (
			let index = 0;
			index < SESSION_CAMPAIGN_MOVE_RECOVERY_MAX_PER_SCOPE + 3;
			index += 1
		) {
			saveSessionCampaignMoveRecovery(
				storage,
				{
					...identity,
					sessionId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
					sourceSessionId: `session-${index}`,
				},
				`22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
				{},
				5_000_000 + index,
			);
		}
		expect(storage.length).toBe(SESSION_CAMPAIGN_MOVE_RECOVERY_MAX_PER_SCOPE);
	});

	it("rejects malformed or expanded recovery payloads", () => {
		const storage = new MemoryStorage();
		expect(
			saveSessionCampaignMoveRecovery(
				storage,
				identity,
				"not-a-uuid",
				{},
				6_000_000,
			),
		).toBe(false);
		expect(
			saveSessionCampaignMoveRecovery(
				storage,
				identity,
				"22222222-2222-4222-8222-222222222222",
				{ publishedPolicy: "replace" as never },
				6_000_000,
			),
		).toBe(false);
	});
});
