import { describe, expect, it } from "vitest";
import { processingCampaignHref } from "./campaign-context";
import {
	sessionComposerLastSessionKey,
	sessionComposerRecoveryKey,
} from "./session-composer-storage";

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
});
