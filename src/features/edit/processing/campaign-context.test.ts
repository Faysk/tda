import { describe, expect, it } from "vitest";
import { processingCampaignHref } from "./campaign-context";
import {
	readSessionComposerLastSessionPointer,
	readSessionComposerRecoveryPointer,
	sessionComposerLastSessionKey,
	sessionComposerRecoveryKey,
} from "./session-composer-storage";


function memoryStorage(initial: Record<string, string> = {}): Storage {
	const values = new Map(Object.entries(initial));
	return {
		get length() {
			return values.size;
		},
		clear() {
			values.clear();
		},
		getItem(key) {
			return values.get(key) ?? null;
		},
		key(index) {
			return [...values.keys()][index] ?? null;
		},
		removeItem(key) {
			values.delete(key);
		},
		setItem(key, value) {
			values.set(key, String(value));
		},
	};
}

describe("processing campaign context", () => {
	it("builds a deep-linkable processing URL without treating browser state as authority", () => {
		expect(processingCampaignHref("antes-que-seja-tarde")).toBe(
			"/edit/processamento?campanha=antes-que-seja-tarde",
		);
	});

	it("rejects malformed campaign slugs before navigation or storage", () => {
		expect(() => processingCampaignHref("../private")).toThrow();
		expect(() => sessionComposerLastSessionKey("campaign/other")).toThrow();
	});

	it("scopes last-session memory by campaign so identical session ids do not collide", () => {
		expect(sessionComposerLastSessionKey("campaign-a")).not.toBe(
			sessionComposerLastSessionKey("campaign-b"),
		);
		expect(sessionComposerLastSessionKey("campaign-a")).toContain("campaign-a");
		expect(sessionComposerRecoveryKey("campaign-a")).not.toBe(
			sessionComposerRecoveryKey("campaign-b"),
		);
	});

	it("migrates legacy single-campaign pointers only into yuhara-main", () => {
		const storage = memoryStorage({
			"tda.processing.session-composer.v1": "sessao-legacy",
			"tda.processing.session-composer.last-session.v1": "sessao-legacy",
		});

		expect(
			readSessionComposerRecoveryPointer(storage, "campaign-b"),
		).toBeNull();
		expect(
			readSessionComposerLastSessionPointer(storage, "campaign-b"),
		).toBeNull();

		expect(
			readSessionComposerRecoveryPointer(storage, "yuhara-main"),
		).toBe("sessao-legacy");
		expect(
			readSessionComposerLastSessionPointer(storage, "yuhara-main"),
		).toBe("sessao-legacy");
		expect(storage.getItem(sessionComposerRecoveryKey("yuhara-main"))).toBe(
			"sessao-legacy",
		);
		expect(storage.getItem(sessionComposerLastSessionKey("yuhara-main"))).toBe(
			"sessao-legacy",
		);
		expect(storage.getItem("tda.processing.session-composer.v1")).toBeNull();
		expect(
			storage.getItem("tda.processing.session-composer.last-session.v1"),
		).toBeNull();
	});

	it("ignores malformed legacy pointers instead of leaking them across campaigns", () => {
		const storage = memoryStorage({
			"tda.processing.session-composer.v1": "../other-campaign",
		});
		expect(
			readSessionComposerRecoveryPointer(storage, "yuhara-main"),
		).toBeNull();
		expect(
			readSessionComposerRecoveryPointer(storage, "campaign-b"),
		).toBeNull();
	});
});
